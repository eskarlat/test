# Phase 12 — Console Dashboard

## Goal
Implement the System Home and Project Home dashboard pages with real data, including extension status, MCP status, sessions, hook activity, API usage stats, and recent logs.

## Reference
- ADR-024: Console UI Pages & Dashboard Layout
- ADR-013: Logging Strategy

## Dependencies
- Phase 11 (Console UI shell — layout, stores, routing)
- Phase 4 (extension system — extension list API)
- Phase 5 (Vault — vault keys API)

> **Soft dependencies**: Phase 12 renders Hook Activity (Phase 8) and Running MCPs (Phase 9) cards. These render empty states gracefully if Phases 8/9 are not yet complete — failed sections show inline error with retry button (task 12.7).
>
> **SSE available**: The EventBus, SSE endpoint, and `useWorkerEvents` hook are built in Phases 3 and 11. Dashboard components can subscribe to SSE events for real-time updates from the start. Phase 14 wires event emissions into all worker components — until then, events are emitted only from components already wired (project registration, etc.).

## Tasks

### 12.1 System Home page (`/`)
- [ ] Server status card: port, uptime, memory usage (from `GET /health`)
- [ ] Active projects list with extension count, MCP count, health status
- [ ] Each project card: name, path, "Open" button to navigate to project
- [ ] Recent activity feed: last 20 events (from in-memory SSE event buffer)
- [ ] Empty state: "No projects running" with CLI instructions

### 12.2 Project Home page (`/:projectId`)
- [ ] Extensions card: name, version, status badge (healthy/needs setup/error), update badge
- [ ] "Needs setup" links to extension settings page
- [ ] Running MCPs card: extension name, transport, PID/URL, uptime, tool count, status
- [ ] Active Sessions card: agent type, start time, session ID
- [ ] Hook Activity card: recent executions with event, extension, success/fail, duration
- [ ] API Usage card: query stats for last hour (extension, action, call count, avg latency)
- [ ] Recent Logs card: last 10 entries with "View all logs" link

### 12.2b Extension Manager page (`/extensions`) — basic version, enhanced by Phase 13 with marketplace tabs
- [ ] List installed extensions with status badges (healthy/needs setup/error/update available)
- [ ] Settings button opens `ExtensionSettingsForm` (from Phase 11)
- [ ] Disable/Enable toggle: calls `POST /api/projects/{id}/extensions/{name}/disable` or `/enable`
- [ ] Remove with confirmation dialog: `DELETE /api/{pid}/extensions/{name}`
- [ ] Upgrade button (if update available): `POST /api/{pid}/extensions/{name}/upgrade`
- [ ] "Needs setup" links navigate to extension settings page

### 12.3 Worker API endpoints for dashboard
- [ ] `GET /api/{pid}/stats/api` — return query usage stats (in-memory counters)
- [ ] Request tracking middleware: count requests per extension/action, track latency
- [ ] In-memory stats with hourly window (ring buffer or Map with timestamps)
- [ ] `GET /api/{pid}/logs?limit=N` — return recent log entries for project
- [ ] `POST /api/errors` — receive error boundary reports from Console UI

### 12.4 Vault page (`/vault`)
- [ ] List all vault key names (from `GET /api/vault/keys`)
- [ ] Add new secret: key name + value input, save button
- [ ] Delete secret: confirmation dialog, then delete
- [ ] Never display secret values — only key names
- [ ] Created/updated timestamps per key

### 12.5 Logs page (`/logs`)
- [ ] Fetch logs from `GET /api/{pid}/logs`
- [ ] Filter by level: info, warn, error, debug
- [ ] Filter by source: extension name, worker core
- [ ] Search text within log messages
- [ ] Auto-scroll to bottom (latest entries)
- [ ] Error entries expandable with full stack trace (from error JSONL)

### 12.6 Settings page (`/settings`)
- [ ] Server info: port, PID, data directory
- [ ] Registered marketplaces: list with name, URL, add/remove
- [ ] Global config display (read-only for v1)

### 12.7 Parallel data loading
- [ ] Each dashboard section loads independently with its own Suspense boundary
- [ ] Skeleton loading states per section (not full-page loader)
- [ ] Failed sections show inline error with retry button
- [ ] Fast sections render immediately while slow ones load

## Verification
```bash
# Start server with a registered project and extensions
renre-kit start

# Open Console
open http://localhost:42888

# System Home should show:
# - Server status (running, port, uptime)
# - Active project cards with extension counts
# - Recent activity feed

# Click into a project — Project Home should show:
# - Extension list with status badges
# - MCP connections (if any)
# - Active sessions (if any)
# - Hook activity
# - Recent logs

# Navigate to Vault:
# - List of vault keys
# - Add/delete functionality

# Navigate to Logs:
# - Filterable log viewer with search
```

## Files Created
```
packages/console-ui/src/
  routes/
    index.tsx              # System Home (full implementation)
    vault.tsx              # Vault page
    logs.tsx               # Log viewer
    settings.tsx           # Settings page
    [projectId]/
      index.tsx            # Project Home (full implementation)
  components/
    dashboard/
      ServerStatus.tsx
      ProjectCard.tsx
      ActivityFeed.tsx
      ExtensionList.tsx
      MCPStatus.tsx
      SessionList.tsx
      HookActivity.tsx
      APIUsage.tsx
      RecentLogs.tsx
    vault/
      VaultKeyList.tsx
      AddSecretDialog.tsx
    logs/
      LogViewer.tsx
      LogFilter.tsx
  api/
    hooks.ts               # Data fetching hooks (SWR or custom)

packages/worker-service/src/
  routes/logs.ts
  middleware/request-tracker.ts
```
