# Phase 5 — Chat UI: Core

## Goal

Implement the core Chat page in Console UI: sidebar entry, chat store, session list, message rendering, message input with file attachments, model/effort selector, and streaming buffer. This phase delivers a functional chat interface without advanced components (tools, diffs, permissions — Phase 6).

## Reference

- ADR-047: Console Chat UI with GitHub Copilot SDK (§6.1-6.4, §6.8, §6.11)
- ADR-048: Socket.IO (chat room events)
- ADR-045: Console UI Graceful Degradation

## Dependencies

- Phase 2 (Socket.IO) — Socket connection and `useSocketStore`
- Phase 4 (Chat Backend) — REST routes and Socket.IO chat events

## Tasks

### 5.1 Add Chat Route and Sidebar Entry

File: `packages/console-ui/src/components/layout/Sidebar.tsx`

- [ ] Add "Chat" menu item under each project section:
  - Icon: `MessageSquare` from Lucide React
  - Path: `/:projectId/chat`
  - Conditionally show disabled/muted state with tooltip "Copilot CLI required" when bridge status is not `"ready"` or `"not-initialized"`
  - Position: after existing project menu items (Extensions, Settings, etc.)

File: `packages/console-ui/src/main.tsx` (or route config)

- [ ] Add lazy-loaded routes:
  ```typescript
  { path: "/:projectId/chat", element: <ChatPage /> }
  { path: "/:projectId/chat/:sessionId", element: <ChatPage /> }
  ```

File: `packages/console-ui/src/routes/chat.tsx`

- [ ] Create `ChatPage` component:
  - Two-panel layout: session list (left, 280px) + chat area (right, flex-1)
  - On mobile/narrow: session list collapses to drawer
  - Route param `sessionId` determines active session
  - If no `sessionId`, show empty state or new-session form

### 5.2 Implement Chat Store

### 5.2a Define Chat Type Definitions

File: `packages/console-ui/src/types/chat.ts`

- [ ] Define the full `ContentBlock` discriminated union and all block interfaces (ADR-047 §6.5):
  ```typescript
  type ContentBlock =
    | TextBlock | ReasoningBlock | ToolExecutionBlock | SubagentBlock
    | FileDiffBlock | ConfirmationBlock | ProgressBlock | WarningBlock
    | CompactionBlock | ImageBlock | TerminalBlock;

  interface TextBlock { type: "text"; content: string; }

  interface ReasoningBlock {
    type: "reasoning"; content: string; tokens?: number; collapsed: boolean;
  }

  interface ToolExecutionBlock {
    type: "tool-execution"; toolCallId: string; roundId: string;
    toolName: string; arguments: Record<string, unknown>;
    argumentsStreaming?: string; mcpServerName?: string;
    status: "pending" | "validating" | "running" | "complete" | "error";
    result?: ToolResult; error?: string; partialOutput?: string;
    progressMessage?: string; duration?: number; isHistorical: boolean;
  }

  interface ToolResult {
    content: string; detailedContent?: string; contents?: ToolResultContent[];
  }

  type ToolResultContent =
    | { type: "text"; text: string }
    | { type: "terminal"; text: string; exitCode?: number; cwd?: string }
    | { type: "image"; data: string; mimeType: string }
    | { type: "resource_link"; uri: string; title?: string };

  interface SubagentBlock {
    type: "subagent"; toolCallId: string; agentName: string;
    agentDisplayName: string; agentDescription?: string;
    status: "running" | "complete" | "failed"; error?: string;
    duration?: number; nestedBlocks?: ContentBlock[];
  }

  interface FileDiffBlock {
    type: "file-diff"; fileName: string; diff: string;
    newFileContents?: string; intention?: string; isNewFile: boolean;
    edits: FileEdit[]; isDone: boolean;
  }

  interface FileEdit {
    range: { startLine: number; endLine: number }; newText: string;
  }

  interface ConfirmationBlock {
    type: "confirmation"; requestId: string; title: string; message: string;
    permissionKind: "shell" | "write" | "read" | "mcp" | "url" | "custom-tool";
    diff?: string; status: "pending" | "approved" | "denied";
  }

  interface ProgressBlock { type: "progress"; message: string; }
  interface WarningBlock { type: "warning"; message: string; }
  interface CompactionBlock {
    type: "compaction"; tokensRemoved: number; summary?: string; checkpointPath?: string;
  }
  interface ImageBlock { type: "image"; data: string; mimeType: string; alt?: string; }
  interface TerminalBlock { type: "terminal"; text: string; exitCode?: number; cwd?: string; }
  ```
- [ ] Define `ChatMessage` interface:
  ```typescript
  interface ChatMessage {
    id: string; parentId?: string;
    role: "user" | "assistant" | "system";
    blocks: ContentBlock[]; timestamp: string;
    attachments?: Attachment[]; isStreaming: boolean;
  }
  ```
