# Phase 4 — CopilotBridge & Chat Backend

## Goal

Implement the worker-service chat backend: CopilotBridge (wrapping Copilot SDK), ScopedLLM proxy, chat REST routes, Socket.IO chat event forwarding, system prompt assembly, and Console built-in tools for the LLM.

## Reference

- ADR-047: Console Chat UI with GitHub Copilot SDK (§2-5, §8, §10, §11, §13)
- ADR-048: Socket.IO Real-Time Communication (chat room events)
- ADR-035: Context Recipes
- ADR-026: Copilot Hooks Integration

## Dependencies

- Phase 2 (Socket.IO Migration) — Socket bridge must be in place for chat events
- Phase 3 (Extension SDK Types) — ScopedLLM interface must be defined

## Tasks

### 4.1 Add Copilot SDK Dependency

- [ ] Add `@github/copilot-sdk` to `packages/worker-service/package.json`
- [ ] Run `pnpm install`
- [ ] Verify import works: `import { CopilotClient } from "@github/copilot-sdk"`

### 4.2 Implement CopilotBridge

File: `packages/worker-service/src/core/copilot-bridge.ts`

- [ ] Export `CopilotBridge` class as module-level singleton (lazy-initialized)
- [ ] Implement `ensureStarted()` — lazy initialization:
  - Check if Copilot CLI is available (`which copilot` or `copilot --version`)
  - Create `CopilotClient` with stdio transport
  - Set `status = "ready"`
  - On failure, set `status = "unavailable"` with error message
  - Subsequent calls return immediately if already started
- [ ] Implement state machine: `"not-initialized" | "starting" | "ready" | "error" | "unavailable"`
- [ ] Implement `listModels()`:
  - Calls `client.listModels()`
  - Returns `ModelInfo[]` with id, name, capabilities (vision, reasoning, efforts, maxContext)
- [ ] Implement `createSession(opts: CreateSessionOpts)`:
  - `opts`: `{ projectId, model, reasoningEffort?, title? }`
  - Assemble system prompt (Task 4.4)
  - Register built-in tools (Task 4.5)
  - Register extension tools from project's installed extensions (Phase 7 wires this)
  - Create SDK session via `client.createSession({ cwd: projectPath, model, ... })`
  - Set system prompt on session
  - Attach event listeners for SDK → Socket.IO forwarding (Task 4.6)
  - Store session reference in `Map<string, ManagedSession>`
  - Return session ID
- [ ] Implement `resumeSession(sessionId: string)`:
  - `client.resumeSession(sessionId)`
  - Re-attach event listeners
  - Return session metadata
- [ ] Implement `sendMessage(sessionId, prompt, attachments?)`:
  - Get session from map
  - Call `session.send({ prompt, attachments })`
  - Events stream back via listeners attached in `createSession`
- [ ] Implement `cancelGeneration(sessionId)`:
  - `session.abort()`
- [ ] Implement `listSessions(projectId)`:
  - `client.listSessions({ cwd: projectPath })`
  - Filter by project working directory
- [ ] Implement `getSessionMessages(sessionId)`:
  - `session.getMessages()` or `client.getSessionMessages(sessionId)`
- [ ] Implement `deleteSession(sessionId)`:
  - `client.deleteSession(sessionId)`
  - Remove from managed sessions map

### 4.3 Implement Crash Recovery

In `packages/worker-service/src/core/copilot-bridge.ts`:

- [ ] Handle CopilotClient stdio process death:
  - Catch connection error events from SDK client
  - Set `status = "error"`
  - Emit `chat:error { reason: "cli-crashed" }` to all active session rooms via Socket.IO
  - Auto-restart with exponential backoff: 1s, 5s, 15s (max 3 retries)
  - On successful restart, allow sessions to resume via `resumeSession()`
  - On exhausted retries, set `status = "unavailable"`
- [ ] Handle graceful shutdown:
  - Abort all active sessions
  - Close CopilotClient

### 4.4 System Prompt Assembly

In `packages/worker-service/src/core/copilot-bridge.ts` (private method):

- [ ] Implement `assembleSystemPrompt(projectId: string): Promise<string>`:
  - Use existing `ContextRecipeEngine` (from ADR-035 implementation)
  - Execute active context recipes for the project
  - Default token budget: 4000 tokens (configurable in project settings)
  - Include:
    - Project name and path
    - Installed extension names/descriptions
    - Recent observations (via observations provider)
    - Active tool governance rules (via tool-rules provider)
    - Session history summaries (via session-history provider)
    - Error patterns (via error-patterns provider)
    - Custom instructions from context recipes
  - Return assembled prompt string within token budget

### 4.5 Console Built-in Tools

File: `packages/worker-service/src/core/chat-builtin-tools.ts`

