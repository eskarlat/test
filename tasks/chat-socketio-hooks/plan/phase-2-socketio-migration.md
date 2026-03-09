# Phase 2 — Socket.IO Migration

## Goal

Replace SSE (Server-Sent Events) with Socket.IO as the unified real-time transport for all worker → UI communication. A single Socket.IO connection per browser tab replaces the SSE EventSource, using rooms for event scoping (system, project, chat). This prepares the infrastructure for Chat (Phase 4+).

## Reference

- ADR-048: Socket.IO Real-Time Communication (supersedes ADR-023)
- ADR-023: Real-Time Worker-UI Communication (now superseded)
- ADR-045: Console UI Graceful Degradation

## Dependencies

None — can run in parallel with Phase 1 and Phase 3.

## Tasks

### 2.1 Add Socket.IO Dependencies

- [ ] Add `socket.io@^4.8` to `packages/worker-service/package.json`
- [ ] Add `socket.io-client@^4.8` to `packages/console-ui/package.json`
- [ ] Run `pnpm install` and verify lockfile updates
- [ ] Verify no version conflicts with existing dependencies

### 2.2 Create Socket Bridge (Worker Service)

File: `packages/worker-service/src/core/socket-bridge.ts`

- [ ] Export `attachSocketBridge(io: Server): void` function
- [ ] Forward EventBus events to Socket.IO rooms:
  - System events (`extension:*`, `project:*`, `mcp:*`, `vault:*`, `updates:*`) → `system` room
  - Project events (`session:*`, `observation:*`, `tool:*`, `prompt:*`, `error:*`, `subagent:*`) → `project:{projectId}` room
- [ ] Define `isSystemEvent(type: string)` and `isProjectEvent(type: string)` classifier functions using event prefix
- [ ] Handle connection lifecycle:
  ```typescript
  io.on("connection", (socket) => {
    socket.join("system");  // Auto-join system room
    socket.emit("event-history", eventBus.getHistory());  // Gap recovery

    socket.on("project:join", (projectId: string) => {
      socket.join(`project:${projectId}`);
    });
    socket.on("project:leave", (projectId: string) => {
      socket.leave(`project:${projectId}`);
    });
    socket.on("chat:join", (sessionId: string) => {
      socket.join(`chat:${sessionId}`);
    });
    socket.on("chat:leave", (sessionId: string) => {
      socket.leave(`chat:${sessionId}`);
    });
  });
  ```
- [ ] Register chat event handlers as stubs (Phase 4 implements full logic).
  Document all 22 chat events in code comments for Phase 4 reference:
  - **Client → Server (5)**: `chat:send`, `chat:cancel`, `chat:permission`, `chat:input`, `chat:elicitation`
  - **Server → Client (17)**: `message-delta`, `message`, `reasoning-delta`, `reasoning`, `turn-start`, `turn-end`, `tool-start`, `tool-partial`, `tool-progress`, `tool-complete`, `subagent-start`, `subagent-complete`, `subagent-failed`, `permission-request`, `input-request`, `elicitation-request`, `title-changed`, `compaction-start`, `compaction-complete`, `usage`, `idle`, `error`
  - Stubs emit `error` event back to socket: `{ message: "Chat not available" }`
- [ ] Log connections, disconnections, and room joins at debug level

### 2.3 Update Worker Service Bootstrap

File: `packages/worker-service/src/index.ts`

- [ ] Switch from `app.listen(port)` to `createServer(app)` + `new Server(httpServer)`:
  ```typescript
  import { createServer } from "http";
  import { Server } from "socket.io";

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" },
    pingInterval: 25000,
    pingTimeout: 20000,
    connectionStateRecovery: {
      maxDisconnectionDuration: 120000,  // 2 min buffer
    },
  });

  attachSocketBridge(io);
  httpServer.listen(port);  // NOT app.listen()
  ```
- [ ] Store `io` instance accessible for later use by chat routes (Phase 4)
  - Export via module-level singleton or pass to route registration
