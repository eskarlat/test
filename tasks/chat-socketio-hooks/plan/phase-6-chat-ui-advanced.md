# Phase 6 — Chat UI: Advanced Components

## Goal

Implement all remaining Chat UI components: tool execution cards with round grouping, file diffs, reasoning blocks, subagent visualization, permission/input/elicitation dialogs, compaction notice, terminal blocks, message copy actions, revision (branching), message list virtualization, and keyboard shortcuts.

## Reference

- ADR-047: Console Chat UI with GitHub Copilot SDK (§6.5-6.13)
- VS Code Copilot Chat patterns: `IToolCallRound`, `isHistorical`, streaming buffer, branch-based revision

## Dependencies

- Phase 5 (Chat UI Core) — base components, store, streaming, routing

## Tasks

### 6.1 Tool Execution Components

File: `packages/console-ui/src/components/chat/ChatToolExecution.tsx`

- [ ] Render a single tool call card with 5-phase state machine:
  | Status | Visual |
  |--------|--------|
  | `pending` | Spinner + tool name + "Queued..." |
  | `validating` | Spinner + "Checking governance rules..." |
  | `running` | Spinner + tool name + argument summary |
  | `complete` | Checkmark + tool name + collapsible result |
  | `error` | Error icon + tool name + error message |
- [ ] Show tool arguments:
  - While streaming: show `argumentsStreaming` (partial JSON)
  - When complete: show formatted arguments (collapsible JSON viewer)
- [ ] Show tool result (when `status === "complete"`):
  - Collapsible section, collapsed by default for historical tools (`isHistorical`)
  - Expanded by default for the most recent tool call
  - Copy button on result
- [ ] Duration badge: show elapsed time when complete
- [ ] Extension tools show namespace: `ext-name / tool-name` (grey prefix)

File: `packages/console-ui/src/components/chat/ChatToolRound.tsx`

- [ ] Group tool executions with same `roundId` into a single visual container
- [ ] Layout: stacked vertical cards within a bordered container
- [ ] Header: "Running N tools" or "Ran N tools" with expand/collapse all
- [ ] If round has single tool: render `ChatToolExecution` directly (no wrapper)
- [ ] If round has 2+ tools: render `ChatToolRound` wrapper with count badge
- [ ] Implement `groupToolRounds(blocks: ContentBlock[]): (ContentBlock | ToolRound)[]` utility:
  - Adjacent `tool-execution` blocks with same `roundId` → `ToolRound` group
  - Non-tool blocks and lone tools pass through unchanged
  - Used by `ChatMessageList` before rendering blocks

### 6.2 Reasoning Block

File: `packages/console-ui/src/components/chat/ChatReasoningBlock.tsx`

- [ ] Collapsible "Thinking" section:
  - Header: "Thinking" + token count badge (if available) + expand/collapse chevron
  - Collapsed by default (ADR-047 §6.5)
  - Content: markdown-rendered reasoning text
  - While streaming: show spinner + "Thinking..." with live content behind collapse
- [ ] Styling: muted background (`bg-muted/50`), italic text, left border accent
- [ ] Copy button on reasoning content

### 6.3 Subagent Block

File: `packages/console-ui/src/components/chat/ChatSubagentBlock.tsx`

- [ ] Render subagent as a nested card:
  - Header: agent icon + display name + status (running/complete/failed)
  - While running: spinner
  - When complete: checkmark + summary
  - When failed: error icon + error message
- [ ] Subagent may contain nested content blocks (text, tools) — render recursively via `ChatContentBlock`
- [ ] Expandable: collapsed after completion, shows summary

### 6.4 File Diff Block

File: `packages/console-ui/src/components/chat/ChatFileDiff.tsx`

- [ ] Render unified diff format:
  - File path header with copy button
  - Line-by-line diff with line numbers in gutter
  - Removed lines: `bg-red-950/30 text-red-400`
  - Added lines: `bg-green-950/30 text-green-400`
  - Context lines: default styling
  - Line numbers in `text-muted-foreground`
- [ ] Incremental accumulation flow (ADR-047 §6.7):
  1. `permission.requested` with `kind: "write"` → create `FileDiffBlock` with `isDone: false`, populate `diff` preview
  2. `tool.execution_partial_result` → append to `FileDiffBlock.edits[]` array
  3. `tool.execution_complete` → set `isDone: true`, finalize `diff` from accumulated edits
