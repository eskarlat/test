# ADR-047: Console Chat UI with GitHub Copilot SDK

## Status
Proposed

## Context

RenRe Kit's Console UI currently provides dashboards, extension management, vault, logs, and intelligence pages — but no direct LLM interaction. Users must switch to a separate terminal (Copilot CLI, Claude Code, etc.) for AI-assisted work, losing visibility into the project context that RenRe Kit manages.

GitHub's [Copilot SDK](https://github.com/github/copilot-sdk) (`@github/copilot-sdk`) provides a Node.js client that communicates with Copilot CLI via JSON-RPC (stdio or TCP). It handles authentication transparently (no API keys needed), exposes model listing, streaming, tool execution events, subagent lifecycle, file attachments, and session persistence — all through a typed event system with 40+ event types.

Integrating the Copilot SDK into the worker service enables a first-class Chat page in the Console UI where users interact with LLMs while benefiting from RenRe Kit's full context pipeline (hooks, context recipes, observations, session memory).

## Decision

### 1. Architecture Overview

Chat is **project-scoped** — each chat session belongs to a project and inherits its extensions, hooks, tool governance, and context recipes.

```
Console UI (React)                Worker Service (Express)           Copilot CLI
┌────────────────────┐           ┌──────────────────────┐          ┌──────────────┐
│  Chat Page         │◄─ IO ──►│  /api/{pid}/chat/*   │◄─ RPC ──►│  JSON-RPC    │
│  - Message list    │           │  CopilotBridge       │          │  (stdio)     │
│  - Tool panels     │── HTTP ──►│    CopilotClient     │          │              │
│  - Subagent tree   │           │    Session mgmt      │          └──────────────┘
│  - File diffs      │           │  Context injection   │
│  - Model selector  │           │  Built-in tools      │
│  - Stop button     │           │  Extension tools     │
└────────────────────┘           └──────────────────────┘
```

**Data flow**: Console UI → worker REST API → CopilotBridge → CopilotClient → Copilot CLI (JSON-RPC). Events flow back via **Socket.IO** (ADR-048) from worker to Console UI. Chat events use the `chat:{sessionId}` room for session-scoped delivery. REST is used for non-streaming operations (create session, list models). Socket.IO provides:
- Bidirectional communication (permission responses, input answers, cancel) on the shared connection
- Session-scoped rooms (`chat:{sessionId}`) — only clients joined to a session receive its events
- Single multiplexed connection for all real-time events (system, project, chat) instead of separate SSE + per-session channels

### 2. Worker Service: CopilotBridge

A new core module `copilot-bridge.ts` wraps the `@github/copilot-sdk`:

```typescript
// packages/worker-service/src/core/copilot-bridge.ts

import { CopilotClient, CopilotSession, defineTool } from "@github/copilot-sdk";

type BridgeStatus = "not-initialized" | "starting" | "ready" | "error" | "unavailable";

interface ChatSession {
  sessionId: string;
  sdkSession: CopilotSession;
  projectId: string;
  model: string;
  createdAt: string;
  title?: string;
}

class CopilotBridge {
  private client: CopilotClient | null = null;
  private sessions: Map<string, ChatSession> = new Map();
  private status: BridgeStatus = "not-initialized";
  private statusError?: string;

  // Lazy initialization — called on first chat request, NOT at worker startup
  async ensureStarted(): Promise<void>;
  async stop(): Promise<void>;

  // Health
  getStatus(): { status: BridgeStatus; error?: string };

  // Models
  async listModels(): Promise<ModelInfo[]>;

  // Sessions
  async createSession(opts: CreateSessionOpts): Promise<string>;
  async resumeSession(sessionId: string): Promise<void>;
  async listSessions(projectId?: string): Promise<SessionMetadata[]>;
  async deleteSession(sessionId: string): Promise<void>;

  // Messaging
  async sendMessage(sessionId: string, message: SendMessageOpts): Promise<void>;
  async cancelGeneration(sessionId: string): Promise<void>;  // Stop in-progress response

  // Internal
  private attachEventListeners(session: CopilotSession, sessionId: string): void;
  private handleProcessCrash(): Promise<void>;
}
```

#### 2.1 Lazy Initialization

CopilotBridge does **not** start at worker boot — it initializes lazily on the first chat-related request. This prevents blocking the worker startup if Copilot CLI is slow to spawn or not installed.

```typescript
async ensureStarted(): Promise<void> {
  if (this.status === "ready") return;
  if (this.status === "unavailable") throw new ChatUnavailableError(this.statusError);

  this.status = "starting";
  try {
    // Check if Copilot CLI is installed
    const cliPath = await which("copilot").catch(() => null);
    if (!cliPath) {
      this.status = "unavailable";
      this.statusError = "Copilot CLI not found. Install: npm install -g @github/copilot-cli";
      throw new ChatUnavailableError(this.statusError);
    }

    this.client = new CopilotClient({ autoStart: true, useStdio: true });
    await this.client.start();
    this.status = "ready";
  } catch (err) {
    this.status = "error";
    this.statusError = err.message;
    throw err;
  }
}
```

#### 2.2 Crash Recovery

If the Copilot CLI stdio process dies mid-session:

1. CopilotClient emits a connection error
2. CopilotBridge sets `status = "error"`, emits to all active session rooms via Socket.IO: `chat:error { reason: "cli-crashed" }`
3. Auto-restart attempt (max 3 retries with exponential backoff: 1s, 5s, 15s) — mirrors ADR-008 MCP stdio pattern
4. On successful restart, sessions can be resumed via `client.resumeSession()`
5. On exhausted retries, `status = "unavailable"` — UI shows reconnection banner

#### 2.3 Cancel Generation

```typescript
async cancelGeneration(sessionId: string): Promise<void> {
  const session = this.sessions.get(sessionId);
  if (!session) throw new SessionNotFoundError(sessionId);
  // SDK exposes abort on the session
  await session.sdkSession.abort();
}
```

The UI sends cancel via Socket.IO `chat:cancel` event (no REST roundtrip needed — immediate). The server identifies the session from the socket's joined `chat:{sessionId}` room.

#### 2.4 Session Creation with Context & Tools

```typescript
async createSession(opts: CreateSessionOpts): Promise<string> {
  await this.ensureStarted();

  // 1. Assemble context via context recipe engine (ADR-035)
  const context = await this.contextRecipeEngine.assemble(opts.projectId, {
    tokenBudget: 4000,
    providers: ["session-history", "observations", "git-history",
                "error-patterns", "tool-rules", "extensions"]
  });

  // 2. Build system prompt
  const systemPrompt = this.buildSystemPrompt(opts.projectId, context);

  // 3. Collect tools: built-in + extension-provided
  const builtInTools = this.buildBuiltInTools(opts.projectId);
  const extensionTools = this.buildExtensionTools(opts.projectId);
  const customAgents = this.buildCustomAgents(opts.projectId);

  // 4. Create SDK session
  const sdkSession = await this.client!.createSession({
    model: opts.model,
    streaming: true,
    reasoningEffort: opts.reasoningEffort,
    infiniteSessions: { enabled: true },
    hooks: this.buildHookHandlers(opts.projectId),
    tools: [...builtInTools, ...extensionTools],
    customAgents,
  });

  // 5. Attach event listeners → Socket.IO rooms
  this.attachEventListeners(sdkSession, sdkSession.sessionId);

  const chatSession: ChatSession = {
    sessionId: sdkSession.sessionId,
    sdkSession,
    projectId: opts.projectId,
    model: opts.model,
    createdAt: new Date().toISOString(),
  };
  this.sessions.set(sdkSession.sessionId, chatSession);

  return sdkSession.sessionId;
}
```