- [ ] Verify all existing Express routes still work with `createServer(app)` wrapper
- [ ] Update graceful shutdown to close Socket.IO before HTTP server:
  ```typescript
  io.close();
  httpServer.close();
  ```

### 2.4 Deprecate SSE Endpoint

File: `packages/worker-service/src/routes/events.ts`

- [ ] Do NOT delete the file yet — keep SSE endpoint functional for backwards compatibility during migration
- [ ] Add deprecation header to SSE responses: `X-Deprecated: Use Socket.IO connection instead`
- [ ] Add a log warning on first SSE connection: `"SSE endpoint deprecated — migrate to Socket.IO (ADR-048)"`
- [ ] Comment the route registration in `app.ts` with `// Deprecated: ADR-048 — remove after console-ui migration`

### 2.5 Create Socket.IO Client Store (Console UI)

File: `packages/console-ui/src/api/socket.ts`

- [ ] Create `useSocketStore` Zustand store managing the shared Socket.IO connection:
  ```typescript
  interface SocketState {
    socket: Socket | null;
    status: "connecting" | "connected" | "reconnecting" | "disconnected";
    reconnectAttempts: number;

    connect(baseUrl: string): void;
    disconnect(): void;
  }
  ```
- [ ] Connection options:
  ```typescript
  const socket = io(baseUrl, {
    transports: ["websocket", "polling"],  // Prefer WS, fallback to polling
    reconnection: true,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 5000,
    reconnectionAttempts: Infinity,
  });
  ```
- [ ] Track lifecycle events:
  - `connect` → status `"connected"`, reset reconnectAttempts
  - `disconnect` → status `"reconnecting"`
  - `reconnect_attempt` → increment reconnectAttempts
  - `reconnect_failed` → status `"disconnected"`
  - `reconnect` → status `"connected"`, reset reconnectAttempts
- [ ] Handle `event-history` event for gap recovery: replay missed events to stores
- [ ] Export `useSocketStore` for use by event hooks and chat store

### 2.6 Migrate Event Hooks from SSE to Socket.IO

File: `packages/console-ui/src/api/events.ts`

- [ ] Replace `useWorkerEvents(workerBaseUrl: string)` with two hooks:
  - `useSystemEvents()` — subscribes to system-room events
  - `useProjectEvents(projectId: string | null)` — joins/leaves project room, subscribes to project events
- [ ] `useSystemEvents()` implementation:
  - Get `socket` from `useSocketStore`
  - Subscribe to all system events: `extension:installed`, `extension:removed`, `extension:upgraded`, `extension:remounted`, `extension:mounted`, `extension:unmounted`, `extension:error`, `project:registered`, `project:unregistered`, `mcp:connected`, `mcp:disconnected`, `vault:updated`, `updates:available`
  - Same handler logic as current SSE handlers (store refreshes, toasts, module invalidation)
  - Cleanup: `socket.off(...)` on unmount
- [ ] `useProjectEvents(projectId)` implementation:
  - Emit `project:join` on mount / projectId change
  - Emit `project:leave` on unmount / projectId change
  - Subscribe to project events: `session:started`, `session:ended`, `observation:created`, `observation:updated`, `tool:used`, `tool:denied`, `prompt:recorded`, `error:recorded`, `subagent:started`, `subagent:stopped`
  - Refresh relevant stores on each event
  - Cleanup: leave room + remove listeners
- [ ] Remove old `useWorkerEvents` hook and its `EventSource` usage

### 2.7 Update Connection Status Components

File: `packages/console-ui/src/stores/connection-store.ts`

- [ ] Update to derive status from `useSocketStore` instead of tracking SSE connection
- [ ] Map Socket.IO states to existing connection states used by UI:
  - `connected` → connected
  - `reconnecting` → reconnecting (with attempt count)
  - `disconnected` → disconnected

File: `packages/console-ui/src/components/layout/ReconnectionBanner.tsx`

