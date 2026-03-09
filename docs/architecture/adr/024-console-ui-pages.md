# ADR-024: Console UI Pages & Dashboard Layout

## Status
Accepted

## Context
The Console UI needs well-defined pages for both the initial view (no project selected) and the project home view. Users need at-a-glance visibility into system state, extension health, and AI agent activity.

## Decision

### Page Structure

| Page | URL | Context |
|------|-----|---------|
| **System Home** | `/` | No project selected — global overview |
| **Project Home** | `/:projectId` | Project selected — project dashboard |
| **Vault** | `/vault` | Global — accessible from toolbar |
| **Extension Manager** | `/extensions` | Per-project — install/remove/configure |
| **Logs** | `/logs` | Per-project — filterable log viewer |
| **Settings** | `/settings` | Global — server config, marketplaces |
| **Extension Page** | `/:projectId/:ext/:page` | Per-project — extension UI |

---

### System Home Page (`/`)

Shown when no project is selected or on first Console load.

```
┌─────────────────────────────────────────────────────────┐
│  Toolbar: [RenRe Kit]              [Vault 🔑] [⚙️]     │
├─────────────────────────────────────────────────────────┤
│                                                         │
│  Welcome to RenRe Kit Console                           │
│                                                         │
│  Server: running (port 42888) | Uptime: 2h 15m          │
│                                                         │
│  ┌─ Active Projects ─────────────────────────────────┐  │
│  │                                                   │  │
│  │  my-app              3 extensions    healthy      │  │
│  │  /Users/dev/my-app   1 MCP running               │  │
│  │                                        [Open →]   │  │
│  │                                                   │  │
│  │  backend-api         2 extensions    1 warning    │  │
│  │  /Users/dev/backend  0 MCPs                       │  │
│  │                                        [Open →]   │  │
│  │                                                   │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  ┌─ Recent Activity ─────────────────────────────────┐  │
│  │  14:23  my-app      Extension jira-plugin mounted │  │
│  │  14:20  backend-api Project registered            │  │
│  │  14:15  my-app      MCP github-mcp connected      │  │
│  │  14:10  —           Vault secret "gh_token" added │  │
│  └───────────────────────────────────────────────────┘  │
│                                                         │
│  No project running?                                    │
│  Run `renre-kit init` then `renre-kit start`            │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**System Home components:**

| Section | Data | Source |
|---------|------|--------|
| Server status | PID, port, uptime, memory | `GET /health` |
| Active projects | Name, path, extension count, MCP count, health | `GET /api/projects` |
| Recent activity | Last 20 events across all projects | SSE event history buffer |

---

### Project Home Page (`/:projectId`)

Shown when user selects a project from the dropdown or clicks "Open" on System Home.

```
┌─────────────────────────────────────────────────────────┐
│  Toolbar: [RenRe Kit]  [Project: my-app ▼]  [Vault] [⚙]│
├──────────┬──────────────────────────────────────────────┤
│ Sidebar  │                                              │
│          │  my-app — Dashboard                          │
│ Dashboard│                                              │
│ ──────── │  ┌─ Extensions (3) ────────────────────────┐ │
│ Jira     │  │                                         │ │
│  Issues  │  │  ✓ jira-plugin     1.0.0    healthy     │ │
│  Sessions│  │  ✓ github-mcp      0.5.0    MCP: stdio  │ │
│ ──────── │  │  ⓘ slack-notify   0.2.0    needs setup │ │
│ GitHub   │  │                                         │ │
│  Repos   │  │  ⬆ 1 update available                   │ │
│ ──────── │  └─────────────────────────────────────────┘ │
│ Slack    │                                              │
│  ⓘ      │  ┌─ Running MCPs (1) ──────────────────────┐ │
│          │  │                                         │ │
│          │  │  github-mcp   stdio   PID 12345         │ │
│          │  │  Uptime: 1h 30m  Tools: 12  Connected   │ │
│          │  │                                         │ │
│          │  └─────────────────────────────────────────┘ │
│          │                                              │
│          │  ┌─ Active Sessions (2) ───────────────────┐ │
│          │  │                                         │ │
│          │  │  Copilot  started 14:00  session-abc    │ │
│          │  │  Claude   started 14:10  session-def    │ │
│          │  │                                         │ │
│          │  └─────────────────────────────────────────┘ │
│          │                                              │
│          │  ┌─ Hook Activity ─────────────────────────┐ │
│          │  │                                         │ │
│          │  │  14:23 userPromptSubmitted  jira ✓ 120ms│ │
│          │  │  14:20 sessionStart    github-mcp ✓ 80ms│ │
│          │  │  14:15 userPromptSubmitted  jira ✗ timeout│
│          │  │                                         │ │
│          │  └─────────────────────────────────────────┘ │
│          │                                              │
│          │  ┌─ API Usage (last hour) ─────────────────┐ │
│          │  │                                         │ │
│          │  │  query jira issues          12 calls    │ │
│          │  │  query github-mcp mcp/call   8 calls    │ │
│          │  │  query jira add              3 calls    │ │
│          │  │  Avg response: 45ms                     │ │
│          │  │                                         │ │
│          │  └─────────────────────────────────────────┘ │
│          │                                              │
│          │  ┌─ Recent Logs ───────────────────────────┐ │
│          │  │                                         │ │
│          │  │  14:23 [INFO] ext:jira  GET /issues 200 │ │
│          │  │  14:22 [WARN] mcp:github reconnecting   │ │
│          │  │  14:20 [INFO] worker project registered  │ │
│          │  │                        [View all logs →] │ │
│          │  └─────────────────────────────────────────┘ │
│          │                                              │
└──────────┴──────────────────────────────────────────────┘
```

**Project Home components:**

| Section | Data | Source |
|---------|------|--------|
| **Extensions** | Name, version, status, config warning, update badge | `GET /api/{pid}/extensions` |
| **Running MCPs** | Extension name, transport, PID/URL, uptime, tool count, status | `GET /api/{pid}/mcp/status` |
| **Active Sessions** | Agent type, start time, session ID | `GET /api/{pid}/sessions` |
| **Hook Activity** | Recent hook executions: event, extension, success/fail, duration | `GET /api/{pid}/hooks/activity` |
| **API Usage** | Query command stats: extension, action, call count, avg latency | `GET /api/{pid}/stats/api` |
| **Recent Logs** | Last 10 log entries for this project | `GET /api/{pid}/logs?limit=10` |

### Extension Status Indicators

| Indicator | Meaning | Sidebar | Dashboard |
|-----------|---------|---------|-----------|
| ✓ (green) | Healthy — mounted, no errors | Normal text | "healthy" badge |
| ⓘ (yellow) | Needs setup — missing required settings or Vault secrets | Info icon on sidebar item | "needs setup" badge + link to settings |
| ✗ (red) | Error — failed to mount, MCP crashed | Error icon | "error" badge + link to error logs |
| ⬆ (blue) | Update available | — | Badge on extension row |

The **ⓘ needs setup** state is determined by:
1. Extension has `settings.schema` with required fields
2. Any required setting is missing or has unresolved `${VAULT:key}` reference
3. Extension is installed but cannot mount until configured

### Sidebar Structure

The sidebar is dynamic per project. It always includes core items at the top:

```
Dashboard                    ← Project Home (always present)
────────────────
Jira                        ← Extension with UI pages
  Issues
  Sessions