### 3. System Prompt Assembly

The system prompt injected at session creation mirrors what hooks inject on `sessionStart`, assembled from the context recipe engine (ADR-035):

```markdown
## RenRe Kit Context

### Project
- Name: {project.name}
- ID: {project.id}
- Path: {project.path}

### Installed Extensions
{extensions list with status}

### Active Observations
{recent observations from ADR-028}

### Tool Governance Rules
{active tool rules from ADR-029}

### Recent Session History
{last 3 sessions summary from ADR-027}

### Error Patterns
{known error fingerprints from ADR-031}

### Custom Instructions
{user-defined instructions from project config}
```

Token budget: 4000 tokens default (configurable per project). Uses the same `ContextRecipeEngine` from ADR-035 so the Chat context matches what hooks provide.

### 4. Event Forwarding (SDK → Socket.IO)

Each chat session uses a Socket.IO **room** (`chat:{sessionId}`). Clients join the room when connecting to a session (via `chat:join` event). The CopilotBridge subscribes to SDK session events and emits them to the session's room.

**Room**: `chat:{sessionId}` (see ADR-048 §Room Design)

#### 4.1 Server → Client Events

| SDK Event | Socket.IO Event | Payload |
|-----------|----------------|---------|
| `assistant.message_delta` | `message-delta` | `{ deltaContent }` |
| `assistant.message` | `message` | `{ content, role: "assistant" }` |
| `assistant.reasoning_delta` | `reasoning-delta` | `{ deltaContent }` |
| `assistant.reasoning` | `reasoning` | `{ content, tokens }` |
| `assistant.turn_start` | `turn-start` | `{ turnId }` |
| `assistant.turn_end` | `turn-end` | `{ turnId }` |
| `tool.execution_start` | `tool-start` | `{ toolCallId, toolName, arguments, roundId }` |
| `tool.execution_partial_result` | `tool-partial` | `{ toolCallId, partialOutput }` |
| `tool.execution_progress` | `tool-progress` | `{ toolCallId, progressMessage }` |
| `tool.execution_complete` | `tool-complete` | `{ toolCallId, success, result, error }` |
| `subagent.started` | `subagent-start` | `{ toolCallId, agentName, agentDisplayName }` |
| `subagent.completed` | `subagent-complete` | `{ toolCallId, agentName }` |
| `subagent.failed` | `subagent-failed` | `{ toolCallId, agentName, error }` |
| `permission.requested` | `permission-request` | `{ requestId, kind, details, diff? }` |
| `user_input.requested` | `input-request` | `{ requestId, question }` |
| `elicitation.requested` | `elicitation-request` | `{ requestId, schema }` |
| `session.title_changed` | `title-changed` | `{ title }` |
| `session.compaction_start` | `compaction-start` | `{}` |
| `session.compaction_complete` | `compaction-complete` | `{ tokensRemoved, summary }` |
| `session.usage_info` | `usage` | `{ contextWindowPct }` |
| `session.idle` | `idle` | `{}` |
| `session.error` | `error` | `{ message, recoverable }` |

#### 4.2 Client → Server Events (bidirectional)

| Socket.IO Event | Payload | Purpose |
|-----------------|---------|---------|
| `chat:send` | `{ prompt, attachments? }` | Send user message |
| `chat:cancel` | `{}` | Stop in-progress generation |
| `chat:permission` | `{ requestId, decision }` | Approve/deny permission |
| `chat:input` | `{ requestId, answer }` | Answer agent question |
| `chat:elicitation` | `{ requestId, data }` | Submit structured form |

No `sessionId` in payloads — the socket has joined the `chat:{sessionId}` room, so the server resolves the session from the room membership.

#### 4.3 Tool Call Rounds

Concurrent tool calls from the same LLM turn are grouped into a **ToolCallRound** (pattern from VS Code Copilot Chat). Each `tool-start` event includes a `roundId` that associates it with peer tool calls:

```typescript
// Multiple tool-start events with same roundId = concurrent execution
{ type: "tool-start", roundId: "r1", toolCallId: "tc1", toolName: "read_file", arguments: {...} }
{ type: "tool-start", roundId: "r1", toolCallId: "tc2", toolName: "grep", arguments: {...} }
{ type: "tool-start", roundId: "r1", toolCallId: "tc3", toolName: "get_observations", arguments: {...} }
// All three execute in parallel; completions arrive in any order
```

The UI groups tool blocks with the same `roundId` visually (see §6.5.3).

### 5. REST API & Socket.IO Events

Chat routes are **project-scoped** — sessions inherit the project's extensions, hooks, and tools.

#### 5.1 REST Endpoints (non-streaming operations)

```
GET    /api/chat/status                                 → Bridge health { status, error? }
GET    /api/chat/models                                 → List available models

POST   /api/{projectId}/chat/sessions                   → Create session { model, reasoningEffort? }
GET    /api/{projectId}/chat/sessions                   → List project's sessions
GET    /api/{projectId}/chat/sessions/:sessionId        → Get session metadata
DELETE /api/{projectId}/chat/sessions/:sessionId        → Delete session
GET    /api/{projectId}/chat/sessions/:sessionId/messages → Get conversation history
POST   /api/{projectId}/chat/sessions/:sessionId/resume → Resume disconnected session
```

#### 5.2 Socket.IO (streaming & bidirectional)

Chat streaming uses the shared Socket.IO connection (ADR-048). The client joins the session room via `chat:join` and leaves via `chat:leave`. All bidirectional chat events (§4.1, §4.2) flow through Socket.IO, eliminating REST roundtrips for latency-sensitive operations.

No dedicated chat endpoint — chat is one of three room types on the single Socket.IO connection (`system`, `project:{pid}`, `chat:{sid}`).

### 6. Console UI: Chat Page

#### 6.1 Sidebar

New project-level sidebar item **"Chat"** (icon: `MessageSquare`) under each project section. Clicking opens `/:projectId/chat`. When Copilot CLI is not available, the item shows a muted disabled state with tooltip: "Copilot CLI required".

