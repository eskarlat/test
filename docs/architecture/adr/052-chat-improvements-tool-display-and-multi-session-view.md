# ADR-052: Chat Improvements — Tool Display Settings & Multi-Session Split View

## Status
Proposed (extends ADR-047, ADR-048)

## Context

ADR-047 established the Console Chat UI with GitHub Copilot SDK integration, including tool execution rendering with a five-phase lifecycle state machine and typed content blocks. ADR-048 unified real-time communication over Socket.IO with session-scoped rooms (`chat:{sessionId}`).

Two gaps remain in the current chat design:

1. **Tool display verbosity** — The current `ChatToolExecution` component always renders the full tool call card: tool name, streaming arguments, partial output, and final result. For experienced users monitoring multiple tool rounds, this verbosity creates noise. Conversely, for debugging or reviewing agent behavior, the full view is essential. Users need a global setting to control how much tool detail the chat shows.

2. **Single-session limitation** — The Chat page supports only one active session at a time (one `activeSessionId` in `chat-store`). Users working across multiple concerns (e.g., debugging in one session while building a feature in another) must navigate between sessions, losing visual context. The architecture already supports multiple concurrent `CopilotBridge` sessions and Socket.IO rooms — but the UI has no mechanism to display them simultaneously.

A third implicit need emerges: when a user sends a message in one session pane and switches focus to another pane, the original session must continue resolving its response independently. Each pane maintains its own session lifecycle — streaming, tool execution, permission dialogs — regardless of which pane has focus.

## Decision

### 1. Tool Display Settings

Add a **global** tool display mode setting with three levels:

```
Compact     │  Tool name + one-line intent (e.g., "Read src/index.ts")
Standard    │  Tool name + intent + arguments summary + result summary
Verbose     │  Full arguments, streaming partial output, detailed result (current behavior)
```

#### 1.1 Settings Store

A dedicated Zustand store with `persist` middleware owns all **global** (not per-project) chat preferences. It persists to `localStorage` under the key `renre-chat-global-preferences` — deliberately namespaced with `global` to avoid collision with ADR-047's per-project `renre-chat-preferences:{projectId}` key (which stores model and effort selections).

```typescript
// src/stores/chat-global-preferences-store.ts

type ToolDisplayMode = "compact" | "standard" | "verbose";

interface ChatGlobalPreferencesState {
  toolDisplayMode: ToolDisplayMode;

  // Actions
  setToolDisplayMode(mode: ToolDisplayMode): void;
}

const useChatGlobalPreferencesStore = create<ChatGlobalPreferencesState>()(
  persist(
    (set) => ({
      toolDisplayMode: "standard",

      setToolDisplayMode: (mode) => set({ toolDisplayMode: mode }),
    }),
    {
      name: "renre-chat-global-preferences",  // localStorage key
      partialize: (state) => ({ toolDisplayMode: state.toolDisplayMode }),
    }
  )
);
```

This produces a single `localStorage` entry:

```json
// localStorage["renre-chat-global-preferences"]
{ "state": { "toolDisplayMode": "standard" }, "version": 0 }
```

**Key namespace summary** (across ADR-047 and this ADR):

| Key | Scope | Owner | Contents |
|-----|-------|-------|----------|
| `renre-chat-preferences:{projectId}` | Per-project | ADR-047 | `{ model, effort }` |
| `renre-chat-global-preferences` | Global | ADR-052 | `{ toolDisplayMode }` |
| `renre-chat-layout:{projectId}` | Per-project | ADR-052 §2.4 | Serialized layout tree + pane→session map |

#### 1.2 Setting UI Location

The tool display mode selector lives in the **Chat page header bar** (alongside model selector and effort selector from ADR-047 §6.3). It uses a segmented control or dropdown:

```
┌──────────────────────────────────────────────────────────────┐
│  Model: [claude-sonnet-4-6 ▾]  Effort: [high ▾]  Tools: [Standard ▾]  │
└──────────────────────────────────────────────────────────────┘
```

Also accessible from Console UI **Settings** page under "Chat" section for discoverability.