- [ ] Export `registerBuiltinTools(session, projectId, db)` function
- [ ] Register 11 built-in tools with the Copilot SDK session via `defineTool()`:
  | Tool Name | Description | Implementation |
  |-----------|-------------|----------------|
  | `get_project` | Get current project info | Query project registry |
  | `get_sessions` | List recent sessions | Query sessions table |
  | `get_observations` | Get project observations | Query observations table |
  | `get_tool_rules` | Get active tool governance rules | Query tool governance |
  | `get_prompts` | Search prompt journal | Query prompts with optional search |
  | `get_errors` | Get error patterns | Query error intelligence |
  | `get_tool_analytics` | Get tool usage analytics | Query tool analytics |
  | `get_context_recipes` | List context recipes | Query recipes |
  | `search` | Full-text search across all data | Use FTS search service |
  | `get_subagents` | Get subagent history | Query subagent tracking |
  | `get_extension_status` | Get extension health status | Query extension registry |
- [ ] Each tool:
  - Has a JSON Schema `parameters` definition
  - Calls the appropriate existing service/route handler internally
  - Returns structured JSON results
  - Respects project scope (only returns data for the active project)

### 4.6 Socket.IO Chat Event Forwarding

File: `packages/worker-service/src/core/socket-bridge.ts` (update from Phase 2)

- [ ] Implement chat event handlers (replace Phase 2 stubs):
  ```typescript
  socket.on("chat:send", async (data, ack) => {
    const sessionId = getSessionFromSocket(socket);  // Resolve from joined chat room
    await copilotBridge.sendMessage(sessionId, data.prompt, data.attachments);
    ack?.({ ok: true });
  });

  socket.on("chat:cancel", async () => {
    const sessionId = getSessionFromSocket(socket);
    await copilotBridge.cancelGeneration(sessionId);
  });

  socket.on("chat:permission", async (data) => {
    copilotBridge.resolvePermission(data.requestId, data.decision);
  });

  socket.on("chat:input", async (data) => {
    copilotBridge.resolveInput(data.requestId, data.answer);
  });

  socket.on("chat:elicitation", async (data) => {
    copilotBridge.resolveElicitation(data.requestId, data.data);
  });
  ```
- [ ] Implement `getSessionFromSocket(socket)` — inspects socket rooms for `chat:*` prefix
- [ ] Implement `attachEventListeners(sdkSession, sessionId)` in CopilotBridge — forward ALL SDK events to Socket.IO `chat:{sessionId}` room. Complete mapping (ADR-047 §4.1):
  ```typescript
  // Streaming events
  sdkSession.on("assistant.message_delta", (d) => io.to(room).emit("message-delta", { deltaContent: d.content }));
  sdkSession.on("assistant.message", (d) => io.to(room).emit("message", { content: d.content, role: "assistant" }));
  sdkSession.on("assistant.reasoning_delta", (d) => io.to(room).emit("reasoning-delta", { deltaContent: d.content }));
  sdkSession.on("assistant.reasoning", (d) => io.to(room).emit("reasoning", { content: d.content, tokens: d.tokens }));

  // Turn lifecycle
  sdkSession.on("assistant.turn_start", (d) => io.to(room).emit("turn-start", { turnId: d.turnId }));
  sdkSession.on("assistant.turn_end", (d) => io.to(room).emit("turn-end", { turnId: d.turnId }));

  // Tool execution
  sdkSession.on("tool.execution_start", (d) => io.to(room).emit("tool-start", { toolCallId: d.toolCallId, toolName: d.toolName, arguments: d.arguments, roundId }));
  sdkSession.on("tool.execution_partial_result", (d) => io.to(room).emit("tool-partial", { toolCallId: d.toolCallId, partialOutput: d.partialOutput }));
  sdkSession.on("tool.execution_progress", (d) => io.to(room).emit("tool-progress", { toolCallId: d.toolCallId, progressMessage: d.progressMessage }));
  sdkSession.on("tool.execution_complete", (d) => io.to(room).emit("tool-complete", { toolCallId: d.toolCallId, success: d.success, result: d.result, error: d.error }));

  // Subagent lifecycle
  sdkSession.on("subagent.started", (d) => io.to(room).emit("subagent-start", { toolCallId: d.toolCallId, agentName: d.agentName, agentDisplayName: d.agentDisplayName }));
  sdkSession.on("subagent.completed", (d) => io.to(room).emit("subagent-complete", { toolCallId: d.toolCallId, agentName: d.agentName }));
  sdkSession.on("subagent.failed", (d) => io.to(room).emit("subagent-failed", { toolCallId: d.toolCallId, agentName: d.agentName, error: d.error }));

  // Interactive requests
  sdkSession.on("permission.requested", (d) => io.to(room).emit("permission-request", { requestId: d.requestId, kind: d.kind, details: d.details, diff: d.diff }));
  sdkSession.on("user_input.requested", (d) => io.to(room).emit("input-request", { requestId: d.requestId, question: d.question }));
  sdkSession.on("elicitation.requested", (d) => io.to(room).emit("elicitation-request", { requestId: d.requestId, schema: d.schema }));

  // Session lifecycle
  sdkSession.on("session.title_changed", (d) => io.to(room).emit("title-changed", { title: d.title }));
  sdkSession.on("session.compaction_start", () => io.to(room).emit("compaction-start", {}));
  sdkSession.on("session.compaction_complete", (d) => io.to(room).emit("compaction-complete", { tokensRemoved: d.tokensRemoved, summary: d.summary }));
  sdkSession.on("session.usage_info", (d) => io.to(room).emit("usage", { contextWindowPct: d.contextWindowPct }));
  sdkSession.on("session.idle", () => io.to(room).emit("idle", {}));
  sdkSession.on("session.error", (d) => io.to(room).emit("error", { message: d.message, recoverable: d.recoverable }));
  ```
