# DFD — CLI Query Command Flow

## Description
Data flow when an AI agent or developer uses `renre-kit query <extension> <action>`.

```mermaid
flowchart TD
    Actor["Developer / AI Agent"] -->|"renre-kit query jira issues --json"| CLI["CLI: Query Handler"]

    CLI -->|"Read project ID"| ProjConfig[".renre-kit/extensions.json"]
    ProjConfig -->|"project-id, extension list"| CLI

    CLI -->|"Validate extension is installed"| CLI
    CLI -->|"Build HTTP request"| HTTP["HTTP GET /api/{project-id}/jira/issues"]

    HTTP -->|"Route to worker"| Worker["Worker Service :42888"]
    Worker -->|"Resolve project namespace"| ProjRouter["Project Router"]
    ProjRouter -->|"Resolve extension router"| ExtRegistry["Extension Registry"]

    ExtRegistry -->|"If not loaded: lazy load"| ExtLoader["Extension Loader"]
    ExtLoader -->|"require(backend/index.js)"| ExtCode["Extension Backend Code"]
    ExtLoader -->|"Run pending migrations"| DB["SQLite DB"]

    ExtRegistry -->|"Dispatch to router"| ExtRouter["jira-plugin Router"]
    ExtRouter -->|"Query data"| DB
    DB -->|"Result rows"| ExtRouter
    ExtRouter -->|"JSON response"| Worker
    Worker -->|"HTTP response"| CLI

    CLI -->|"Format output (--json / table)"| Actor
```

## Data Flow Summary
| Step | From | To | Data |
|------|------|----|------|
| 1 | Actor | CLI | Command args: extension, action, flags |
| 2 | CLI | Project Config | Read project ID |
| 3 | CLI | Worker Service | HTTP request with project-scoped URL |
| 4 | Worker | Extension Registry | Route resolution |
| 5 | Extension Router | SQLite DB | Query with project_id scope |
| 6 | Worker | CLI | JSON response body |
| 7 | CLI | Actor | Formatted output (JSON or table) |

## Notes
- The CLI never talks to SQLite directly — always proxies through the worker service
- Extension routers are lazy-loaded on first request (see ADR-002)
- All DB queries are scoped by project ID
- `--json` flag outputs raw JSON; default is human-readable table format