- [ ] Update any SSE-specific text/references to generic "connection" language
- [ ] Reconnection banner shows attempt count from `useSocketStore`
- [ ] Banner auto-dismisses on successful reconnection

File: `packages/console-ui/src/components/layout/ConnectionStatus.tsx`

- [ ] Update to read from `useSocketStore` status

### 2.8 Update Main App Integration

File: `packages/console-ui/src/main.tsx`

- [ ] Initialize Socket.IO connection at app startup:
  ```typescript
  const workerPort = useProjectStore((s) => s.workerPort);
  const connect = useSocketStore((s) => s.connect);

  useEffect(() => {
    connect(`http://localhost:${workerPort}`);
    return () => useSocketStore.getState().disconnect();
  }, [workerPort]);
  ```
- [ ] Replace `useWorkerEvents()` call with `useSystemEvents()` at root level
- [ ] Add `useProjectEvents(activeProjectId)` at the appropriate layout level (where project context is available)

### 2.9 Update Documentation

File: `rules/nodejs.md`

- [ ] Update the SSE section to document Socket.IO patterns:
  - Server setup: `createServer(app)` + `new Server(httpServer)`
  - Room-based event scoping (system, project, chat)
  - EventBus → Socket.IO bridge pattern
  - Client connection with `socket.io-client`
  - Remove or annotate SSE patterns as deprecated

### 2.10 Testing Strategy

- [ ] Add integration tests for socket-bridge using `socket.io-client` in Vitest:
  - Test system room: connect → verify auto-join → emit event via EventBus → verify client receives
  - Test project room: connect → emit `project:join` → emit project event via EventBus → verify client receives
  - Test room isolation: connect two clients, only one joins project → verify only joined client receives project event
  - Test event-history: connect → verify `event-history` emitted with EventBus ring buffer contents
  - Test chat stubs: emit `chat:send` → verify error response
- [ ] Test connection lifecycle:
  - Connect → status `"connected"`
  - Disconnect → auto-reconnect behavior
- [ ] Use `socket.io-client` directly in tests (not browser — Vitest runs in Node)
- [ ] Verify long-polling fallback: create server with `transports: ["polling"]` only → verify client still connects

### 2.11 Verification

```bash
# Build all packages
pnpm run build

# Run Socket.IO integration tests
pnpm --filter @renre-kit/worker-service test

# Start worker and verify Socket.IO is listening
# In browser console, connect:
# const socket = io("http://localhost:42888"); socket.on("connect", () => console.log("connected"))

# Verify SSE still works (deprecation path)
# curl -N http://localhost:42888/api/events

# Verify room joining
# socket.emit("project:join", "test-project")

# Verify WebSocket upgrade (browser DevTools → Network → WS tab)
# Verify long-polling fallback (block WS in DevTools → verify connection still works)

# Lint
pnpm run lint
pnpm run lint:duplication
```

## Files Created

```
packages/worker-service/src/core/socket-bridge.ts     — EventBus → Socket.IO adapter
packages/console-ui/src/api/socket.ts                  — Shared Socket.IO client + Zustand store
```

## Files Modified

```
packages/worker-service/package.json                   — Add socket.io dependency
packages/console-ui/package.json                       — Add socket.io-client dependency
packages/worker-service/src/index.ts                   — createServer + Socket.IO setup
packages/worker-service/src/routes/events.ts           — Deprecation warning
packages/worker-service/src/app.ts                     — Comment SSE route as deprecated
packages/console-ui/src/api/events.ts                  — Replace EventSource with Socket.IO hooks
packages/console-ui/src/stores/connection-store.ts     — Derive from useSocketStore
packages/console-ui/src/components/layout/ReconnectionBanner.tsx — Update text
packages/console-ui/src/components/layout/ConnectionStatus.tsx   — Read from useSocketStore
packages/console-ui/src/main.tsx                       — Initialize Socket.IO, swap event hooks
rules/nodejs.md                                        — Update SSE section to Socket.IO patterns
pnpm-lock.yaml                                         — Updated dependencies
```