- [ ] Pass `io` instance to CopilotBridge (set during worker bootstrap)
- [ ] Implement `roundId` generation for concurrent tool calls:
  - SDK emits multiple `tool.execution_start` events within same turn
  - Assign same `roundId` to tools started before any completes
  - New `roundId` (UUID) when first tool starts after previous round completes

### 4.7 Permission & Input Callback Management

In `packages/worker-service/src/core/copilot-bridge.ts`:

- [ ] Maintain pending callback maps:
  ```typescript
  private pendingPermissions = new Map<string, (decision: string) => void>();
  private pendingInputs = new Map<string, (answer: string) => void>();
  private pendingElicitations = new Map<string, (data: Record<string, unknown>) => void>();
  ```
- [ ] When SDK raises `permission.requested`:
  - Store callback in `pendingPermissions` map
  - Emit `permission-request` to session's Socket.IO room
- [ ] `resolvePermission(requestId, decision)`:
  - Get callback from map
  - Call callback with decision
  - Remove from map
- [ ] Same pattern for `resolveInput()` and `resolveElicitation()`
- [ ] Add timeout (30s) for pending callbacks — auto-deny if no response

### 4.8 Chat REST Routes

File: `packages/worker-service/src/routes/chat.ts`

- [ ] `GET /api/chat/status` — Bridge health:
  ```json
  { "status": "ready" | "not-initialized" | "starting" | "error" | "unavailable", "error?": "..." }
  ```
- [ ] `GET /api/chat/models` — List models (calls `copilotBridge.listModels()`)
- [ ] `POST /api/{projectId}/chat/sessions` — Create session:
  - Body: `{ model: string, reasoningEffort?: string, title?: string, branchFrom?: { sessionId: string, messageIndex: number } }`
  - If `branchFrom` is provided: replay conversation history up to `messageIndex - 1` as context, set `branchedFrom` metadata
  - Returns `{ sessionId: string }`
  - Triggers system prompt assembly, tool registration
- [ ] `GET /api/{projectId}/chat/sessions` — List project sessions
- [ ] `GET /api/{projectId}/chat/sessions/:sessionId` — Session metadata
- [ ] `DELETE /api/{projectId}/chat/sessions/:sessionId` — Delete session
- [ ] `GET /api/{projectId}/chat/sessions/:sessionId/messages` — Conversation history
- [ ] `POST /api/{projectId}/chat/sessions/:sessionId/resume` — Resume disconnected session
- [ ] Register routes in `app.ts`:
  ```typescript
  app.use("/api/chat", chatRouter);
  app.use("/api/:projectId/chat", projectChatRouter);
  ```

### 4.9 Hook Integration for Chat Sessions

In `packages/worker-service/src/core/copilot-bridge.ts`:

- [ ] Fire `sessionStart` hook when chat session is created
  - Use existing hook-request-queue `enqueue()` with session metadata
- [ ] Fire `sessionEnd` hook when session is closed/deleted
- [ ] Fire `preToolUse` / `postToolUse` hooks on SDK tool execution events
  - `preToolUse`: before tool runs, check governance rules — if denied, abort tool
  - `postToolUse`: after tool completes, record analytics
- [ ] Fire `errorOccurred` hook on SDK session errors
- [ ] Fire `subagentStart` / `subagentStop` hooks on subagent lifecycle events
- [ ] Fire `userPromptSubmitted` hook on each user message
- [ ] Fire `preCompact` hook before compaction
- [ ] All hooks pass the chat session's `projectId` for proper scoping

### 4.10 Verification

```bash
# Build
pnpm run build

# Verify chat routes exist
curl http://localhost:42888/api/chat/status
# Expected: { "status": "not-initialized" } (before first chat request)

# Verify model listing (requires Copilot CLI)
curl http://localhost:42888/api/chat/models

# Create a session (requires Copilot CLI + auth)
curl -X POST http://localhost:42888/api/test-project/chat/sessions \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4"}'

# Lint
pnpm run lint
pnpm run lint:duplication
```

## Files Created

```
packages/worker-service/src/core/copilot-bridge.ts     — CopilotBridge singleton (SDK wrapper)
packages/worker-service/src/core/chat-builtin-tools.ts  — 11 built-in tools for LLM
packages/worker-service/src/routes/chat.ts              — Chat REST endpoints
```

## Files Modified

```
packages/worker-service/package.json                    — Add @github/copilot-sdk
packages/worker-service/src/core/socket-bridge.ts       — Implement chat event handlers (replace stubs)
packages/worker-service/src/app.ts                      — Register chat routes
packages/worker-service/src/index.ts                    — Pass io instance to CopilotBridge
pnpm-lock.yaml                                         — Updated dependencies
```
