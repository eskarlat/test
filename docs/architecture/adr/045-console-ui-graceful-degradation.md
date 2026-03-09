# ADR-045: Console UI Graceful Degradation

## Status
Accepted

## Context
The Console UI is an SPA served by the worker service. When the worker stops (graceful shutdown, crash, or network issue), the UI loses both its data source (HTTP API) and its real-time event stream (SSE). Without explicit degradation handling, the user sees a blank page or cascading API errors with no explanation.

We need to define what the UI shows when:
- The worker service stops while the Console is open
- SSE connection drops temporarily
- Individual API calls fail

## Decision

### Connection Status Indicator

The toolbar displays a connection status indicator (right side, near settings icon):

| State | Visual | Trigger |
|---|---|---|
| Connected | Green dot (hidden after 3s) | SSE connected, API responsive |
| Reconnecting | Amber pulsing dot + "Reconnecting..." | SSE dropped, auto-reconnect in progress |
| Disconnected | Red dot + "Server offline" | 3+ failed reconnect attempts |

The indicator uses the SSE connection state as the primary signal. The `EventSource` API auto-reconnects on transient failures, so only sustained disconnections (3+ consecutive failures) trigger the "Disconnected" state.

### Reconnection Banner

When the connection enters "Disconnected" state, a non-dismissible banner appears below the toolbar:

```
Server offline — showing cached data. [Reconnect] [How to start]
```

- **Reconnect**: manually triggers SSE reconnection + `GET /health` check
- **How to start**: shows CLI command `renre-kit start` in a tooltip
- Banner auto-dismisses when connection is restored
- Banner does not block content area — it appears as a slim notification bar

### Cached State in Zustand Stores

Zustand stores persist to `localStorage` for read-only viewing while disconnected:

| Store | Cached Fields | Behavior When Disconnected |
|---|---|---|
| `project-store` | `activeProjectId`, `projects` | Show cached project list |
| `extension-store` | `extensions` per project | Show cached extension list |
| `vault-store` | `keys` (names only, never values) | Show cached key names |
| `notification-store` | `availableUpdates` | Show last known update info |

When disconnected:
- Stores serve cached data for **read-only** viewing
- Write operations (save settings, install extension, add vault secret) show an inline "Server offline" error on the action button — no modal, no redirect
- Sections that depend on API data show a "Cached" badge with "Last updated X ago" timestamp

### API Client Error Handling

The API client (`api/client.ts`) integrates with connection state:

1. **Connection error detection**: `fetch` network errors or `503` responses → update connection store to "Disconnected"
2. **Auto-recovery**: any successful API response → update connection store to "Connected"
3. **Per-request behavior**: components receive the error and decide how to render (cached data, error state, or empty state)

No global error overlay — errors are handled per-component to prevent one failed endpoint from breaking the entire page.

### SSE Reconnection Strategy

The `useWorkerEvents` hook (Phase 11) tracks reconnection attempts:

```
Attempt 1: immediate (EventSource auto-reconnect)
Attempt 2: 1 second delay
Attempt 3: 3 seconds delay
Attempt 4+: 5 seconds delay (max)
```

After 3 consecutive failed attempts → transition to "Disconnected" state.
On successful reconnect → fetch `GET /api/events/history` to fill any event gaps, then refresh all stores.

### Component-Level Degradation

Individual dashboard components handle API failures independently:

| API State | Component Behavior |
|---|---|
| Loading | Skeleton placeholder |
| Success | Render data normally |
| Error (server online) | Inline error with retry button |
| Error (server offline) | Show cached data with "Cached" badge, or empty state |

This prevents a single failed API call from cascading to the entire dashboard. Each section's Suspense boundary and error boundary operate independently (as already specified in Phase 12, task 12.7).

### Connection State Store

A new `connection-store` manages the global connection state:

```typescript
interface ConnectionStore {
  status: "connected" | "reconnecting" | "disconnected";
  lastConnectedAt: string | null;       // ISO timestamp
  reconnectAttempts: number;
  setStatus: (status: ConnectionStore["status"]) => void;
  incrementReconnectAttempts: () => void;
  resetReconnectAttempts: () => void;
}
```

Components use `useConnectionStore` to conditionally disable write actions, show cached badges, or display connection-aware empty states.

## Consequences

### Positive
- Users always see useful information — cached data or clear instructions to reconnect
- No blank pages or cascading error modals when worker stops
- Individual component failures don't crash the whole UI
- Auto-reconnect handles transient issues silently
- Connection status is visible but unobtrusive

### Negative
- Cached data may be stale — users could see outdated extension lists or project states
- `localStorage` persistence adds complexity to stores
- More states to handle in UI components (loading, error, cached, offline)

### Mitigations
- "Last updated" timestamps make staleness visible
- `localStorage` cache is invalidated on server restart (detected via health check version mismatch)
- Shared `useConnectionStatus()` hook and `ErrorState` component provide consistent patterns
- Connection store is a single source of truth — components don't independently track connection state
