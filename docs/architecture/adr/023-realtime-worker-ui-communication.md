# ADR-023: Real-Time Communication Between Worker Service and Console UI

## Status
Superseded by [ADR-048: Socket.IO Real-Time Communication](048-socket-io-realtime-communication.md)

## Context
Several flows require the Console UI to react in real-time to worker service events:
- Extension installed/uninstalled → sidebar must update
- Extension settings changed → extension remounts → UI refreshes
- Project registered/unregistered → project dropdown updates
- Extension upgrade → UI reloads extension bundle
- MCP process crash/reconnect → status indicator updates

Options considered:
1. **Polling** — UI periodically fetches state from worker API
2. **Server-Sent Events (SSE)** — one-way stream from worker to UI
3. **WebSocket** — bidirectional communication

## Decision

### Server-Sent Events (SSE)

**SSE** is the right choice because:
- Communication is one-directional (worker → UI notifications)
- UI already makes HTTP requests for actions (install, settings) — no need for bidirectional channel
- SSE auto-reconnects on disconnect (built into browser `EventSource` API)
- Simpler than WebSocket — no handshake protocol, works over standard HTTP
- Compatible with Express.js without additional libraries

The UI uses standard HTTP requests for actions (POST install, POST settings) and receives push notifications via SSE for state changes.

### SSE Endpoint

```
GET /api/events
```

Worker service keeps the connection open and pushes events as they happen.

### Event Types

| Event | Payload | Trigger |
|-------|---------|---------|
| `project:registered` | `{ projectId, name, path }` | `renre-kit start` |
| `project:unregistered` | `{ projectId }` | `renre-kit stop` |
| `extension:mounted` | `{ projectId, name, version }` | Extension load on project start |
| `extension:unmounted` | `{ projectId, name }` | Extension unload |
| `extension:installed` | `{ projectId, name, version }` | `marketplace add` |
| `extension:removed` | `{ projectId, name }` | `marketplace remove` |
| `extension:upgraded` | `{ projectId, name, oldVersion, newVersion }` | `marketplace upgrade` |
| `extension:remounted` | `{ projectId, name, version }` | Settings change → remount |
| `extension:error` | `{ projectId, name, error }` | Extension load/runtime error |
| `mcp:connected` | `{ projectId, extensionName, transport }` | MCP server ready |
| `mcp:disconnected` | `{ projectId, extensionName, reason }` | MCP crash or disconnect |
| `vault:updated` | `{ action: "set" \| "delete", key }` | Vault secret changed |
| `updates:available` | `{ extensions: [{name, current, latest}] }` | Update check completed |

### Worker Service Implementation

```typescript
// worker-service/src/routes/events.ts
import { Router, Request, Response } from "express";
import { EventEmitter } from "events";

// Global event bus — worker components emit events here
export const eventBus = new EventEmitter();

const router = Router();

router.get("/events", (req: Request, res: Response) => {
  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.flushHeaders();

  // Send keepalive every 30 seconds
  const keepalive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, 30000);

  // Forward events to SSE stream
  const handler = (event: string, data: unknown) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  eventBus.on("event", handler);

  // Cleanup on disconnect
  req.on("close", () => {
    clearInterval(keepalive);
    eventBus.off("event", handler);
  });
});

export { router as eventsRouter };

// Usage in other worker components:
// eventBus.emit("event", "extension:mounted", { projectId, name, version });
```

### Console UI Implementation

```typescript
// api/events.ts
import { useEffect } from "react";
import { useExtensionStore } from "../stores/extension-store";
import { useProjectStore } from "../stores/project-store";
import { useNotificationStore } from "../stores/notification-store";
import { invalidateExtensionModule } from "../lib/extension-loader";

export function useWorkerEvents(workerBaseUrl: string) {
  useEffect(() => {
    const source = new EventSource(`${workerBaseUrl}/api/events`);

    source.addEventListener("extension:installed", (e) => {
      const data = JSON.parse(e.data);
      useExtensionStore.getState().fetchExtensions(data.projectId);
      useNotificationStore.getState().addToast(
        `Installed ${data.name}@${data.version}`
      );
    });

    source.addEventListener("extension:removed", (e) => {
      const data = JSON.parse(e.data);
      useExtensionStore.getState().fetchExtensions(data.projectId);
      invalidateExtensionModule(data.name);
    });

    source.addEventListener("extension:upgraded", (e) => {
      const data = JSON.parse(e.data);
      invalidateExtensionModule(data.name);
      useExtensionStore.getState().fetchExtensions(data.projectId);
    });

    source.addEventListener("extension:remounted", (e) => {
      const data = JSON.parse(e.data);
      invalidateExtensionModule(data.name);
      // Extension page will re-render with fresh module
    });

    source.addEventListener("project:registered", (e) => {
      useProjectStore.getState().fetchProjects();
    });

    source.addEventListener("project:unregistered", (e) => {
      useProjectStore.getState().fetchProjects();
    });

    source.addEventListener("updates:available", (e) => {
      const data = JSON.parse(e.data);
      useNotificationStore.getState().setAvailableUpdates(data.extensions);
    });

    source.addEventListener("extension:error", (e) => {
      const data = JSON.parse(e.data);
      useNotificationStore.getState().addToast(
        `Error in ${data.name}: ${data.error}`,
        "error"
      );
    });

    // Auto-reconnect is built into EventSource
    source.onerror = () => {
      console.warn("SSE connection lost, reconnecting...");
    };

    return () => source.close();
  }, [workerBaseUrl]);
}
```

```tsx
// App.tsx — connect events at shell level
function App() {
  const workerPort = useProjectStore((s) => s.workerPort);
  useWorkerEvents(`http://localhost:${workerPort}`);

  return (
    <div className="flex h-screen">
      <Sidebar />
      <div className="flex-1 flex flex-col">
        <Toolbar />
        <ContentArea>
          <Outlet />
        </ContentArea>
      </div>
    </div>
  );
}
```

## Consequences

### Positive
- Real-time UI updates without polling — instant sidebar/toolbar refresh
- SSE is simple — no WebSocket library, no handshake, native browser API
- Auto-reconnect built into `EventSource` — resilient to network blips
- Event bus pattern decouples worker components from SSE transport
- One SSE connection per browser tab — minimal overhead

### Negative
- SSE is one-directional — UI can't send messages back (uses HTTP for that)
- Maximum ~6 concurrent SSE connections per browser to same origin
- No binary data support (not needed for our events)

### Mitigations
- One-directional is fine — UI actions use regular HTTP POST/PUT/DELETE
- 6 connection limit is per-origin, and we only need 1 SSE connection per tab
- All payloads are small JSON — text-based SSE is ideal