- [ ] While `isDone === false`: show animated skeleton with "Editing {fileName}..." label
- [ ] When `isDone === true`: render unified diff with green/red highlighting, line numbers
- [ ] Group consecutive `FileDiffBlock` entries for same `fileName` into a single card
- [ ] Show `intention` field as header above the diff
- [ ] For new files (`isNewFile: true`): show full content with all-green highlighting
- [ ] Collapsible: expanded by default for recent, collapsed for historical
- [ ] Copy diff button (copies raw unified diff text)
- [ ] Handle large diffs: cap at 100 visible lines with "Show all N lines" expand

### 6.5 Permission, Input, and Elicitation Dialogs

File: `packages/console-ui/src/components/chat/ChatPermissionDialog.tsx`

- [ ] Inline dialog (not modal — appears in message flow):
  - Shows permission `kind`: shell, write, read, mcp, url, custom-tool
  - Shows `details` (command, file path, URL, etc.)
  - For `write` permission: show file diff inline
  - Approve / Deny buttons
  - Timeout indicator (30s countdown)
- [ ] On Approve: emit `chat:permission { requestId, decision: "approved" }` via Socket.IO
- [ ] On Deny: emit `chat:permission { requestId, decision: "denied" }`
- [ ] Disable buttons after response (prevent double-click)
- [ ] Store dispatches to `useChatStore.respondToPermission()`

File: `packages/console-ui/src/components/chat/ChatInputDialog.tsx`

- [ ] Inline dialog for agent questions:
  - Shows question text
  - Text input field
  - Submit button (or Enter)
- [ ] Emit `chat:input { requestId, answer }` on submit

File: `packages/console-ui/src/components/chat/ChatElicitationDialog.tsx`

- [ ] Dynamic form generated from `schema` (JSON Schema):
  - String fields → text input
  - Number fields → number input
  - Boolean fields → checkbox
  - Enum fields → select dropdown
  - Array fields → multi-select
- [ ] Submit button emits `chat:elicitation { requestId, data }`

### 6.6 Compaction and Progress Components

File: `packages/console-ui/src/components/chat/ChatCompactionNotice.tsx`

- [ ] Inline notice in message feed when `compaction-start` fires:
  - "Compacting conversation history..."
  - When `compaction-complete`: "Compacted — removed N tokens"
  - Muted styling, non-interactive

File: `packages/console-ui/src/components/chat/ChatProgressIndicator.tsx`

- [ ] Streaming progress dots or bar during `isStreaming`:
  - Positioned below last message
  - Animated dots or typing indicator
  - Shows "Thinking..." during reasoning, "Writing..." during message delta

### 6.7 Terminal and Code Blocks

File: `packages/console-ui/src/components/chat/ChatTerminalBlock.tsx`

- [ ] Render terminal/shell output:
  - Monospace font, dark background
  - Command header (if available)
  - Scrollable output area (max height 300px)
  - Copy button

File: `packages/console-ui/src/components/chat/ChatCodeBlock.tsx`

- [ ] Code block with:
  - Language badge (top-right)
  - Syntax highlighting (basic: use `<pre><code>` with language class)
  - Copy button
  - Line numbers (optional, for long blocks)

### 6.8 Message Copy Actions

- [ ] Add copy actions per ADR-047 §6.10:
  | Target | Trigger | What's Copied |
  |--------|---------|---------------|
  | Assistant message | "Copy" button on hover | Full markdown text (blocks concatenated) |
  | Code block | Copy icon on code block header | Raw code content (no markdown fences) |
  | Tool result | Copy icon in tool card | `result.content` (concise) or `result.detailedContent` (expanded) |
  | Terminal output | Copy icon in terminal block | Raw terminal text |
  | File diff | Copy icon in diff card | Unified diff text |
  | User message | "Copy" on hover | Original prompt text |
- [ ] Use `navigator.clipboard.writeText()` with brief "Copied" toast (1.5s auto-dismiss)
- [ ] Copy button appears on hover (not always visible)

### 6.9 Attachment Preview

File: `packages/console-ui/src/components/chat/ChatAttachmentPreview.tsx`

- [ ] Preview attached files in user messages:
  - File: icon + filename + size
  - Directory: folder icon + dirname
  - Images: thumbnail preview (if vision model)
- [ ] Click to expand or view full path
- [ ] Removable chip style in input area (pre-send)
- [ ] Read-only badge style in sent messages

### 6.10 Revision (Branch-based)

In `packages/console-ui/src/stores/chat-store.ts`:

- [ ] Implement `reviseTo(messageIndex: number)` (ADR-047 §6.6 branching flow):
  1. Keep original session intact (do not delete)
  2. Create new session via `POST /api/{pid}/chat/sessions` with `{ model, branchFrom: { sessionId, messageIndex } }`
  3. Worker creates new SDK session, injects same system prompt, replays history up to `messageIndex - 1`
  4. User edits the message at position N and sends revised version
  5. New session continues from the revised point
  6. Navigate to new session