────────────────
GitHub MCP                  ← Extension with UI pages
  Repos
────────────────
Slack  ⓘ                   ← Needs setup indicator
────────────────
Extension Manager            ← Core page (always present)
Logs                        ← Core page (always present)
```

Core items (Dashboard, Extension Manager, Logs) are always shown. Extension items are generated from the active project's extension manifests — only extensions with `ui.pages` declared appear in the sidebar.

### Internal API Endpoints (for Dashboard)

These endpoints are used by the Console UI dashboard and are not part of the extension API:

| Endpoint | Method | Response |
|----------|--------|----------|
| `/health` | GET | `{ status, uptime, memoryUsage, port }` |
| `/api/projects` | GET | Active projects with extension counts |
| `/api/{pid}/extensions` | GET | Extension list with status, config state |
| `/api/{pid}/mcp/status` | GET | Running MCP processes/connections |
| `/api/{pid}/sessions` | GET | Active AI agent sessions |
| `/api/{pid}/hooks/activity` | GET | Recent hook executions (last 50) |
| `/api/{pid}/stats/api` | GET | Query command usage stats (last hour) |
| `/api/{pid}/logs` | GET | Log entries filtered by project |
| `/api/events` | GET (SSE) | Real-time event stream |
| `/api/errors` | POST | Error boundary reports from UI |

## Consequences

### Positive
- System Home gives immediate overview of all projects without selecting one
- Project Home surfaces the most important operational data at a glance
- Extension config warnings (ⓘ) prevent confusion about why extensions aren't working
- Hook activity and API usage give visibility into AI agent behavior
- Recent logs inline avoids switching to a separate page for quick debugging

### Negative
- Dashboard fetches from multiple endpoints — could be slow on first load
- API usage stats require request tracking in the worker service
- Hook activity requires execution logging (already covered in ADR-013)

### Mitigations
- Parallel data fetching with React Suspense boundaries per section
- Dashboard sections load independently — fast sections appear first
- Stats collection is lightweight (in-memory counters, flushed periodically)
- SSE keeps dashboard live after initial load — no constant polling