#### 6.2 Chat Page Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Chat — my-project                                       [+ New] │
├──────────────┬───────────────────────────────────────────────────┤
│ Session List │  Model: [claude-sonnet-4-5 ▾]  Effort: [high ▾]  │
│              │───────────────────────────────────────────────────│
│ ● Current    │                                                   │
│   Session    │  ┌─ User ─────────────────────────── [Revise] ─┐  │
│              │  │ Explain the extension loader                │  │
│ ○ Yesterday  │  └─────────────────────────────────────────────┘  │
│   "Fix auth" │                                                   │
│              │  ┌─ Assistant ─────────────────────── [Copy] ──┐  │
│ ○ Mar 7      │  │ ▸ Thinking (842 tokens)                    │  │
│   "Add API"  │  │                                             │  │
│              │  │ The extension loader in                     │  │
│              │  │ `worker-service/src/core/extension-loader`  │  │
│              │  │ handles...                                  │  │
│              │  │                                             │  │
│              │  │ ┌─ Round: 3 tools ──────────────────────┐   │  │
│              │  │ │ ✓ read_file   src/core/extension...  │   │  │
│              │  │ │ ✓ read_file   src/core/manifest-...  │   │  │
│              │  │ │ ● grep        "loadExtension"        │   │  │
│              │  │ └───────────────────────────────────────┘   │  │
│              │  │                                             │  │
│              │  │ ┌─ File Edit: manifest-validator.ts ─────┐  │  │
│              │  │ │  - const MAX = 10;                     │  │  │
│              │  │ │  + const MAX = 20;                     │  │  │
│              │  │ └────────────────────────────────────────┘  │  │
│              │  └─────────────────────────────────────────────┘  │
│              │                                                   │
│              │───────────────────────────────────────────────────│
│              │  [📎 Attach] [Type a message...     ] [■ Stop]    │
│              │  Tokens: 45% ██░░░  │  TTFT: 1.2s               │
└──────────────┴───────────────────────────────────────────────────┘
```

Note: `[■ Stop]` button replaces `[Send]` during active generation. `[Revise]` appears on hover over user messages. `[Copy]` appears on hover over assistant messages. Tool rounds show concurrent tools grouped together.

#### 6.3 UI Components

```
src/routes/chat.tsx                    — Chat page (route: /:projectId/chat)
src/routes/chat-session.tsx            — Session view (route: /:projectId/chat/:sessionId)
src/components/chat/
  ChatSessionList.tsx                  — Left panel: session list with titles, dates
  ChatMessageList.tsx                  — Virtualized message feed (react-window), renders ContentBlock[]
  ChatMessage.tsx                      — Single message turn (user or assistant), copy/revise on hover
  ChatContentBlock.tsx                 — Discriminated renderer for ContentBlock variants
  ChatToolRound.tsx                    — Groups concurrent tool calls by roundId
  ChatInput.tsx                        — Message input + file attachment + send/stop toggle
  ChatModelSelector.tsx                — Model dropdown + effort selector
  ChatReasoningBlock.tsx               — Collapsible thinking/reasoning with token count badge
  ChatToolExecution.tsx                — Tool call card with state machine phases
  ChatSubagentBlock.tsx                — Subagent execution card (name, status, duration)
  ChatFileDiff.tsx                     — Unified diff viewer with incremental edit accumulation
  ChatPermissionDialog.tsx             — Inline dialog for permission requests (approve/deny, diff for writes)
  ChatInputDialog.tsx                  — Inline dialog for agent questions
  ChatElicitationDialog.tsx            — Structured form input (elicitation.requested)
  ChatContextBar.tsx                   — Bottom bar: token usage, TTFT indicator
  ChatAttachmentPreview.tsx            — Preview attached files (images shown if model supports vision)
  ChatCompactionNotice.tsx             — Inline notice when compaction occurs
  ChatProgressIndicator.tsx            — Streaming progress (tool partial results, thinking dots)
  ChatEmptyState.tsx                   — Empty states (no sessions, CLI not installed, auth expired)
  ChatNewMessageIndicator.tsx          — Floating "↓ New messages" button when scrolled up
  ChatCodeBlock.tsx                    — Code block with copy button and syntax highlighting
```

#### 6.4 Zustand Store

```typescript
// src/stores/chat-store.ts

interface ChatState {
  // Bridge status
  bridgeStatus: "not-initialized" | "starting" | "ready" | "error" | "unavailable";
  bridgeError?: string;

  // Sessions (per project)
  sessions: SessionMetadata[];
  activeSessionId: string | null;
  // Socket.IO connection managed by useSocketStore (ADR-048) — not owned by chat store

  // Models
  models: ModelInfo[];
  selectedModel: string;
  selectedEffort: "low" | "medium" | "high" | "xhigh";

  // Messages (per session, keyed by sessionId)
  messages: Map<string, ChatMessage[]>;

  // Streaming state (buffered — see §6.8)
  streamingContent: string;
  streamingReasoning: string;
  streamingReasoningTokens: number;
  isStreaming: boolean;
  isThinking: boolean;
  ttftMs: number | null;                // Time-to-first-token for current turn

  // Active tools & subagents
  activeTools: Map<string, ToolExecution>;
  activeSubagents: Map<string, SubagentExecution>;

  // Pending interactions
  pendingPermission: PermissionRequest | null;
  pendingInput: InputRequest | null;
  pendingElicitation: ElicitationRequest | null;

  // Context
  contextWindowPct: number;

  // Auto-scroll
  isUserScrolledUp: boolean;
  hasNewMessages: boolean;              // True when new content arrives while scrolled up

  // Actions
  checkBridgeStatus(): Promise<void>;
  createSession(projectId: string): Promise<string>;
  resumeSession(sessionId: string): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  sendMessage(prompt: string, attachments?: Attachment[]): void;  // Via Socket.IO chat:send
  cancelGeneration(): void;             // Via Socket.IO chat:cancel
  respondToPermission(requestId: string, decision: "approved" | "denied"): void;
  respondToInput(requestId: string, answer: string): void;
  respondToElicitation(requestId: string, data: Record<string, unknown>): void;
  setModel(modelId: string): void;
  setEffort(effort: string): void;
  reviseTo(messageIndex: number): void;
  scrollToBottom(): void;
}
```

#### 6.5 Message & Content Block Types

Messages use a **typed content block array** (inspired by VS Code Copilot Chat's `ChatResponseStream` parts system) instead of a flat string. Each block is a discriminated union rendered by `ChatContentBlock.tsx`:

```typescript
// ── Content Blocks (discriminated union) ──────────────────────────

type ContentBlock =
  | TextBlock
  | ReasoningBlock
  | ToolExecutionBlock
  | SubagentBlock
  | FileDiffBlock
  | ConfirmationBlock
  | ProgressBlock
  | WarningBlock
  | CompactionBlock
  | ImageBlock
  | TerminalBlock;

interface TextBlock {
  type: "text";
  content: string;                        // Markdown content
}

interface ReasoningBlock {
  type: "reasoning";
  content: string;                        // Thinking text (may be encrypted for some models)
  tokens?: number;                        // Token count for this reasoning block
  collapsed: boolean;                     // Default collapsed in UI
}

interface ToolExecutionBlock {
  type: "tool-execution";
  toolCallId: string;
  roundId: string;                        // Groups concurrent tool calls (same LLM turn)
  toolName: string;
  arguments: Record<string, unknown>;
  argumentsStreaming?: string;            // Partial args while still streaming
  mcpServerName?: string;
  status: "pending" | "validating" | "running" | "complete" | "error";
  result?: ToolResult;
  error?: string;
  partialOutput?: string;                // Streaming tool output
  progressMessage?: string;              // Progress updates during execution
  duration?: number;
  isHistorical: boolean;                 // True for past turns — prevents re-invocation display
}

interface ToolResult {
  content: string;                        // Concise result (shown by default)
  detailedContent?: string;               // Full result (expandable, includes diffs)
  contents?: ToolResultContent[];         // Structured result blocks
}