**Model/Effort selectors in multi-pane context**: ADR-047's `selectedModel` and `selectedEffort` are project-level defaults applied when **creating new sessions**. Once a session is created, its model is fixed (owned by the Copilot SDK session). In multi-pane mode:

- The **header bar** Model/Effort selectors set the default for the **next new session** (unchanged from ADR-047)
- Each **pane header** (`ChatPaneHeader`) displays the model name of its active session as a **read-only badge** (e.g., "sonnet-4-6") — not editable, since the model is bound at session creation
- When a pane shows the `ChatSessionPickerDialog` (no session assigned), the "Create new session" option uses the current header bar defaults

#### 1.3 Rendering by Display Mode

The `ChatToolExecution` component reads `toolDisplayMode` from `useChatGlobalPreferencesStore` and renders accordingly:

**Compact mode:**
```
┌──────────────────────────────────────┐
│ 🔧 read_file — Read src/index.ts    │  ← Single line, icon + tool name + intent
│    ✓ 12ms                            │  ← Status + duration (if complete)
└──────────────────────────────────────┘
```

- Shows: tool icon, `toolName`, generated intent string (derived from tool name + primary argument)
- Hides: arguments object, partial output, detailed result, streaming animations
- Status indicators: spinner (running), checkmark (complete), ✗ (error)
- Error state: shows one-line error message inline

**Standard mode:**
```
┌──────────────────────────────────────────────────────┐
│ 🔧 read_file                                    12ms │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ Path: src/index.ts                                    │  ← Key arguments (first 1-2 meaningful args)
│ Result: 42 lines read                                 │  ← One-line result summary
└──────────────────────────────────────────────────────┘
```

- Shows: tool name, key arguments (top 1-2 from a tool-specific display config), one-line result summary, duration
- Hides: full arguments JSON, streaming partial output, detailed result content
- Arguments summarization: each tool defines which arguments to show in standard mode via a `toolDisplayConfig` map

**Verbose mode:**
```
┌──────────────────────────────────────────────────────┐
│ 🔧 read_file                                    12ms │
│ ┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄┄ │
│ Arguments:                                            │
│   { "file_path": "src/index.ts", "offset": 0,       │  ← Full arguments JSON
│     "limit": 100 }                                    │
│ Output:                                               │
│   1│ import express from "express";                   │  ← Full result content
│   2│ import { createServer } from "http";             │
│   ...                                                 │
│   42│ export default app;                              │
└──────────────────────────────────────────────────────┘
```

- Shows: everything — full arguments, streaming partial output during execution, complete detailed result
- This is the current ADR-047 behavior (no change)

#### 1.3.1 ToolCallRound Rendering by Display Mode

ADR-047 §6.5 groups concurrent tool calls sharing the same `roundId` into a **ToolCallRound card**. Display mode affects how rounds render:

**Compact mode** — Round collapses into a single summary line when all tools complete:
```
┌──────────────────────────────────────────────────┐
│ 🔧 3 tools (read_file, grep, glob) ✓ 45ms       │  ← Collapsed round
└──────────────────────────────────────────────────┘
```
While running, each tool in the round shows its own compact line (with spinner). Once all complete, the round auto-collapses to the summary. Users can click to expand and see individual tool lines.

**Standard mode** — Each tool in the round renders its own standard card, grouped inside a round container with a subtle left border:
```
┌─ Round (3 tools, 45ms) ─────────────────────────┐
│ ┌──────────────────────────────────────────────┐ │
│ │ 🔧 read_file         12ms                    │ │
│ │ Path: src/index.ts — 42 lines read           │ │
│ └──────────────────────────────────────────────┘ │
│ ┌──────────────────────────────────────────────┐ │
│ │ 🔧 grep              28ms                    │ │
│ │ Pattern: "TODO" — 7 matches                  │ │
│ └──────────────────────────────────────────────┘ │
│ ...                                              │
└──────────────────────────────────────────────────┘
```

**Verbose mode** — Unchanged from ADR-047. Individual tool cards grouped by round, all expanded.

#### 1.4 Tool Intent Generation

