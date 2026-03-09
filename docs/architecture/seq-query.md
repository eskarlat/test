# Sequence Diagram — `renre-kit query`

## Description
Developer or AI agent queries extension data through the CLI proxy.

```mermaid
sequenceDiagram
    actor Actor as Developer / AI Agent
    participant CLI as CLI: Query Handler
    participant ProjectFS as .renre-kit/
    participant Worker as Worker Service :42888
    participant ProjRouter as Project Router
    participant ExtRegistry as Extension Registry
    participant ExtRouter as Extension Router
    participant DB as SQLite DB

    Actor->>CLI: renre-kit query jira issues --json

    CLI->>ProjectFS: Read extensions.json (get project-id)
    ProjectFS-->>CLI: project-id, extensions list

    CLI->>CLI: Validate "jira" is in installed extensions
    alt Extension not installed
        CLI-->>Actor: Error: Extension "jira" not installed
    end

    CLI->>CLI: Build HTTP request
    Note over CLI: GET localhost:42888/api/{project-id}/jira/issues

    CLI->>Worker: HTTP GET /api/{project-id}/jira/issues
    Worker->>ProjRouter: Route by project-id prefix

    ProjRouter->>ExtRegistry: getRouter("project-id", "jira")

    alt Extension not loaded yet
        ExtRegistry->>ExtRegistry: Lazy load extension
        ExtRegistry->>DB: Run pending migrations
        ExtRegistry->>ExtRegistry: Cache router
    end

    ExtRegistry-->>ProjRouter: jira Router

    ProjRouter->>ExtRouter: GET /issues
    ExtRouter->>DB: SELECT * FROM jira_issues WHERE project_id = ?
    DB-->>ExtRouter: Result rows
    ExtRouter-->>Worker: JSON response {issues: [...]}

    Worker-->>CLI: HTTP 200 {issues: [...]}

    alt --json flag
        CLI-->>Actor: Raw JSON output
    else default
        CLI-->>Actor: Formatted table output
    end
```

## Command Mapping
| CLI Command | HTTP Method | URL |
|-------------|------------|-----|
| `query jira issues` | GET | `/api/{pid}/jira/issues` |
| `query jira add -d '{...}'` | POST | `/api/{pid}/jira/add` |
| `query jira delete -d '{"id":1}'` | DELETE | `/api/{pid}/jira/delete` |

## Flags
| Flag | Description |
|------|-------------|
| `--json` | Output raw JSON |
| `-d <data>` | JSON body (switches to POST) |
| `--method <M>` | Override HTTP method |