- [ ] Define `Attachment` union type:
  ```typescript
  type Attachment = FileAttachment | DirectoryAttachment | SelectionAttachment;

  interface FileAttachment { type: "file"; path: string; displayName?: string; }
  interface DirectoryAttachment { type: "directory"; path: string; displayName?: string; }
  interface SelectionAttachment {
    type: "selection"; filePath: string; displayName?: string;
    selection: { start: { line: number; character: number }; end: { line: number; character: number } };
    text: string;
  }
  ```
- [ ] Define `ToolRound` helper for grouping:
  ```typescript
  interface ToolRound { type: "tool-round"; roundId: string; tools: ToolExecutionBlock[]; }
  ```
- [ ] Define `SessionMetadata`, `ModelInfo`, `ToolExecution`, `SubagentExecution`, `PermissionRequest`, `InputRequest`, `ElicitationRequest` types
- [ ] Export all types for use by store and components

### 5.2b Implement Chat Store

File: `packages/console-ui/src/stores/chat-store.ts`

- [ ] Create `useChatStore` Zustand store:
  ```typescript
  interface ChatState {
    // Bridge status
    bridgeStatus: "not-initialized" | "starting" | "ready" | "error" | "unavailable";
    bridgeError?: string;

    // Sessions (per project)
    sessions: SessionMetadata[];
    activeSessionId: string | null;

    // Models
    models: ModelInfo[];
    selectedModel: string;
    selectedEffort: "low" | "medium" | "high" | "xhigh";

    // Messages (keyed by sessionId)
    messages: Map<string, ChatMessage[]>;

    // Streaming state (buffered)
    streamingContent: string;
    streamingReasoning: string;
    streamingReasoningTokens: number;
    isStreaming: boolean;
    isThinking: boolean;
    ttftMs: number | null;

    // Active tools & subagents (Phase 6 populates)
    activeTools: Map<string, ToolExecution>;
    activeSubagents: Map<string, SubagentExecution>;

    // Pending interactions (Phase 6 populates)
    pendingPermission: PermissionRequest | null;
    pendingInput: InputRequest | null;
    pendingElicitation: ElicitationRequest | null;

    // Context
    contextWindowPct: number;

    // Auto-scroll
    isUserScrolledUp: boolean;
    hasNewMessages: boolean;

    // Actions
    checkBridgeStatus(): Promise<void>;
    fetchModels(): Promise<void>;
    fetchSessions(projectId: string): Promise<void>;
    createSession(projectId: string): Promise<string>;
    resumeSession(sessionId: string): Promise<void>;
    deleteSession(sessionId: string): Promise<void>;
    sendMessage(prompt: string, attachments?: Attachment[]): void;
    cancelGeneration(): void;
    setModel(modelId: string): void;
    setEffort(effort: string): void;
    scrollToBottom(): void;
  }
  ```
- [ ] `checkBridgeStatus()` — fetch `GET /api/chat/status`, update `bridgeStatus`
- [ ] `fetchModels()` — fetch `GET /api/chat/models`, update `models`
- [ ] `fetchSessions(projectId)` — fetch `GET /api/{projectId}/chat/sessions`, update `sessions`
- [ ] `createSession(projectId)` — POST to create, navigate to new session
- [ ] `sendMessage(prompt, attachments)` — emit `chat:send` via Socket.IO, add user message to local state
- [ ] `cancelGeneration()` — emit `chat:cancel` via Socket.IO

### 5.3 Socket.IO Chat Event Binding

File: `packages/console-ui/src/stores/chat-store.ts` (or separate hook)

- [ ] Implement `useChatSocket(sessionId: string | null)` hook:
  - Get `socket` from `useSocketStore`
  - On sessionId change: emit `chat:join` / `chat:leave`
  - Subscribe to streaming events and dispatch to store:
    - `message-delta` → accumulate in `streamingContent` (buffered, Task 5.6)
    - `message` → finalize current assistant message block
    - `reasoning-delta` → accumulate in `streamingReasoning` (buffered)
    - `reasoning` → finalize reasoning block
    - `turn-start` → set `isStreaming = true`, record timestamp for TTFT
    - `turn-end` → set `isStreaming = false`, finalize message
    - `idle` → clear streaming state
    - `error` → show error in chat, set `isStreaming = false`
    - `title-changed` → update session title in sidebar
    - `usage` → update `contextWindowPct`
    - `compaction-start` → add CompactionBlock (in-progress)
    - `compaction-complete` → update CompactionBlock with tokensRemoved, summary
  - Tool events (`tool-start`, `tool-partial`, `tool-progress`, `tool-complete`): update `activeTools` Map
  - Subagent events (`subagent-start`, `subagent-complete`, `subagent-failed`): update `activeSubagents` Map
  - Permission/input/elicitation events: set pending request state (Phase 6 renders dialogs)
  - Cleanup: leave room, remove listeners