Each tool call in compact/standard mode needs a human-readable intent string. This is derived from a static mapping + argument inspection:

```typescript
// src/utils/tool-intent.ts

const toolIntentMap: Record<string, (args: Record<string, unknown>) => string> = {
  read_file: (args) => `Read ${shortenPath(args.file_path as string)}`,
  edit_file: (args) => `Edit ${shortenPath(args.file_path as string)}`,
  write_file: (args) => `Write ${shortenPath(args.file_path as string)}`,
  bash: (args) => "Run `" + truncate(args.command as string, 40) + "`",
  grep: (args) => "Search for \"" + truncate(args.pattern as string, 30) + "\"",
  glob: (args) => `Find files matching ${args.pattern}`,
  list_directory: (args) => `List ${shortenPath(args.path as string)}`,
  // ... extensible for extension tools and MCP tools
};

// Fallback for unknown tools
function defaultIntent(toolName: string, args: Record<string, unknown>): string {
  const firstArg = Object.values(args)[0];
  return `${humanize(toolName)}${firstArg ? ` — ${truncate(String(firstArg), 40)}` : ""}`;
}
```

#### 1.5 Tool Display Config (Standard Mode Arguments)

```typescript
// src/utils/tool-display-config.ts

interface ToolDisplayConfig {
  keyArgs: string[];          // Argument keys to show in standard mode (order matters)
  resultSummary: (result: ToolResult) => string;  // One-line result summary
}

const toolDisplayConfigs: Record<string, ToolDisplayConfig> = {
  read_file: {
    keyArgs: ["file_path"],
    resultSummary: (r) => `${countLines(r.content)} lines read`,
  },
  edit_file: {
    keyArgs: ["file_path"],
    resultSummary: (r) => r.content.includes("✓") ? "Edit applied" : r.content,
  },
  bash: {
    keyArgs: ["command"],
    resultSummary: (r) => truncate(r.content, 60),
  },
  grep: {
    keyArgs: ["pattern", "path"],
    resultSummary: (r) => `${countMatches(r.content)} matches`,
  },
  // Extension tools fall back to showing first 2 arguments
};
```

#### 1.6 Extension & MCP Tool Display Registration

Built-in tools have hardcoded `toolIntentMap` and `toolDisplayConfigs` entries. Extension and MCP tools need a way to provide their own display metadata. This is done via the extension **manifest** (ADR-019, ADR-020):

```jsonc
// manifest.json — new optional "toolDisplay" field per tool
{
  "tools": [
    {
      "name": "deploy",
      "description": "Deploy to staging or production",
      "toolDisplay": {
        "intent": "Deploy to {{environment}}",    // Mustache-style template over argument names
        "keyArgs": ["environment", "branch"],
        "resultSummary": "short"                  // "short" = first line of result, "full" = omit (use verbose)
      }
    }
  ]
}
```

**Resolution order** for tool intent / display config:
1. Built-in `toolIntentMap` / `toolDisplayConfigs` (highest priority — hardcoded, optimized)
2. Extension manifest `toolDisplay` field (loaded at extension mount time)
3. Fallback: `defaultIntent()` using `humanize(toolName)` + first argument value (§1.4)

MCP tools (ADR-008) do not have a manifest entry for display config — they always use the fallback. A future ADR could extend MCP tool metadata with display hints if needed.

### 2. Multi-Session Split View

#### 2.1 Layout Model

The Chat page supports **flexible pane splitting**, inspired by VS Code's editor split. Users can split horizontally or vertically, up to **4 panes** maximum.

```
┌─────────────────────────────────────────────────────────────┐
│  [Model ▾] [Effort ▾] [Tools ▾]          [Split ▾] [+New]  │  ← Chat header bar
├─────────────────────────────┬───────────────────────────────┤
│                             │                               │
│   Session A (focused)       │   Session B                   │
│   ┌─────────────────────┐   │   ┌─────────────────────┐     │
│   │ Assistant: ...       │   │   │ Assistant: ...       │     │
│   │ 🔧 read_file — ...  │   │   │ User: fix the bug... │     │
│   │ ...streaming...      │   │   │ 🔧 bash — running... │     │
│   │                     │   │   │ ...streaming...      │     │
│   ├─────────────────────┤   │   ├─────────────────────┤     │
│   │ [Type a message...] │   │   │ [Type a message...] │     │
│   └─────────────────────┘   │   └─────────────────────┘     │
└─────────────────────────────┴───────────────────────────────┘
```