type ToolResultContent =
  | { type: "text"; text: string }
  | { type: "terminal"; text: string; exitCode?: number; cwd?: string }
  | { type: "image"; data: string; mimeType: string }     // base64
  | { type: "resource_link"; uri: string; title?: string };

interface SubagentBlock {
  type: "subagent";
  toolCallId: string;
  agentName: string;
  agentDisplayName: string;
  agentDescription?: string;
  status: "running" | "complete" | "failed";
  error?: string;
  duration?: number;
  nestedBlocks?: ContentBlock[];          // Subagent's own tool calls, text, diffs
}

interface FileDiffBlock {
  type: "file-diff";
  fileName: string;
  diff: string;                           // Unified diff format
  newFileContents?: string;               // For newly created files
  intention?: string;                     // Why the edit was made
  isNewFile: boolean;
  edits: FileEdit[];                      // Incremental edits (accumulated before "done")
  isDone: boolean;                        // True when all edits for this file are complete
}

interface FileEdit {
  range: { startLine: number; endLine: number };
  newText: string;
}

interface ConfirmationBlock {
  type: "confirmation";
  requestId: string;
  title: string;
  message: string;
  permissionKind: "shell" | "write" | "read" | "mcp" | "url" | "custom-tool";
  diff?: string;                          // For write permissions — inline diff preview
  status: "pending" | "approved" | "denied";
}

interface ProgressBlock {
  type: "progress";
  message: string;                        // e.g., "Searching codebase..."
}

interface WarningBlock {
  type: "warning";
  message: string;
}

interface CompactionBlock {
  type: "compaction";
  tokensRemoved: number;
  summary?: string;
  checkpointPath?: string;
}

interface ImageBlock {
  type: "image";
  data: string;                           // base64
  mimeType: string;
  alt?: string;
}

interface TerminalBlock {
  type: "terminal";
  text: string;
  exitCode?: number;
  cwd?: string;
}

// ── Chat Message ──────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  parentId?: string;                      // For conversation tree / revision chain
  role: "user" | "assistant" | "system";
  blocks: ContentBlock[];                 // Ordered sequence of typed content blocks
  timestamp: string;
  attachments?: Attachment[];             // User message attachments (input side)
  isStreaming: boolean;                   // True while assistant turn is in progress
}

// ── Attachments (user input) ──────────────────────────────────────

type Attachment =
  | FileAttachment
  | DirectoryAttachment
  | SelectionAttachment;

interface FileAttachment {
  type: "file";
  path: string;
  displayName?: string;
}

interface DirectoryAttachment {
  type: "directory";
  path: string;
  displayName?: string;
}

interface SelectionAttachment {
  type: "selection";
  filePath: string;
  displayName?: string;
  selection: { start: { line: number; character: number }; end: { line: number; character: number } };
  text: string;
}
```

#### 6.5.1 Content Block Rendering (`ChatContentBlock.tsx`)

The `ChatContentBlock` component is a switch renderer over the `ContentBlock` discriminated union. Each variant delegates to a specialized component:

| Block Type | Component | Behavior |
|------------|-----------|----------|
| `text` | Inline markdown renderer | Renders markdown with syntax highlighting for code blocks |
| `reasoning` | `ChatReasoningBlock` | Collapsed by default, shows token count badge (e.g., "842 tokens"), expand to reveal thinking |
| `tool-execution` | `ChatToolExecution` | State machine card: pending → validating → running (with streaming args + partial output) → complete/error. Historical blocks show muted styling, no spinner |
| `subagent` | `ChatSubagentBlock` | Collapsible card with nested `ContentBlock[]` for the subagent's own tool calls and text |
| `file-diff` | `ChatFileDiff` | Unified diff view. Accumulates incremental `FileEdit[]` until `isDone`. Green/red line highlighting, line numbers |
| `confirmation` | `ChatPermissionDialog` (inline or modal) | Shows permission kind, diff preview for writes, approve/deny buttons. Resolves to `approved`/`denied` status |
| `progress` | `ChatProgressIndicator` | Animated dots or spinner with message text |
| `warning` | Styled alert | Yellow warning banner |
| `compaction` | `ChatCompactionNotice` | Inline divider: "Context compacted — {tokensRemoved} tokens freed" |
| `image` | `<img>` with lightbox | Click to expand, shows alt text |
| `terminal` | Monospace output block | Dark background, shows exit code badge if non-zero |

#### 6.5.2 Tool Execution State Machine

Tool execution follows a five-phase lifecycle (adapted from VS Code Copilot Chat's tool calling flow):

```
┌─────────┐     ┌─────────────┐     ┌─────────┐     ┌──────────┐
│ pending  │────►│ validating  │────►│ running  │────►│ complete │
└─────────┘     └──────┬──────┘     └────┬─────┘     └──────────┘
                       │                  │
                       ▼                  ▼
                  ┌─────────┐        ┌─────────┐
                  │  error  │        │  error  │
                  └─────────┘        └─────────┘