### 5.4 Session List Component

File: `packages/console-ui/src/components/chat/ChatSessionList.tsx`

- [ ] Render list of sessions for active project:
  - Each item: title (or "New Chat"), truncated last message, timestamp
  - Active session highlighted
  - Click navigates to `/:projectId/chat/:sessionId`
- [ ] "New Chat" button at top (+ icon)
  - Opens model selector inline or navigates to empty state
- [ ] Session context menu (right-click or "..." button):
  - Rename (edits title)
  - Delete (with confirmation)
- [ ] Sort: most recent first
- [ ] Loading state: skeleton placeholders while `fetchSessions` is in-flight

### 5.5 Message List and Message Components

File: `packages/console-ui/src/components/chat/ChatMessageList.tsx`

- [ ] Render messages for active session from `useChatStore.messages`
- [ ] Each message is a "turn" — user or assistant
- [ ] Auto-scroll to bottom on new content (unless user scrolled up)
- [ ] Implement scroll detection (ADR-047 §6.9):
  - Track `isUserScrolledUp` via scroll event listener
  - Threshold: **50px** from scroll end = "at bottom" (per ADR)
  - New content while scrolled up → set `hasNewMessages = true`
  - `turn-start` event re-engages auto-scroll (new assistant turn = user likely wants to see it)
  - `permission-request` always scrolls to bottom (requires user action)
  - Implementation: `useRef` on scroll container + `IntersectionObserver` on sentinel element at bottom

File: `packages/console-ui/src/components/chat/ChatMessage.tsx`

- [ ] Render a single turn:
  - **User message**: avatar + markdown content + attachments badges
  - **Assistant message**: avatar + array of `ContentBlock` rendered by `ChatContentBlock`
- [ ] Timestamp shown on hover
- [ ] Copy button on message hover (copies full text content)

File: `packages/console-ui/src/components/chat/ChatContentBlock.tsx`

- [ ] Discriminated renderer dispatching on `block.type`:
  ```typescript
  switch (block.type) {
    case "text": return <ChatTextBlock content={block.content} />;
    case "reasoning": return <ChatReasoningBlock ... />;  // Phase 6
    case "tool-execution": return <ChatToolExecution ... />;  // Phase 6
    case "subagent": return <ChatSubagentBlock ... />;  // Phase 6
    case "file-diff": return <ChatFileDiff ... />;  // Phase 6
    case "confirmation": return <ChatPermissionDialog ... />;  // Phase 6
    case "progress": return <ChatProgressIndicator ... />;  // Phase 6
    case "warning": return <ChatWarningBlock ... />;
    case "compaction": return <ChatCompactionNotice ... />;  // Phase 6
    case "image": return <ChatImageBlock ... />;
    case "terminal": return <ChatTerminalBlock ... />;  // Phase 6
  }
  ```
- [ ] Phase 5 implements: `text`, `warning`, `image` blocks
- [ ] Phase 6 implements: all other block types (reasoning, tool-execution, etc.)
- [ ] Placeholder for unimplemented block types: show type badge + raw JSON toggle

File: `packages/console-ui/src/components/chat/ChatTextBlock.tsx`

- [ ] Render markdown content with syntax highlighting for code blocks
- [ ] Use existing markdown renderer or simple `dangerouslySetInnerHTML` with sanitization
- [ ] Code blocks get copy button

File: `packages/console-ui/src/components/chat/ChatNewMessageIndicator.tsx`

- [ ] Floating button: "↓ New messages" — appears when `hasNewMessages && isUserScrolledUp`
- [ ] Click scrolls to bottom and clears `hasNewMessages`
- [ ] Positioned at bottom-center of message list area

### 5.6 Streaming Buffer

In `packages/console-ui/src/stores/chat-store.ts`:

- [ ] Implement `requestAnimationFrame`-based buffered accumulation for deltas:
  ```typescript
  let deltaBuffer = "";
  let reasoningBuffer = "";
  let rafId: number | null = null;

  function onMessageDelta(delta: string) {
    deltaBuffer += delta;
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        set((s) => ({ streamingContent: s.streamingContent + deltaBuffer }));
        deltaBuffer = "";
        rafId = null;
      });
    }
  }

  function onReasoningDelta(delta: string) {
    reasoningBuffer += delta;
    if (!rafId) {
      rafId = requestAnimationFrame(() => {
        set((s) => ({ streamingReasoning: s.streamingReasoning + reasoningBuffer }));
        reasoningBuffer = "";
        rafId = null;
      });
    }
  }
  ```