Split states:

```
Single       │  1 pane (default, current behavior)
Vertical     │  2 panes side by side (50/50)
Horizontal   │  2 panes stacked (50/50)
Grid         │  4 panes (2×2)
Triple-V     │  3 panes side by side (33/33/33)
Triple-H     │  1 left + 2 right stacked, or other 3-pane combos
```

Pane boundaries are **draggable** for resizing. Minimum pane width: 320px. Minimum pane height: 200px.

#### 2.2 Pane Architecture

Each pane is an independent `ChatPane` component that owns its own session lifecycle:

```typescript
// src/components/chat/ChatPane.tsx

interface ChatPaneProps {
  paneId: string;
  sessionId: string | null;      // null = session picker shown
  isFocused: boolean;
  onFocus: () => void;
  onClose: () => void;
  onSessionChange: (sessionId: string) => void;
}
```

Each `ChatPane`:
- Joins its own `chat:{sessionId}` Socket.IO room independently
- Maintains its own scroll position, streaming state, pending interactions
- Has its own message input field
- Shows a **session selector** header (dropdown or inline tab) to switch which session is displayed
- Renders tool blocks according to the global `toolDisplayMode`
- Handles permission/input dialogs inline within the pane

#### 2.3 Layout Store

A new Zustand store manages the split layout:

```typescript
// src/stores/chat-layout-store.ts

type SplitDirection = "horizontal" | "vertical";

interface PaneState {
  id: string;
  sessionId: string | null;     // Which chat session this pane shows
}

interface SplitNode {
  type: "split";
  direction: SplitDirection;
  ratio: number;                // 0.0–1.0, position of the divider
  children: [LayoutNode, LayoutNode];
}

interface LeafNode {
  type: "leaf";
  paneId: string;
}

type LayoutNode = SplitNode | LeafNode;

interface ChatLayoutState {
  layout: LayoutNode;                      // Tree structure representing the split layout
  panes: Record<string, PaneState>;        // Plain object — JSON-serializable for localStorage
  focusedPaneId: string;

  // Actions
  splitPane(paneId: string, direction: SplitDirection): void;
  closePane(paneId: string): void;
  setSessionForPane(paneId: string, sessionId: string): void;
  setFocusedPane(paneId: string): void;
  setSplitRatio(splitNodePath: number[], ratio: number): void;
  resetLayout(): void;          // Back to single pane
}
```

`panes` uses `Record<string, PaneState>` (not `Map`) so the entire `ChatLayoutState` is directly JSON-serializable by Zustand's `persist` middleware without custom `storage.serialize`/`deserialize` functions. The `LayoutNode` tree is also plain objects, so the full state round-trips through `JSON.stringify`/`JSON.parse` cleanly.

The layout is a **binary tree** of split nodes with leaf panes. This naturally supports any combination of splits up to the 4-pane maximum.

Example: Vertical split with left pane further split horizontally:

```
SplitNode(vertical, 0.5)
├── SplitNode(horizontal, 0.5)
│   ├── LeafNode(pane-1)        // Top-left
│   └── LeafNode(pane-2)        // Bottom-left
└── LeafNode(pane-3)            // Right
```

#### 2.4 Layout Persistence

The layout store uses Zustand's `persist` middleware with a **per-project** localStorage key. `focusedPaneId` is excluded from persistence — it is transient UI state that defaults to the first pane on restore.