```

1. **pending** — Tool call received from LLM, arguments may still be streaming (`argumentsStreaming` field accumulates partial JSON)
2. **validating** — Arguments complete, pre-execution validation running (preToolUse hook check, permission request if needed)
3. **running** — Tool executing. `partialOutput` accumulates streaming results, `progressMessage` shows status updates
4. **complete** — Tool finished successfully. `result` contains concise + detailed content + structured blocks
5. **error** — Validation failed or execution errored. `error` field contains message

**Historical flag**: When loading conversation history via `session.getMessages()`, all tool execution blocks are marked `isHistorical: true`. The UI renders these with:
- Muted styling (no spinner, no animation)
- No re-invocation controls
- Result shown immediately (no expand animation)
- Flex-shrink priority: historical results may be truncated to save space for recent ones

#### 6.5.3 Parallel Tool Call Rendering

When the LLM calls multiple tools simultaneously, they share the same `roundId`. The `ChatMessageList` groups consecutive `ToolExecutionBlock` entries with the same `roundId` into a **ToolCallRound card**:

```
┌─ Round: 3 tools ──────────────────────────────────────┐
│ ✓ read_file      packages/worker-service/src/core/... │  ← complete (collapsed)
│ ✓ read_file      packages/cli/src/commands/start.ts   │  ← complete (collapsed)
│ ● get_observations  { project: "my-project" }         │  ← running (spinner)
└───────────────────────────────────────────────────────┘
```

**Rendering rules**:
- Tools within a round are **stacked vertically** in a single card with a shared border
- Round header shows count: "Round: {n} tools"
- Each tool row shows: status icon (spinner/checkmark/error) + tool name + concise argument summary
- Clicking a tool row expands it to show full arguments + result (accordion)
- When all tools in a round are complete, the round auto-collapses to a single summary line: "✓ 3 tools completed (1.2s)"
- Historical rounds (from loaded conversation) start collapsed
- Rounds with a single tool render as a regular `ChatToolExecution` card (no round wrapper)

**Store handling**: The `activeTools` Map tracks all concurrent tools. The `ChatMessageList` component groups `blocks` by `roundId` before rendering:

```typescript
// Group consecutive tool blocks by roundId
function groupToolRounds(blocks: ContentBlock[]): (ContentBlock | ToolRound)[] {
  // Adjacent tool-execution blocks with same roundId → ToolRound group
  // Non-tool blocks and lone tools pass through unchanged
}
```

#### 6.6 Message Revision

Users can click "Revise" on any previous user message to branch the conversation from that point. The original session is **preserved** (not deleted) — revision creates a fork.

**Branching flow** (inspired by VS Code Copilot Chat's append-only JSONL chain model):

1. User clicks "Revise" on a past user message at position N
2. UI creates a **new session** via `POST /api/{pid}/chat/sessions` with `{ model, branchFrom: { sessionId, messageIndex: N } }`
3. Worker creates a new SDK session, injects the same system prompt context
4. Worker replays conversation history up to message N-1 as context (using SDK's session creation with prior history injection)
5. User edits the message at position N and sends the revised version
6. New session continues from the revised point

**Original session**: Remains intact in the session list. The new session's metadata includes `branchedFrom: { sessionId, messageIndex, timestamp }` so the UI can show the lineage.

**Session list display**: Branched sessions show a subtle "Branched from: {originalTitle}" link. Clicking navigates to the original.

**Historical blocks**: When replaying messages into the new session, all `ToolExecutionBlock` entries are marked `isHistorical: true` so the UI renders them in muted style without spinners or re-invocation controls. Historical tool results may be truncated to save context window tokens.

#### 6.7 File Diff Display

File diffs use an **incremental accumulation model** (inspired by VS Code Copilot Chat's `textEdit()` streaming pattern). The SDK may emit multiple sequential edits to the same file before signaling completion:

**Accumulation flow**:
1. `permission.requested` with `kind: "write"` → create `FileDiffBlock` with `isDone: false`, populate `diff` preview
2. `tool.execution_partial_result` → append to `FileDiffBlock.edits[]` array
3. `tool.execution_complete` → set `isDone: true`, finalize `diff` from accumulated edits

**Rendering**:
- While `isDone: false`: show animated skeleton with "Editing {fileName}..." label
- When `isDone: true`: render unified diff view with green/red highlighting, line numbers
- Group consecutive `FileDiffBlock` entries for the same `fileName` into a single card
- Show the `intention` field as a header above the diff
- For new files (`isNewFile: true`), show full content with all-green highlighting

Uses a lightweight diff renderer component — parse unified diff format, render with Tailwind classes (no heavy dependency like `react-diff-viewer`). Line-level highlighting:
- `bg-red-950/30 text-red-400` for removed lines
- `bg-green-950/30 text-green-400` for added lines
- Line numbers in `text-muted-foreground` gutter

#### 6.8 Streaming Buffer & Render Optimization

High-frequency Socket.IO events (especially `message-delta` and `reasoning-delta` during fast streaming) can cause excessive React re-renders. The store uses a **buffered accumulation pattern** (inspired by VS Code Copilot Chat's `FetchStreamSource` pause/resume mechanism):

```typescript
// Inside chat-store.ts — Socket.IO event handler

let deltaBuffer = "";
let rafId: number | null = null;

function onMessageDelta(delta: string) {
  deltaBuffer += delta;

  // Coalesce updates into animation frames (16ms batches)
  if (!rafId) {
    rafId = requestAnimationFrame(() => {
      set({ streamingContent: get().streamingContent + deltaBuffer });
      deltaBuffer = "";
      rafId = null;
    });
  }
}
```

**Rules**:
- `message-delta` and `reasoning-delta` are buffered and flushed on `requestAnimationFrame` (~60fps)
- `tool-start`, `tool-complete`, `permission-request` are applied immediately (state transitions)
- `turn-start` resets buffer state; `turn-end` flushes any remaining buffer
- When the browser tab is hidden (`document.hidden`), buffer accumulates without flushing until the tab becomes visible again

**Time-to-first-token (TTFT)**: The store tracks when `turn-start` fires and when the first `message-delta` arrives. This metric is exposed in `ChatContextBar`.

#### 6.9 Auto-Scroll Behavior

During streaming, `ChatMessageList` auto-scrolls to keep the latest content visible:

- **User at bottom** (within 50px of scroll end): auto-scroll active, new content always visible
- **User scrolled up**: auto-scroll pauses, floating "↓ New messages" button appears at bottom-right
- Clicking the button scrolls to bottom and re-enables auto-scroll
- `turn-start` event re-engages auto-scroll (new assistant turn = user likely wants to see it)
- `permission-request` always scrolls to bottom (requires user action)

Implementation: `useRef` on scroll container + `IntersectionObserver` on a sentinel element at the bottom.

#### 6.10 Copy Actions

| Target | Trigger | What's Copied |
|--------|---------|---------------|
| Assistant message | "Copy" button on hover | Full markdown text (blocks concatenated) |
| Code block | Copy icon on code block header | Raw code content (no markdown fences) |
| Tool result | Copy icon in tool card | `result.content` (concise) or `result.detailedContent` (expanded) |
| Terminal output | Copy icon in terminal block | Raw terminal text |
| File diff | Copy icon in diff card | Unified diff text |
| User message | "Copy" on hover | Original prompt text |

All copy actions use `navigator.clipboard.writeText()` with a brief "Copied" toast (1.5s).

#### 6.11 Empty States

| State | What's Shown |
|-------|-------------|
| **Copilot CLI not installed** | Icon + "Copilot CLI Required" + install instructions link + "Check Again" button |
| **Copilot CLI auth expired** | Icon + "GitHub Authentication Required" + "Run `copilot auth login` in terminal" |
| **No sessions yet** | Centered illustration + "Start a conversation" + model selector + large input field |
| **Session loading** | Skeleton placeholders for message list |
| **Model list loading** | Skeleton dropdown |
| **Session error** | Error banner with "Retry" button + option to create new session |
| **Socket.IO disconnected** | Yellow reconnection banner (same pattern as ADR-045 graceful degradation). Socket.IO auto-reconnects with exponential backoff (ADR-048) |

The "no sessions" empty state doubles as the new session creation form — selecting a model and typing a message creates the session implicitly.

#### 6.12 Message List Virtualization

For long conversations (100+ messages), `ChatMessageList` uses **virtualized rendering** (`react-window` or `@tanstack/virtual`) to render only visible messages:

- Window size: viewport height of the chat panel
- Estimated item height: varies by block type (text ≈ 80px, tool card ≈ 120px, diff ≈ 200px)
- Dynamic height measurement via `ResizeObserver` after render
- Scroll position preserved on window resize
- The currently streaming message is always rendered (outside virtual list) at the bottom
- Historical messages above the fold are virtualized

This prevents DOM bloat for conversations with many tool calls and file diffs.

#### 6.13 Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift+Enter` | Newline in input |
| `Escape` | Cancel generation (if streaming) / Close modal (if open) |
| `Ctrl/Cmd+N` | New session |
| `Ctrl/Cmd+Shift+C` | Copy last assistant message |
| `Up` (in empty input) | Edit last user message (trigger revision) |

### 7. Extension LLM Access (`ScopedLLM`)

Extensions currently receive `ScopedDatabase` for data and `MCPClient` for tool servers. This ADR adds a third scoped resource: **`ScopedLLM`** — a scoped interface to the Copilot SDK that lets extensions call the LLM programmatically.

#### 7.1 ScopedLLM Interface

