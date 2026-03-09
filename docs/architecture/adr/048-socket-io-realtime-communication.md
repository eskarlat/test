# ADR-048: Socket.IO for All Real-Time Communication (supersedes ADR-023)

## Status
Proposed (supersedes ADR-023)

## Context

ADR-023 established Server-Sent Events (SSE) as the real-time transport between the worker service and Console UI. At the time, communication was strictly one-directional (worker → UI notifications) with UI actions flowing through separate HTTP requests.

ADR-047 introduced Console Chat with the Copilot SDK, which requires **bidirectional** communication — streaming responses from the LLM (server → client) plus cancel, permission responses, and message sending (client → server). ADR-047 proposed a separate per-session WebSocket alongside the existing SSE channel, creating a dual-transport architecture:

```
Before ADR-047:   SSE (system events)                     = 1 connection
ADR-047 proposed: SSE (system events) + WS per chat session = N+1 connections
```

This dual-transport approach has drawbacks:
- Two different connection management strategies (EventSource auto-reconnect vs manual WS reconnect)
- Two different serialization formats
- Chat events isolated from system events (can't easily correlate)
- Each chat session opens a new connection

**Socket.IO** unifies all real-time communication under a single connection with **rooms** for scoping, **built-in reconnection**, **long-polling fallback**, and **acknowledgments** for request/response patterns.

## Decision

Replace SSE (`GET /api/events`) with **Socket.IO** for all real-time communication between the worker service and Console UI. The existing `EventBus` remains the central hub — only the transport layer changes.

### 1. Architecture

```
Console UI (React)                  Worker Service (Express + Socket.IO)
┌─────────────────────┐            ┌─────────────────────────────┐
│  useSocket() hook   │◄── io ────►│  Socket.IO Server           │
│                     │            │    ├── room: "system"        │
│  Stores:            │            │    ├── room: "project:{pid}" │
│    extension-store  │            │    └── room: "chat:{sid}"    │
│    project-store    │            │                              │
│    vault-store      │            │  EventBus (unchanged)        │
│    session-store    │            │    ← 17 publisher files      │
│    chat-store       │            │                              │
│    ... (10 stores)  │            │  REST API (unchanged)        │
│                     │── HTTP ───►│    GET/POST/PUT/DELETE        │
└─────────────────────┘            └─────────────────────────────┘
```

**One Socket.IO connection per browser tab**. Rooms provide scoping. REST API remains for queries (GET) and CRUD commands that return response bodies.

### 2. Server Setup

```typescript
// packages/worker-service/src/index.ts
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
  pingInterval: 25000,    // Built-in heartbeat (replaces manual keepalive)
  pingTimeout: 20000,
  connectionStateRecovery: {
    maxDisconnectionDuration: 120000,  // 2 min — buffer events during disconnect
  },
});

// All existing Express routes remain unchanged
app.use("/api", projectRouter);
app.use("/api", extensionRoutes);
// ...

httpServer.listen(port);
```

### 3. Room Design

```
Socket.IO Server
│
├── room: "system"                              // All clients auto-join
│   ├── extension:mounted   { projectId, name, version }
│   ├── extension:unmounted { projectId, name }
│   ├── extension:installed { projectId, name, version }
│   ├── extension:removed   { projectId, name }
│   ├── extension:upgraded  { projectId, name, oldVersion, newVersion }
│   ├── extension:remounted { projectId, name, version }
│   ├── extension:enabled   { projectId, name }
│   ├── extension:disabled  { projectId, name }
│   ├── extension:error     { projectId, name, error }
│   ├── project:registered  { projectId, name, path }
│   ├── project:unregistered { projectId }
│   ├── mcp:connected       { projectId, extensionName, transport }
│   ├── mcp:disconnected    { projectId, extensionName, reason }
│   ├── vault:updated       { action, key }
│   └── updates:available   { extensions: [...] }
│
├── room: "project:{projectId}"                 // Client joins when viewing project
│   ├── session:started     { sessionId, source }
│   ├── session:ended       { sessionId, summary }
│   ├── observation:created { id, category, content }
│   ├── observation:updated { id, category, content }
│   ├── tool:used           { toolName, extensionName, duration }
│   ├── tool:denied         { toolName, rule, reason }
│   ├── prompt:recorded     { id, prompt, timestamp }
│   ├── error:recorded      { fingerprint, message, count }
│   ├── subagent:started    { id, type, parentId }
│   └── subagent:stopped    { id, type, duration }
│
└── room: "chat:{sessionId}"                    // Client joins when opening chat
    │
    ├── server → client:
    │   ├── message-delta    { deltaContent }
    │   ├── message          { content, role }
    │   ├── reasoning-delta  { deltaContent }
    │   ├── reasoning        { content, tokens }
    │   ├── turn-start       { turnId }
    │   ├── turn-end         { turnId }
    │   ├── tool-start       { toolCallId, roundId, toolName, arguments }
    │   ├── tool-partial     { toolCallId, partialOutput }
    │   ├── tool-progress    { toolCallId, progressMessage }
    │   ├── tool-complete    { toolCallId, success, result, error }
    │   ├── subagent-start   { toolCallId, agentName, agentDisplayName }
    │   ├── subagent-complete { toolCallId, agentName }
    │   ├── subagent-failed  { toolCallId, agentName, error }
    │   ├── permission-request { requestId, kind, details, diff? }
    │   ├── input-request    { requestId, question }
    │   ├── elicitation-request { requestId, schema }
    │   ├── title-changed    { title }
    │   ├── compaction-start {}
    │   ├── compaction-complete { tokensRemoved, summary }
    │   ├── usage            { contextWindowPct }
    │   ├── idle             {}
    │   └── error            { message, recoverable }
    │
    └── client → server:
        ├── chat:send        { prompt, attachments? }
        ├── chat:cancel      {}
        ├── chat:permission  { requestId, decision }
        ├── chat:input       { requestId, answer }
        └── chat:elicitation { requestId, data }
```

### 4. EventBus → Socket.IO Bridge

The `EventBus` is unchanged. A thin adapter forwards events to Socket.IO rooms:

```typescript
// packages/worker-service/src/core/socket-bridge.ts
import { Server } from "socket.io";
import { eventBus, WorkerEvent } from "./event-bus.js";

export function attachSocketBridge(io: Server): void {
  // Forward all EventBus events to appropriate rooms
  eventBus.on("event", (event: WorkerEvent) => {
    const { type, payload } = event;

    if (isSystemEvent(type)) {
      io.to("system").emit(type, payload);
    }

    if (isProjectEvent(type) && payload.projectId) {
      io.to(`project:${payload.projectId}`).emit(type, payload);
    }
  });

  // Connection handling
  io.on("connection", (socket) => {
    // All clients join system room automatically
    socket.join("system");

    // Send buffered event history for gap recovery
    const history = eventBus.getHistory();
    socket.emit("event-history", history);

    // Client joins/leaves project rooms
    socket.on("project:join", (projectId: string) => {
      socket.join(`project:${projectId}`);
    });

    socket.on("project:leave", (projectId: string) => {
      socket.leave(`project:${projectId}`);
    });

    // Client joins/leaves chat session rooms
    socket.on("chat:join", (sessionId: string) => {
      socket.join(`chat:${sessionId}`);
    });

    socket.on("chat:leave", (sessionId: string) => {
      socket.leave(`chat:${sessionId}`);
    });

    // Chat client → server messages (forwarded to CopilotBridge)
    socket.on("chat:send", async (data, ack) => {
      // ... forward to CopilotBridge, ack when accepted
    });

    socket.on("chat:cancel", async (data) => {
      // ... forward to CopilotBridge.cancelGeneration()
    });

    socket.on("chat:permission", async (data) => {
      // ... resolve permission callback
    });

    socket.on("chat:input", async (data) => {
      // ... resolve input callback
    });

    socket.on("chat:elicitation", async (data) => {
      // ... resolve elicitation callback
    });

    socket.on("disconnect", (reason) => {
      // Socket.IO handles cleanup automatically
      // Rooms are left on disconnect
    });
  });
}
```

The 17 worker files that call `eventBus.publish()` require **zero changes**.

### 5. CopilotBridge → Socket.IO Integration

The CopilotBridge (ADR-047) forwards SDK session events to the chat room instead of a dedicated WebSocket:

```typescript
// Inside CopilotBridge.attachEventListeners()
private attachEventListeners(sdkSession: CopilotSession, sessionId: string): void {
  const room = `chat:${sessionId}`;

  sdkSession.on("assistant.message_delta", (event) => {
    this.io.to(room).emit("message-delta", { deltaContent: event.data.deltaContent });
  });

  sdkSession.on("tool.execution_start", (event) => {
    this.io.to(room).emit("tool-start", {
      toolCallId: event.data.toolCallId,
      roundId: event.data.roundId,
      toolName: event.data.toolName,
      arguments: event.data.arguments,
    });
  });

  // ... all other SDK events mapped to room emissions
}
```

No per-session WebSocket endpoint needed. Chat clients just `socket.emit("chat:join", sessionId)`.

### 6. Console UI Client

#### 6.1 Shared Socket Hook

```typescript
// packages/console-ui/src/api/socket.ts
import { io, Socket } from "socket.io-client";
import { create } from "zustand";

interface SocketState {
  socket: Socket | null;
  status: "connected" | "reconnecting" | "disconnected";
  connect(baseUrl: string): void;
  disconnect(): void;
}

export const useSocketStore = create<SocketState>((set, get) => ({
  socket: null,
  status: "disconnected",

  connect(baseUrl: string) {
    const socket = io(baseUrl, {
      transports: ["websocket", "polling"],  // Prefer WS, fallback to polling
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });

    socket.on("connect", () => {
      set({ status: "connected" });
    });

    socket.on("disconnect", () => {
      set({ status: "reconnecting" });
    });

    socket.on("reconnect_failed", () => {
      set({ status: "disconnected" });
    });

    // Receive buffered history on connect for gap recovery
    socket.on("event-history", (history) => {
      // Process buffered events to catch up
    });

    set({ socket });
  },

  disconnect() {
    get().socket?.disconnect();
    set({ socket: null, status: "disconnected" });
  },
}));
```

#### 6.2 System Events Hook (replaces `useWorkerEvents`)

```typescript
// packages/console-ui/src/api/events.ts
import { useEffect } from "react";
import { useSocketStore } from "./socket";
import { useExtensionStore } from "../stores/extension-store";
import { useProjectStore } from "../stores/project-store";
import { useNotificationStore } from "../stores/notification-store";
import { invalidateExtensionModule } from "../lib/extension-loader";

export function useSystemEvents() {
  const socket = useSocketStore((s) => s.socket);

  useEffect(() => {
    if (!socket) return;

    // Same event handlers as before — only the binding API changes
    socket.on("extension:installed", (data) => {
      useExtensionStore.getState().fetchExtensions(data.projectId);
      useNotificationStore.getState().addToast(`Installed ${data.name}@${data.version}`);
    });

    socket.on("extension:removed", (data) => {
      useExtensionStore.getState().fetchExtensions(data.projectId);
      invalidateExtensionModule(data.name);
    });

    socket.on("extension:upgraded", (data) => {
      invalidateExtensionModule(data.name);
      useExtensionStore.getState().fetchExtensions(data.projectId);
    });

    socket.on("project:registered", () => {
      useProjectStore.getState().fetchProjects();
    });

    // ... all other system event handlers (unchanged logic)

    return () => {
      socket.off("extension:installed");
      socket.off("extension:removed");
      socket.off("extension:upgraded");
      socket.off("project:registered");
      // ... cleanup all handlers
    };
  }, [socket]);
}
```

#### 6.3 Project Room Management

```typescript
// packages/console-ui/src/api/events.ts (continued)

export function useProjectEvents(projectId: string | null) {
  const socket = useSocketStore((s) => s.socket);

  useEffect(() => {
    if (!socket || !projectId) return;

    socket.emit("project:join", projectId);

    socket.on("session:started", (data) => {
      useSessionStore.getState().fetchSessions(projectId);
    });

    socket.on("observation:created", (data) => {
      useObservationStore.getState().fetchObservations(projectId);
    });

    socket.on("tool:used", (data) => {
      useToolAnalyticsStore.getState().fetchAnalytics(projectId);
    });

    // ... other project-scoped handlers

    return () => {
      socket.emit("project:leave", projectId);
      socket.off("session:started");
      socket.off("observation:created");
      socket.off("tool:used");
    };
  }, [socket, projectId]);
}
```

#### 6.4 Chat Room Management

```typescript
// packages/console-ui/src/stores/chat-store.ts (relevant excerpt)

joinSession(sessionId: string) {
  const socket = useSocketStore.getState().socket;
  if (!socket) return;

  socket.emit("chat:join", sessionId);

  socket.on("message-delta", (data) => { /* buffer + accumulate */ });
  socket.on("reasoning-delta", (data) => { /* buffer + accumulate */ });
  socket.on("tool-start", (data) => { /* add to activeTools */ });
  socket.on("tool-complete", (data) => { /* update tool status */ });
  socket.on("permission-request", (data) => { /* show dialog */ });
  socket.on("idle", () => { /* turn complete */ });
  // ...

  set({ activeSessionId: sessionId });
},

leaveSession() {
  const socket = useSocketStore.getState().socket;
  const { activeSessionId } = get();
  if (!socket || !activeSessionId) return;

  socket.emit("chat:leave", activeSessionId);
  socket.off("message-delta");
  socket.off("reasoning-delta");
  // ... remove all chat handlers

  set({ activeSessionId: null });
},

sendMessage(prompt: string, attachments?: Attachment[]) {
  const socket = useSocketStore.getState().socket;
  socket?.emit("chat:send", { prompt, attachments });
},

cancelGeneration() {
  const socket = useSocketStore.getState().socket;
  socket?.emit("chat:cancel", {});
},

respondToPermission(requestId: string, decision: "approved" | "denied") {
  const socket = useSocketStore.getState().socket;
  socket?.emit("chat:permission", { requestId, decision });
},
```

### 7. Connection Lifecycle

```
Browser tab opens
  → socket.connect()
  → auto-join "system" room
  → receive event-history (gap recovery)
  → status: "connected"

User navigates to project page
  → emit("project:join", projectId)
  → receive project-scoped events

User opens chat session
  → emit("chat:join", sessionId)
  → receive chat streaming events
  → emit("chat:send", { prompt })

Network drops
  → Socket.IO auto-reconnects (1s, 2s, 4s... max 5s)
  → status: "reconnecting"
  → connectionStateRecovery replays buffered events
  → status: "connected"
  → rooms auto-rejoined (Socket.IO handles this)

User closes tab
  → socket.disconnect()
  → server removes from all rooms
```

### 8. What REST API Still Handles

Socket.IO does **not** replace REST for request/response operations:

| Pattern | Transport | Examples |
|---------|-----------|---------|
| **Queries** (fetch data) | REST GET | List extensions, get session messages, list models |
| **Commands** (CRUD) | REST POST/PUT/DELETE | Create session, delete session, install extension |
| **Events** (push notifications) | Socket.IO | Extension mounted, vault updated, chat streaming |
| **Streaming** (high-frequency) | Socket.IO | Message deltas, reasoning deltas, tool progress |
| **Bidirectional** (interactive) | Socket.IO | Chat send/cancel, permission approve/deny |

**Rule of thumb**: If the operation returns a response body or needs HTTP semantics (status codes, caching, URL addressability), use REST. If it's a notification, stream, or fire-and-forget action, use Socket.IO.

### 9. Migration from SSE

| File | Change | Impact |
|------|--------|--------|
| `worker-service/src/index.ts` | `createServer(app)` + `new Server(server)` + `attachSocketBridge(io)` | Bootstrap |
| `worker-service/src/routes/events.ts` | Delete SSE endpoint, replace with `socket-bridge.ts` | Transport layer |
| `worker-service/src/core/event-bus.ts` | **No change** — ring buffer + publish() unchanged | None |
| 17 publisher files | **No change** — still call `eventBus.publish()` | None |
| `console-ui/src/api/events.ts` | Replace `EventSource` → `useSystemEvents()` + `useProjectEvents()` | Transport layer |
| `console-ui/src/api/socket.ts` | **New** — shared Socket.IO connection + store | New file |
| 10 consumer stores | **No change** — called by event hooks, not transport | None |
| `console-ui/src/stores/connection-store.ts` | Update to use Socket.IO lifecycle events | Small |
| `console-ui/src/components/layout/ReconnectionBanner.tsx` | Change "SSE" references to "Socket" in comments | Cosmetic |
| `console-ui/package.json` | Add `socket.io-client` dependency | Dependency |
| `worker-service/package.json` | Add `socket.io` dependency | Dependency |
| `rules/nodejs.md` | Update SSE section to Socket.IO patterns | Documentation |

**Deleted**: `GET /api/events` SSE endpoint, `GET /api/events/history` endpoint.

### 10. Dependencies

| Package | Side | Size (gzipped) |
|---------|------|----------------|
| `socket.io` | Worker (Node.js) | ~30KB |
| `socket.io-client` | Console UI (Browser) | ~45KB |

Socket.IO is battle-tested, actively maintained, and widely used. No additional transitive dependencies of concern.

## Consequences

### Positive
- **Single connection** for all real-time communication — system events, project events, and chat streaming
- **Bidirectional** — chat cancel, permission responses, and message sending flow through the same connection instead of separate HTTP calls
- **Built-in reconnection** with exponential backoff, packet buffering, and `connectionStateRecovery` — eliminates custom reconnection logic
- **Rooms** provide natural scoping — project events, chat sessions, system events all isolated without separate endpoints
- **Long-polling fallback** — works through corporate proxies that block WebSocket upgrade
- **Acknowledgments** — server can confirm receipt of client messages (useful for chat:send, permission responses)
- **EventBus unchanged** — 17 publisher files and the ring buffer require zero changes
- **10 consumer stores unchanged** — only the event binding layer changes
- **Eliminates dual-transport** from ADR-047 (SSE + per-session WS → single Socket.IO)

### Negative
- **Added dependency** — `socket.io` (30KB) + `socket.io-client` (45KB) vs native `EventSource` (0KB)
- **Slight complexity increase** — Socket.IO protocol has more moving parts than SSE (handshake, packet framing, binary protocol)
- **Server bootstrap change** — `app.listen()` → `createServer(app)` + `server.listen()` required for Socket.IO attachment
- **Testing** — Socket.IO tests need `socket.io-client` instead of simple HTTP requests

### Risks
- **Corporate proxy blocking** — Mitigated: Socket.IO's automatic long-polling fallback handles this transparently
- **Memory overhead** — Socket.IO maintains per-socket state. Negligible for a local tool with few connections
- **Version coupling** — `socket.io` server and `socket.io-client` must be compatible versions. Use exact same major version

## Alternatives Considered

1. **Keep SSE + add separate WebSocket for chat** (ADR-047 original) — Rejected: dual transport adds complexity, two reconnection strategies, N+1 connections
2. **Raw WebSocket (no Socket.IO)** — Rejected: would need to implement reconnection, room management, long-polling fallback, and packet buffering manually
3. **SSE with HTTP POST for bidirectional** — Rejected: permission response latency too high for interactive chat flows, no session-scoped channels
4. **GraphQL subscriptions** — Rejected: over-engineered for this use case, adds GraphQL dependency for minimal benefit

## References

- [Socket.IO documentation](https://socket.io/docs/v4/)
- [Socket.IO connection state recovery](https://socket.io/docs/v4/connection-state-recovery)
- ADR-023: Real-Time Communication (SSE) — **superseded by this ADR**
- ADR-045: Console UI Graceful Degradation (connection states remain compatible)
- ADR-047: Console Chat UI with Copilot SDK (chat events now use Socket.IO rooms)