- [ ] New session metadata includes `branchedFrom: { sessionId, messageIndex, timestamp }` for lineage display
- [ ] Historical blocks in replayed messages: all `ToolExecutionBlock` entries marked `isHistorical: true` — render in muted style without spinners or re-invocation controls
- [ ] UI trigger: Up arrow key when input is empty and last message is from user → populate input with last user message
- [ ] Edit indicator on user messages: pencil icon on hover → click opens revision flow
- [ ] Session list shows branch relationships:
  - Branched sessions show subtle "Branched from: {originalTitle}" link
  - Clicking navigates to original session

### 6.11 Message List Virtualization

File: `packages/console-ui/src/components/chat/ChatMessageList.tsx` (update)

- [ ] Add `@tanstack/react-virtual` dependency
- [ ] Wrap message list in virtualizer:
  ```typescript
  const virtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (index) => estimateMessageHeight(messages[index]),
    overscan: 5,
  });
  ```
- [ ] Height estimation by block type:
  - Text: ~80px per block
  - Tool card: ~120px
  - File diff: ~200px
  - Other: ~60px
- [ ] Dynamic height measurement via `ResizeObserver` after render
- [ ] The currently streaming message is always rendered (outside virtual list) at the bottom
- [ ] Scroll position preserved on window resize
- [ ] Activate virtualization only when message count > 100 (skip for short conversations — per ADR-047 §6.12 "100+ messages")

### 6.12 Keyboard Shortcuts

In `packages/console-ui/src/routes/chat.tsx`:

- [ ] Register keyboard handlers:
  | Shortcut | Action |
  |----------|--------|
  | `Enter` | Send message (when input focused) |
  | `Shift+Enter` | Newline in input |
  | `Escape` | Cancel generation (if streaming) or close panel |
  | `Ctrl/Cmd+N` | New session |
  | `Ctrl/Cmd+Shift+C` | Copy last assistant message |
  | `Up` | Revise last user message (when input empty) |
- [ ] Use `useEffect` with `keydown` listener, check `event.target` to avoid conflicts with input fields
- [ ] Shortcuts should be scoped to the chat page (not global)

### 6.13 Verification

```bash
# Build
pnpm run build

# Dev mode
pnpm --filter @renre-kit/console-ui dev

# Verify (requires active chat session):
# - Tool execution cards render with correct status phases
# - Concurrent tools group in rounds
# - Reasoning block is collapsible
# - File diffs render with correct coloring
# - Permission dialog shows approve/deny
# - Copy buttons work on all components
# - Keyboard shortcuts work
# - Virtualization activates for long conversations
# - Revision creates new branch session

# Lint
pnpm run lint
pnpm run lint:duplication
```

## Files Created

```
packages/console-ui/src/components/chat/ChatToolExecution.tsx      — Tool call card (state machine)
packages/console-ui/src/components/chat/ChatToolRound.tsx          — Concurrent tool grouping
packages/console-ui/src/components/chat/ChatReasoningBlock.tsx     — Collapsible thinking
packages/console-ui/src/components/chat/ChatSubagentBlock.tsx      — Subagent card
packages/console-ui/src/components/chat/ChatFileDiff.tsx           — Unified diff viewer
packages/console-ui/src/components/chat/ChatPermissionDialog.tsx   — Permission inline dialog
packages/console-ui/src/components/chat/ChatInputDialog.tsx        — Agent input question
packages/console-ui/src/components/chat/ChatElicitationDialog.tsx  — Structured form
packages/console-ui/src/components/chat/ChatCompactionNotice.tsx   — Compaction notice
packages/console-ui/src/components/chat/ChatProgressIndicator.tsx  — Streaming indicator
packages/console-ui/src/components/chat/ChatTerminalBlock.tsx      — Terminal output
packages/console-ui/src/components/chat/ChatCodeBlock.tsx          — Code with copy + highlight
packages/console-ui/src/components/chat/ChatAttachmentPreview.tsx  — File attachment display
```

## Files Modified

```
packages/console-ui/package.json                                   — Add @tanstack/react-virtual
packages/console-ui/src/components/chat/ChatMessageList.tsx        — Add virtualization
packages/console-ui/src/components/chat/ChatContentBlock.tsx       — Wire remaining block renderers
packages/console-ui/src/components/chat/ChatMessage.tsx            — Add copy actions, revision trigger
packages/console-ui/src/stores/chat-store.ts                       — Add reviseTo(), tool/subagent/permission handlers
packages/console-ui/src/routes/chat.tsx                            — Add keyboard shortcuts
pnpm-lock.yaml                                                    — Updated dependencies
```