```typescript
// @renre-kit/extension-sdk — new LLM types

export interface ScopedLLM {
  /**
   * List models available through the Copilot SDK.
   */
  listModels(): Promise<LLMModelInfo[]>;

  /**
   * Send a single prompt and get a complete response (non-streaming).
   * Uses an ephemeral session scoped to this extension.
   */
  complete(request: LLMCompleteRequest): Promise<LLMCompleteResponse>;

  /**
   * Send a prompt and receive streaming events via callback.
   * Uses an ephemeral session scoped to this extension.
   */
  stream(request: LLMStreamRequest, handler: LLMStreamHandler): Promise<void>;

  /**
   * Create a managed chat session for multi-turn conversations.
   * Session is scoped to this extension and cleaned up on extension unload.
   */
  createSession(opts?: LLMSessionOpts): Promise<LLMSession>;
}

export interface LLMModelInfo {
  id: string;
  name: string;
  supportsVision: boolean;
  supportsReasoning: boolean;
  supportedReasoningEfforts?: ("low" | "medium" | "high" | "xhigh")[];
  maxContextTokens: number;
}

export interface LLMCompleteRequest {
  prompt: string;
  model?: string;                         // Default: user's preferred model
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  systemPrompt?: string;
  attachments?: LLMAttachment[];
  maxTokens?: number;                     // Response token limit
}

export interface LLMCompleteResponse {
  content: string;
  reasoning?: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
}

export interface LLMStreamRequest extends LLMCompleteRequest {}

export interface LLMStreamHandler {
  onDelta?(delta: string): void;
  onReasoningDelta?(delta: string): void;
  onComplete?(response: LLMCompleteResponse): void;
  onError?(error: Error): void;
}

export interface LLMSessionOpts {
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  systemPrompt?: string;
  tools?: LLMToolDefinition[];            // Extension-defined tools for the session
}

export interface LLMSession {
  readonly sessionId: string;
  send(prompt: string, attachments?: LLMAttachment[]): Promise<LLMCompleteResponse>;
  stream(prompt: string, handler: LLMStreamHandler, attachments?: LLMAttachment[]): Promise<void>;
  getMessages(): Promise<LLMSessionMessage[]>;
  disconnect(): Promise<void>;
}

export interface LLMSessionMessage {
  role: "user" | "assistant" | "system";
  content: string;
  reasoning?: string;
  timestamp: string;
}

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;    // JSON Schema
  handler: (args: Record<string, unknown>) => Promise<{ result: string }>;
}

export interface LLMAttachment {
  type: "file" | "directory" | "selection";
  path: string;
  displayName?: string;
}
```

#### 7.2 ExtensionContext Update (amends ADR-019)

`ExtensionContext` gains the `llm` field, gated by a new `llm` permission:

```typescript
export interface ExtensionContext {
  projectId: string;
  db: ScopedDatabase | null;        // null if no `database` permission
  logger: ExtensionLogger;
  config: Record<string, string>;
  mcp: MCPClient | null;            // null if no `mcp` config
  llm: ScopedLLM | null;            // null if no `llm` permission ← NEW
}
```

**Manifest permission declaration:**

```json
{
  "permissions": {
    "database": true,
    "llm": true
  }
}
```

`ExtensionPermissions` type update:

```typescript
export interface ExtensionPermissions {
  database?: boolean;
  network?: string[];
  mcp?: boolean;
  hooks?: HookEvent[];
  vault?: string[];
  filesystem?: string[];
  llm?: boolean;                    // ← NEW: grants access to ScopedLLM
}
```

Displayed at install time: **"This extension requests LLM access (can send prompts to Copilot models)"**.

#### 7.3 ScopedLLM Implementation (Worker Side)

The worker creates a `ScopedLLM` proxy per extension at mount time, backed by the shared `CopilotBridge`:

```typescript
// packages/worker-service/src/core/scoped-llm.ts

class ScopedLLMImpl implements ScopedLLM {
  constructor(
    private bridge: CopilotBridge,
    private extensionName: string,
    private projectId: string,
    private logger: ExtensionLogger
  ) {}

  async listModels(): Promise<LLMModelInfo[]> {
    return this.bridge.listModels();
  }

  async complete(request: LLMCompleteRequest): Promise<LLMCompleteResponse> {
    this.logger.debug(`LLM complete request`, { model: request.model });
    // Creates an ephemeral SDK session, sends prompt, waits for response, disconnects
    const session = await this.bridge.createEphemeralSession({
      model: request.model,
      systemPrompt: request.systemPrompt,
      source: `extension:${this.extensionName}`,
    });
    try {
      const response = await session.sendAndWait({ prompt: request.prompt });
      return {
        content: response.content,
        reasoning: response.reasoning,
        model: response.model,
        usage: response.usage,
      };
    } finally {
      await session.disconnect();
    }
  }

  async stream(request: LLMStreamRequest, handler: LLMStreamHandler): Promise<void> {
    // Similar to complete() but attaches streaming listeners before sending
    // ...
  }

  async createSession(opts?: LLMSessionOpts): Promise<LLMSession> {
    // Creates a persistent session tracked by extension name for cleanup
    const session = await this.bridge.createManagedSession({
      ...opts,
      source: `extension:${this.extensionName}`,
      projectId: this.projectId,
    });
    // Register for cleanup when extension unloads
    this.bridge.trackExtensionSession(this.extensionName, session.sessionId);
    return session;
  }
}
```

**Lifecycle**: When an extension is unloaded (uninstall, project switch, circuit breaker suspension), all its managed sessions are disconnected automatically. Ephemeral sessions (from `complete()`/`stream()`) are cleaned up immediately after each call.

#### 7.4 Extension Use Cases

**Summarization in a custom action:**
```typescript
const factory: ExtensionRouterFactory = (ctx) => {
  const router = Router();

  router.post("/summarize", async (req, res) => {
    const { text } = req.body;
    const result = await ctx.llm!.complete({
      prompt: `Summarize the following:\n\n${text}`,
      model: "claude-sonnet-4-5",
      maxTokens: 500,
    });
    res.json({ summary: result.content });
  });

  return router;
};
```

**Multi-turn analysis with streaming:**
```typescript
router.post("/analyze-codebase", async (req, res) => {
  const session = await ctx.llm!.createSession({
    systemPrompt: "You are a code analysis expert.",
    tools: [{
      name: "query_db",
      description: "Query extension database",
      parameters: { type: "object", properties: { sql: { type: "string" } } },
      handler: async ({ sql }) => {
        const rows = ctx.db!.prepare(sql as string).all();
        return { result: JSON.stringify(rows) };
      },
    }],
  });

  await session.send("Analyze the error patterns in the database");
  const analysis = await session.send("Now suggest fixes for the top 3 issues");
  await session.disconnect();

  res.json({ analysis: analysis.content });
});
```

**Context provider with LLM enrichment (ADR-036):**
```typescript
// Extension's context provider can use LLM to summarize context
export async function provide(request: ContextRequest): Promise<ContextResponse> {
  const rawData = fetchFromExternalService(request.projectId);
  const summary = await ctx.llm!.complete({
    prompt: `Summarize these items for an AI agent context window (max ${request.tokenBudget} tokens):\n${rawData}`,
    maxTokens: request.tokenBudget,
  });
  return {
    content: summary.content,
    estimatedTokens: summary.usage.completionTokens,
    itemCount: 1,
    truncated: false,
  };
}
```