```typescript
const useChatLayoutStore = create<ChatLayoutState>()(
  persist(
    (set, get) => ({
      layout: { type: "leaf", paneId: "pane-1" },
      panes: { "pane-1": { id: "pane-1", sessionId: null } },
      focusedPaneId: "pane-1",

      splitPane: (paneId, direction) => { /* ... */ },
      closePane: (paneId) => { /* ... */ },
      setSessionForPane: (paneId, sessionId) => { /* ... */ },
      setFocusedPane: (paneId) => set({ focusedPaneId: paneId }),
      setSplitRatio: (path, ratio) => { /* ... */ },
      resetLayout: () => set({
        layout: { type: "leaf", paneId: "pane-1" },
        panes: { "pane-1": { id: "pane-1", sessionId: null } },
        focusedPaneId: "pane-1",
      }),
    }),
    {
      name: `renre-chat-layout:${projectId}`,  // Per-project key
      partialize: (state) => ({
        layout: state.layout,
        panes: state.panes,
        // focusedPaneId excluded — transient UI state
      }),
    }
  )
);
```

**Stale session recovery**: When the layout is restored from localStorage, pane `sessionId` references may point to sessions that no longer exist (e.g., Copilot CLI was reset, sessions were deleted). On restore, the store runs a validation pass:

```typescript
// Called after store hydration and after sessions list is fetched
function validateRestoredLayout(
  panes: Record<string, PaneState>,
  validSessionIds: Set<string>
): Record<string, PaneState> {
  const validated: Record<string, PaneState> = {};
  for (const [id, pane] of Object.entries(panes)) {
    validated[id] = {
      ...pane,
      sessionId: pane.sessionId && validSessionIds.has(pane.sessionId)
        ? pane.sessionId
        : null,  // Reset to session picker
    };
  }
  return validated;
}
```

Panes with invalidated sessions show the `ChatSessionPickerDialog` instead of a broken empty chat.

#### 2.5 Chat Store Refactoring

The existing `chat-store` (ADR-047 §6.4) assumes a single `activeSessionId`. With multi-pane, multiple sessions are active simultaneously. Key changes:

> **Note on `Map` usage**: The chat-store is **not persisted** to `localStorage` — it is runtime-only state rebuilt from Socket.IO events and REST calls on page load (ADR-047 §10). `Map` is appropriate here since JSON serializability is not required. This contrasts with `chat-layout-store` (§2.3) which uses `Record` for its persisted fields.

```typescript
// Updated chat-store.ts

interface ChatState {
  // REMOVED: activeSessionId: string | null
  // REMOVED: streamingContent, streamingReasoning (single-session fields)

  // Per-session state (keyed by sessionId)
  sessionStates: Map<string, SessionStreamState>;

  // Messages remain keyed by sessionId (no change)
  messages: Map<string, ChatMessage[]>;

  // Bridge status (unchanged)
  bridgeStatus: BridgeStatus;
  models: ModelInfo[];

  // Sessions list (unchanged)
  sessions: SessionMetadata[];

  // Actions (now session-scoped)
  sendMessage(sessionId: string, prompt: string, attachments?: Attachment[]): void;
  cancelGeneration(sessionId: string): void;
  respondToPermission(sessionId: string, requestId: string, decision: "approved" | "denied"): void;
  respondToInput(sessionId: string, requestId: string, answer: string): void;
  respondToElicitation(sessionId: string, requestId: string, data: Record<string, unknown>): void;
}

interface SessionStreamState {
  streamingContent: string;
  streamingReasoning: string;
  streamingReasoningTokens: number;
  isStreaming: boolean;
  isThinking: boolean;
  ttftMs: number | null;
  activeTools: Map<string, ToolExecution>;
  activeSubagents: Map<string, SubagentExecution>;
  pendingPermission: PermissionRequest | null;
  pendingInput: InputRequest | null;
  pendingElicitation: ElicitationRequest | null;
  contextWindowPct: number;
  isUserScrolledUp: boolean;
  hasNewMessages: boolean;
}
```

Each `ChatPane` reads from `sessionStates.get(sessionId)` for its streaming/tool state instead of top-level fields.

#### 2.6 Socket.IO Room Management

When a pane is assigned a session, it joins that session's room. When a pane switches sessions or closes, it leaves the room. Uses the existing `chat:join`/`chat:leave` events from `socket-bridge.ts` (ADR-048 §5) which accept a plain `sessionId` string — the server handles the `chat:${sessionId}` room mapping internally:

```typescript
// In ChatPane.tsx — on mount / session change
useEffect(() => {
  if (!sessionId) return;

  const socket = useSocketStore.getState().socket;
  socket?.emit("chat:join", sessionId);

  return () => {
    socket?.emit("chat:leave", sessionId);
  };
}, [sessionId]);
```

Multiple panes can show the **same session** (e.g., for monitoring a long-running session in a larger pane while working in another). The server-side `chat:join` handler calls `socket.join(`chat:${sessionId}`)` internally — joining the same room twice from the same socket is a no-op.

#### 2.7 Independent Session Resolution

Each session resolves its response independently of which pane has focus:

- **Sending**: User types in pane A's input and hits Enter → `chat:send` is emitted with pane A's `sessionId` → response streams into pane A's `SessionStreamState`
- **Switching focus**: User clicks pane B → pane A continues streaming (its Socket.IO room subscription is still active, events still update its `SessionStreamState`)
- **Permission dialogs**: If a session needs user approval, the dialog appears inline in that session's pane. If the pane is not focused, the pane header shows a notification badge (e.g., amber dot with "Needs approval")
- **Multiple streams**: If sessions A and B are both streaming simultaneously, both receive events independently through their respective Socket.IO rooms

#### 2.8 Split Controls UI

The header bar includes a **Split** button with a dropdown menu:

```
┌──────────────────┐
│ ⊞ Split          │
├──────────────────┤
│ ├ Split Right    │  ← Adds a vertical split from focused pane
│ ┬ Split Down     │  ← Adds a horizontal split from focused pane
│ ─────────────────│
│ ▣ Reset Layout   │  ← Back to single pane
└──────────────────┘
```

Each pane header also has:
- **Session selector**: Dropdown to pick which session to display (or create a new one)
- **Close button** (×): Closes this pane (if more than one pane exists)
- **Notification badges**: Amber dot for pending permission/input, green dot for active streaming

**Pane close behavior**: Closing a pane **does not** stop or delete its session. The pane leaves the Socket.IO room (`chat:leave`), and the layout tree is pruned, but the CopilotBridge session continues running on the worker. If the session was streaming, it keeps streaming — results are buffered server-side and delivered when the user reopens that session in any pane. If a session is actively awaiting user permission when its pane is closed, the request times out according to the CopilotBridge's permission timeout (ADR-047 §11). A confirmation dialog is shown before closing a pane with a pending permission request to warn the user.

Keyboard shortcuts (use `Cmd` on macOS):

- `Ctrl+\` — Split right
- `Ctrl+Shift+\` — Split down
- `Ctrl+Shift+W` — Close focused pane (with confirmation if session is streaming). Uses `Shift` modifier to avoid conflicting with the browser's `Ctrl+W` (close tab).
- `Alt+1/2/3/4` — Focus pane by index. Uses `Alt` to avoid conflicting with browser tab switching (`Ctrl+1-9`).
- `Alt+[` / `Alt+]` — Cycle focus between panes (previous / next). Avoids `Ctrl+Tab` which browsers reserve for tab switching.

> **Browser shortcut conflicts**: `Ctrl+W`, `Ctrl+Tab`, and `Ctrl+1-9` are reserved by browsers and cannot be reliably intercepted by web applications. All pane shortcuts use `Alt` or `Ctrl+Shift` modifiers to avoid collisions.

#### 2.9 Responsive Behavior

- **< 768px viewport width**: Multi-pane disabled. Only single pane with session tabs for switching.
- **768px–1200px**: Max 2 panes allowed.
- **> 1200px**: Full 4-pane support.

When the viewport shrinks below a threshold and panes would violate the minimum size, the layout automatically collapses excess panes into tabs on the last remaining pane.

### 3. Component Tree

```
ChatPage
├── ChatHeaderBar
│   ├── ModelSelector
│   ├── EffortSelector
│   ├── ToolDisplayModeSelector      ← NEW
│   └── SplitMenu                    ← NEW
├── ChatLayoutRenderer               ← NEW (renders LayoutNode tree)
│   ├── SplitContainer               ← NEW (draggable divider)
│   │   ├── ChatPane (pane-1)        ← NEW (independent session)
│   │   │   ├── ChatPaneHeader       ← NEW (session selector, close, badges)
│   │   │   ├── ChatMessageList      (existing, now per-pane)
│   │   │   │   └── ChatContentBlock
│   │   │   │       └── ChatToolExecution  (reads toolDisplayMode)
│   │   │   └── ChatInputBar         (existing, now per-pane)
│   │   └── ChatPane (pane-2)
│   └── ...
└── ChatSessionPickerDialog          ← NEW (shown in empty panes)
```

### 4. New Files

```
src/stores/
  chat-global-preferences-store.ts  — Tool display mode + future global chat preferences
  chat-layout-store.ts              — Split layout tree, pane→session mapping