- [ ] On `turn-end` / `message`: flush remaining buffer immediately, create finalized message
- [ ] When browser tab is hidden (`document.hidden`): accumulate buffer without flushing until tab becomes visible again (prevents wasted renders)
- [ ] Cancel outstanding `rafId` on component unmount or session switch

### 5.7 Chat Input and Model Selector

File: `packages/console-ui/src/components/chat/ChatInput.tsx`

- [ ] Multiline textarea with auto-resize (max 200px height)
- [ ] Send button (or Enter to send, Shift+Enter for newline)
- [ ] Stop button replaces Send during streaming (calls `cancelGeneration()`)
- [ ] File attachment button:
  - Opens file picker
  - Shows attached files as removable chips below textarea
  - Attachment types: file, directory
  - Only show attachment button if selected model supports vision/attachments
- [ ] Disabled state when `bridgeStatus !== "ready"` or no active session
- [ ] Focus input on page load and after sending

File: `packages/console-ui/src/components/chat/ChatModelSelector.tsx`

- [ ] Model dropdown populated from `useChatStore.models`
- [ ] Effort selector (appears when selected model `supportsReasoning`):
  - Options filtered from model's `supportedReasoningEfforts`
  - Default: "medium"
- [ ] Compact layout: model name + effort badge in a single row
- [ ] Changes are stored in `useChatStore` and applied to next session creation

### 5.8 Empty States

File: `packages/console-ui/src/components/chat/ChatEmptyState.tsx`

- [ ] Implement empty states per ADR-047 §6.11:
  | State | Condition | Display |
  |-------|-----------|---------|
  | Copilot CLI not installed | `bridgeStatus === "unavailable"` | Icon + "Copilot CLI Required" + install link + "Check Again" button |
  | Auth expired | `bridgeError` contains auth message | Icon + "GitHub Authentication Required" + terminal command |
  | No sessions yet | `sessions.length === 0` | Centered illustration + "Start a conversation" + model selector + large input |
  | Session loading | `sessions` fetching | Skeleton placeholders |
  | Model list loading | `models` fetching | Skeleton dropdown |
  | Session error | Session-specific error | Error banner + "Retry" + "New Session" |
- [ ] "No sessions" empty state doubles as new session form (model selector + input = implicit session creation on send)
- [ ] "Check Again" button calls `checkBridgeStatus()`

### 5.9 Chat Context Bar

File: `packages/console-ui/src/components/chat/ChatContextBar.tsx`

- [ ] Show context window utilization from `contextWindowPct`:
  - 0-60%: green
  - 60-80%: yellow
  - 80-95%: orange
  - 95%+: red
- [ ] Show TTFT (time-to-first-token) during streaming: `ttftMs`
- [ ] Show model name and effort level
- [ ] Compact bar positioned between session header and message list

### 5.10 Verification

```bash
# Build
pnpm run build

# Start dev server
pnpm --filter @renre-kit/console-ui dev

# Navigate to http://localhost:5173/{projectId}/chat
# Verify:
# - Chat appears in sidebar
# - Empty state shows when no Copilot CLI
# - Model selector loads models (if Copilot available)
# - Can create session and send message
# - Streaming content appears in real time
# - Auto-scroll works, "new messages" indicator appears when scrolled up

# Lint
pnpm run lint
pnpm run lint:duplication
```

## Files Created

```
packages/console-ui/src/types/chat.ts                            — ContentBlock union, ChatMessage, Attachment, ToolResult types
packages/console-ui/src/routes/chat.tsx                          — Chat page (two-panel layout)
packages/console-ui/src/stores/chat-store.ts                     — Chat Zustand store
packages/console-ui/src/components/chat/ChatSessionList.tsx       — Session sidebar
packages/console-ui/src/components/chat/ChatMessageList.tsx       — Message feed
packages/console-ui/src/components/chat/ChatMessage.tsx           — Single message turn
packages/console-ui/src/components/chat/ChatContentBlock.tsx      — Block type dispatcher
packages/console-ui/src/components/chat/ChatTextBlock.tsx         — Markdown text block
packages/console-ui/src/components/chat/ChatInput.tsx             — Message input + attachments
packages/console-ui/src/components/chat/ChatModelSelector.tsx     — Model + effort selector
packages/console-ui/src/components/chat/ChatEmptyState.tsx        — Empty/error states
packages/console-ui/src/components/chat/ChatContextBar.tsx        — Token usage + TTFT
packages/console-ui/src/components/chat/ChatNewMessageIndicator.tsx — Floating scroll button
```

## Files Modified

```
packages/console-ui/src/components/layout/Sidebar.tsx  — Add Chat menu item
packages/console-ui/src/main.tsx                       — Add chat routes
```