#### 7.5 Hook Integration

Chat sessions (both user-facing Console Chat and extension `ScopedLLM` sessions) participate in the hook lifecycle. When a session is created with a `projectId`, the CopilotBridge registers hook handlers that route through the existing hook system (ADR-026, ADR-037):

```typescript
hooks: {
  onSessionStart: async (input) => {
    const response = await hookRequestQueue.enqueue("sessionStart", projectId, input);
    return { additionalContext: response.context };
  },
  onPreToolUse: async (input) => {
    const response = await hookRequestQueue.enqueue("preToolUse", projectId, input);
    return {
      permissionDecision: response.decision,  // "allow" | "deny" | "ask"
      additionalContext: response.context
    };
  },
  onPostToolUse: async (input) => {
    const response = await hookRequestQueue.enqueue("postToolUse", projectId, input);
    return { additionalContext: response.context };
  },
  // ... all 9 hook events
}
```

This means extensions that register hook handlers (tool governance, error intelligence, observations) automatically apply to:
- **Console Chat sessions** — user-facing chat in the UI
- **Extension LLM sessions** — programmatic sessions created via `ScopedLLM.createSession()`
- **Extension ephemeral calls** — `ScopedLLM.complete()` and `ScopedLLM.stream()` (hooks fire but no session persistence)

Hook source is tagged (`source: "console-chat"` vs `source: "extension:{name}"`) so extensions can differentiate if needed.

### 8. Extension Tools & Custom Agents (amends ADR-019, ADR-020)

Extensions can expose **tools** and **custom agents** to chat sessions via their manifest. When a chat session is created for a project, all installed extensions' tools and agents are registered with the SDK session.

#### 8.1 Manifest Extension — `chatTools` and `chatAgents`

```json
{
  "name": "jira-integration",
  "chatTools": [
    {
      "name": "get_jira_issues",
      "description": "Search and retrieve Jira issues for the current project",
      "parameters": {
        "type": "object",
        "properties": {
          "query": { "type": "string", "description": "JQL query or keyword search" },
          "status": { "type": "string", "enum": ["open", "in-progress", "done", "all"] },
          "limit": { "type": "number", "default": 10 }
        },
        "required": ["query"]
      },
      "endpoint": "GET /issues"
    },
    {
      "name": "create_jira_issue",
      "description": "Create a new Jira issue",
      "parameters": {
        "type": "object",
        "properties": {
          "title": { "type": "string" },
          "description": { "type": "string" },
          "type": { "type": "string", "enum": ["bug", "story", "task"] }
        },
        "required": ["title", "type"]
      },
      "endpoint": "POST /issues"
    }
  ],
  "chatAgents": [
    {
      "name": "jira-planner",
      "displayName": "Jira Sprint Planner",
      "description": "Plans sprint work by analyzing Jira backlog and suggesting story assignments",
      "prompt": "You are a sprint planning expert. Use the Jira tools to analyze the backlog...",
      "tools": ["get_jira_issues", "create_jira_issue"]
    }
  ]
}
```

#### 8.2 Tool Bridging (Worker Side)

`CopilotBridge.buildExtensionTools()` converts manifest `chatTools` into Copilot SDK `defineTool()` calls. Each tool's handler calls the extension's backend route:

```typescript
function buildExtensionTools(projectId: string): ToolDefinition[] {
  const extensions = extensionRegistry.getLoaded(projectId);
  const tools: ToolDefinition[] = [];

  for (const ext of extensions) {
    for (const tool of ext.manifest.chatTools ?? []) {
      tools.push(defineTool(`${ext.name}__${tool.name}`, {
        description: tool.description,
        parameters: z.object(tool.parameters),  // JSON Schema → Zod
        handler: async (args) => {
          // Call extension's backend route
          const [method, path] = tool.endpoint.split(" ");
          const response = await fetch(
            `http://localhost:${port}/api/${projectId}/${ext.name}${path}`,
            { method, body: method !== "GET" ? JSON.stringify(args) : undefined }
          );
          const data = await response.json();
          return { textResultForLlm: JSON.stringify(data), resultType: "success" };
        },
      }));
    }
  }
  return tools;
}
```

Tool names are namespaced: `jira-integration__get_jira_issues` to avoid collisions between extensions.

#### 8.3 Custom Agent Bridging

`CopilotBridge.buildCustomAgents()` converts manifest `chatAgents` into SDK `customAgents` config:

```typescript
function buildCustomAgents(projectId: string): CustomAgentConfig[] {
  const extensions = extensionRegistry.getLoaded(projectId);
  const agents: CustomAgentConfig[] = [];

  for (const ext of extensions) {
    for (const agent of ext.manifest.chatAgents ?? []) {
      agents.push({
        name: `${ext.name}__${agent.name}`,
        displayName: agent.displayName,
        description: agent.description,
        prompt: agent.prompt,
        tools: agent.tools.map(t => `${ext.name}__${t}`),  // Namespace tool refs
      });
    }
  }
  return agents;
}
```

### 9. Console Built-in Tools

The worker registers **built-in tools** that give the LLM access to RenRe Kit's intelligence data. These are always available in chat sessions (no extension needed):

| Tool Name | Description | Maps To |
|-----------|-------------|---------|
| `get_project` | Get project info, installed extensions, status | `GET /api/{pid}/` |
| `get_sessions` | List recent AI sessions with summaries | `GET /api/{pid}/sessions` (ADR-027) |
| `get_observations` | Get active observations for project | `GET /api/{pid}/observations` (ADR-028) |
| `get_tool_rules` | Get tool governance rules | `GET /api/{pid}/tool-rules` (ADR-029) |
| `get_prompts` | Search prompt journal entries | `GET /api/{pid}/prompts` (ADR-030) |
| `get_errors` | Get error fingerprints and patterns | `GET /api/{pid}/errors` (ADR-031) |
| `get_tool_analytics` | Get tool usage statistics | `GET /api/{pid}/tool-analytics` (ADR-032) |
| `get_context_recipes` | Get context recipe configuration | `GET /api/{pid}/context-recipe` (ADR-035) |
| `search` | Full-text search across all intelligence data | `GET /api/{pid}/search` (ADR-038) |
| `get_subagents` | Get subagent execution history | `GET /api/{pid}/subagents` (ADR-034) |
| `get_extension_status` | Get status of installed extensions | `GET /api/{pid}/extensions` |

```typescript
function buildBuiltInTools(projectId: string): ToolDefinition[] {
  return [
    defineTool("get_observations", {
      description: "Get active observations for this project — patterns, notes, and reminders captured by extensions and AI sessions",
      parameters: z.object({
        category: z.string().optional().describe("Filter by category"),
        limit: z.number().default(20),
      }),
      handler: async (args) => {
        const res = await fetch(`http://localhost:${port}/api/${projectId}/observations?${qs(args)}`);
        return { textResultForLlm: await res.text(), resultType: "success" };
      },
    }),
    // ... same pattern for all built-in tools
  ];
}
```

This enables conversations like:
- "What errors have been happening in this project?" → LLM calls `get_errors`
- "Show me tool usage trends" → LLM calls `get_tool_analytics`
- "Find all sessions related to auth" → LLM calls `search` with query "auth"
- "What are the current tool governance rules?" → LLM calls `get_tool_rules`

### 10. Session Storage

Chat session IDs are managed by the Copilot SDK (persisted by Copilot CLI). RenRe Kit stores minimal metadata in the browser:

```typescript
// localStorage keys (per-project)
"renre-chat-active-session:{projectId}"   // Current active session ID
"renre-chat-preferences:{projectId}"      // { model, effort }
```

The worker does **not** persist chat messages in SQLite — the Copilot SDK/CLI owns message persistence. The worker only maintains in-memory `CopilotSession` references for active sessions.

Session list is populated from `client.listSessions({ cwd: projectPath })` — filtered by project working directory.

### 11. Permission & Input Handling

When the SDK raises `permission.requested` or `user_input.requested`:

1. Event emitted to `chat:{sessionId}` room via Socket.IO
2. UI shows inline dialog (`ChatPermissionDialog` or `ChatInputDialog`)
3. User approves/denies or provides input
4. UI sends response via Socket.IO (`chat:permission` or `chat:input`)
5. Worker resolves the SDK's pending callback

Permission kinds from the SDK: `shell`, `write`, `read`, `mcp`, `url`, `custom-tool`.

For `write` permissions, the dialog shows the file diff inline so users can review changes before approving.

### 12. Context Window Awareness

The SDK emits `session.usage_info` with context window utilization percentage. The Chat UI shows this as a progress bar in the `ChatContextBar`:

- **0-60%**: Green
- **60-80%**: Yellow (+ ADR-040 `/learn` suggestion at 65%)
- **80-95%**: Orange (compaction may start for infinite sessions)
- **95%+**: Red (blocked until compaction completes)

When `session.compaction_start` fires, show an inline `ChatCompactionNotice` in the message feed.

### 13. Intelligence Integration

Chat sessions feed into and consume from the existing intelligence system:

| Intelligence System | Chat Feeds Into | Chat Consumes From |
|--------------------|-----------------|--------------------|
| **Sessions** (ADR-027) | `sessionEnd` hook captures chat session summary, files modified, tool usage | System prompt includes last 3 session summaries |
| **Observations** (ADR-028) | Extensions can create observations from chat interactions | LLM calls `get_observations` built-in tool |
| **Tool Governance** (ADR-029) | `preToolUse` hook enforces rules on chat tool calls | LLM calls `get_tool_rules` to understand restrictions |
| **Prompt Journal** (ADR-030) | User prompts logged to journal | LLM calls `get_prompts` to find past conversations |
| **Error Intelligence** (ADR-031) | `errorOccurred` hook captures chat errors | System prompt includes error fingerprints |
| **Tool Analytics** (ADR-032) | `postToolUse` hook tracks tool usage | LLM calls `get_tool_analytics` for trends |
| **Subagent Tracking** (ADR-034) | `subagentStart/Stop` hooks track spawned agents | LLM calls `get_subagents` for history |
| **FTS Search** (ADR-038) | Chat content indexed for search | LLM calls `search` tool |
| **Context Recipes** (ADR-035) | N/A | System prompt assembled via recipe engine |

**Console UI cross-linking**: Chat sessions appear in the Sessions timeline page. Tool calls from chat appear in Tool Analytics. Errors from chat appear in Error Intelligence. Each intelligence page includes a "View in Chat" link that navigates to the originating chat session and message.

## Consequences

### Positive
- Users get LLM chat inside Console UI with full project context — no context switching
- Chat is project-scoped — inherits extensions, hooks, tools, and context automatically
- Extensions expose tools and agents via manifest — LLM can call extension actions directly
- Built-in tools give the LLM access to all intelligence data (observations, errors, analytics, etc.)
- Extensions get `ScopedLLM` for programmatic LLM access — consistent SDK contract
- Bidirectional intelligence integration — chat both feeds into and consumes from the intelligence system
- Socket.IO (ADR-048) provides efficient bidirectional communication with session-scoped rooms on a single shared connection
- Cancel generation gives users control over long-running or expensive responses
- Lazy CopilotBridge initialization prevents blocking worker startup
- Typed content blocks provide a composable, extensible rendering model
- Tool call rounds visualize parallel tool execution clearly
- Revision preserves original sessions (branch model, not destructive)
- Message list virtualization handles long conversations efficiently
- No API key management — leverages existing Copilot CLI authentication

### Negative
- Dependency on Copilot CLI being installed and authenticated on the user's machine
- Worker service now manages long-lived child processes (Copilot CLI via stdio) + Socket.IO connections
- Socket.IO adds a dependency (`socket.io` + `socket.io-client`), though this is shared with all real-time features (ADR-048)
- localStorage session metadata can diverge from Copilot CLI's session list
- Content block discriminated union adds type complexity — every new block type requires a renderer
- Extensions with `llm` permission can generate unbounded API usage — no built-in rate limiting in v1
- Tool namespace prefix (`extname__toolname`) is verbose in LLM context window

### Risks
- Copilot SDK is evolving — API surface may change between versions
- stdio transport reliability for long-running sessions (process crashes, OOM). Mitigation: auto-restart (§2.2)
- Large file attachments could strain the JSON-RPC transport
- Extension LLM abuse — mitigated by circuit breaker; future: per-extension token budgets
- Manifest `chatTools` increase attack surface — malicious tool descriptions could manipulate LLM behavior

## Alternatives Considered

1. **Direct API calls from browser** — Rejected: requires API keys in browser, can't integrate with hooks/context recipes server-side
2. **Embed Copilot Chat iframe** — Rejected: no control over UI, no hook integration
3. **SSE for chat events** — Rejected: chat requires bidirectional communication (cancel, permission responses). All real-time events now unified under Socket.IO (ADR-048, supersedes ADR-023)
4. **Store messages in SQLite** — Rejected for now: Copilot SDK owns persistence. Could revisit if offline access is needed
5. **Global (non-project-scoped) chat** — Rejected: project context is essential for tool access, hook integration, and intelligence data. Users select project at session creation

## References

- [GitHub Copilot SDK](https://github.com/github/copilot-sdk) — `@github/copilot-sdk`
- ADR-019: Extension SDK Contract (amended: `ExtensionContext.llm`, `ExtensionPermissions.llm`, `chatTools`, `chatAgents`)
- ADR-020: Manifest Validation (amended: validate `chatTools` schema, `chatAgents` tool references)
- ADR-023: Real-Time Worker-UI Communication (superseded by ADR-048)
- ADR-048: Socket.IO Real-Time Communication (unified transport for system, project, and chat events)
- ADR-024: Console UI Pages
- ADR-026: Copilot Hooks Integration
- ADR-027: Session Memory & Context Continuity
- ADR-028: Observations System
- ADR-029: Tool Governance
- ADR-030: Prompt Journal
- ADR-031: Agent Error Intelligence
- ADR-032: Tool Usage Analytics
- ADR-034: Subagent Tracking
- ADR-035: Context Recipes
- ADR-036: Extension Context Provider
- ADR-037: Merged Hooks Feature Routing Queue
- ADR-038: FTS5 Full-Text Search
- ADR-040: Learn Skill & Context Monitor
- ADR-045: Console UI Graceful Degradation