src/components/chat/
  ChatLayoutRenderer.tsx             — Recursive LayoutNode → DOM renderer
  SplitContainer.tsx                 — Two children + draggable divider
  ChatPane.tsx                       — Independent session pane (joins/leaves rooms)
  ChatPaneHeader.tsx                 — Session selector, close, notification badges
  ToolDisplayModeSelector.tsx        — Segmented control for compact/standard/verbose
  SplitMenu.tsx                      — Split right/down/reset dropdown
  ChatSessionPickerDialog.tsx        — Session list for assigning to empty panes

src/utils/
  tool-intent.ts                     — Tool name → human-readable intent string
  tool-display-config.ts             — Per-tool key arguments + result summarizer
```

### 5. Migration from ADR-047

The changes are **additive** — no existing APIs or Socket.IO events change:

| ADR-047 Concept | Change |
|----------------|--------|
| `activeSessionId` in chat-store | Removed. Replaced by `chat-layout-store` pane→session mapping |
| `streamingContent`, `isStreaming` (top-level) | Moved into per-session `SessionStreamState` |
| `ChatPage` renders single `ChatMessageList` | `ChatPage` renders `ChatLayoutRenderer` which recurses into `ChatPane` components |
| `renre-chat-active-session:{pid}` localStorage | Replaced by `renre-chat-layout:{pid}` which includes all pane→session assignments |
| `ChatToolExecution` rendering | Now reads `toolDisplayMode` from `useChatGlobalPreferencesStore`; delegates to compact/standard/verbose renderer |
| `chat:send` Socket.IO event | Unchanged — but now multiple panes may emit concurrently for different sessions |

### 6. Constraints & Limits

- **Max 4 panes** — prevents excessive resource consumption (each pane holds a Socket.IO room subscription + message history in memory)
- **Max concurrent streaming sessions**: limited by CopilotBridge's ability to handle concurrent SDK sessions. The bridge already supports multiple `ChatSession` instances (ADR-047 §2). No artificial limit added — but UI should indicate when a session is queued if the bridge rate-limits
- **Tool display mode is global** — intentionally not per-session to avoid cognitive overhead of mixed rendering in a split view
- **No multi-user collaboration** — single-user only, no presence or conflict resolution needed
- **Layout persistence is per-project** — different projects can have different layouts

## Consequences

### Positive
- Users can monitor long-running agent sessions while working in another session
- Reduced visual noise for experienced users via compact tool display
- Full debugging capability preserved via verbose mode
- Existing Socket.IO room architecture (ADR-048) supports multi-pane with zero backend changes
- Layout tree model is flexible enough for future enhancements (e.g., tabbed panes, floating panes)

### Negative
- Increased frontend complexity — layout tree rendering, per-pane state isolation, draggable dividers
- Memory usage scales with open panes (each pane holds its session's message history)
- Tool intent generation requires maintaining a mapping for each tool (fallback exists for unknown tools)
- Global tool display mode means users cannot have verbose in one pane and compact in another

### Risks
- Multiple concurrent streaming sessions may stress the CopilotBridge or Copilot CLI — needs load testing
- Responsive collapse (4 panes → 2 → 1) may lose user context if not handled gracefully
- Tool intent strings may be inaccurate for extension/MCP tools with unusual argument shapes — fallback must be robust
