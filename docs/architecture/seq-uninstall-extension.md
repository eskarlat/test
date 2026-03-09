# Sequence Diagram — `renre-kit marketplace remove`

## Description
Uninstalls an extension from the current project. Rolls back DB migrations, removes hooks/skills, and unmounts from worker service.

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant CLI as CLI: Marketplace Handler
    participant ProjectFS as .renre-kit/ + .github/
    participant GlobalStore as ~/.renre-kit/
    participant Worker as Worker Service
    participant ExtRegistry as Extension Registry
    participant DB as SQLite DB

    Dev->>CLI: renre-kit marketplace remove jira-plugin

    CLI->>ProjectFS: Read .renre-kit/extensions.json
    ProjectFS-->>CLI: Installed extensions list

    CLI->>CLI: Verify "jira-plugin" is installed
    alt Extension not installed
        CLI-->>Dev: Error: Extension "jira-plugin" not installed in this project
    end

    CLI->>CLI: Check if server is running (server.pid)

    alt Server is running
        CLI->>Worker: POST /api/projects/{id}/extensions/unload {name: "jira-plugin"}

        Worker->>ExtRegistry: unmount(projectId, "jira-plugin")
        ExtRegistry->>ExtRegistry: Remove router from /api/{pid}/jira-plugin/*
        ExtRegistry-->>Worker: Extension unmounted

        Worker->>GlobalStore: Read extensions/jira-plugin/manifest.json
        GlobalStore-->>Worker: Manifest (migrations dir)

        alt Extension has migrations
            Worker->>DB: Rollback migrations for project (reverse order)
            Note over DB: DROP tables / reverse schema changes<br/>scoped to project_id
            DB-->>Worker: Migrations rolled back
        end

        alt Extension has MCP config
            Worker->>Worker: Kill MCP process / close SSE connection
        end

        Worker-->>CLI: Extension unloaded, DB rolled back
    else Server not running
        Note over CLI: DB rollback will happen on next start<br/>if extension is not in extensions.json
    end

    CLI->>ProjectFS: Remove from .renre-kit/extensions.json
    CLI->>ProjectFS: Delete .github/hooks/jira-plugin.json
    CLI->>ProjectFS: Delete .github/skills/jira-* directories

    CLI-->>Dev: Removed jira-plugin from project

    Note over GlobalStore: Global cache ~/.renre-kit/extensions/jira-plugin/<br/>is NOT deleted — other projects may use it
```

## Cleanup Summary
| Artifact | Action |
|----------|--------|
| `.renre-kit/extensions.json` | Remove extension entry + settings |
| `.github/hooks/{ext-name}.json` | Delete file |
| `.github/skills/{skill-name}/` | Delete directories for this extension's skills |
| SQLite DB tables | Rollback migrations (project-scoped rows/tables) |
| Extension routes | Unmount from worker service |
| MCP process/connection | Kill (stdio) or close (SSE) |
| `~/.renre-kit/extensions/{name}/` | **Kept** — shared global cache |

## Error Cases
| Error | Handling |
|-------|----------|
| Extension not installed | Show error |
| Migration rollback fails | Abort uninstall, show error, suggest manual cleanup |
| Server not running | Remove files, mark DB rollback as pending |
| Hook/skill files already deleted | Skip silently |
