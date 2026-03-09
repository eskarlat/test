# Sequence Diagram — Console Project Switch

## Description
User switches between active projects in the Console UI toolbar dropdown.

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant UI as Console UI
    participant Shell as App Shell
    participant Sidebar as Dynamic Sidebar
    participant API as Worker Service API
    participant ExtRegistry as Extension Registry

    Dev->>UI: Open project dropdown in toolbar
    UI->>API: GET /api/projects
    API-->>UI: [{id, name, path, extensions}, ...]

    UI-->>Dev: Show dropdown with active projects

    Dev->>UI: Select "Project B"
    UI->>Shell: setActiveProject("project-b-id")

    Shell->>API: GET /api/project-b-id/extensions
    API->>ExtRegistry: listMounted("project-b-id")

    alt Extensions not yet mounted
        ExtRegistry->>ExtRegistry: Lazy mount Project B extensions
    end

    ExtRegistry-->>API: [{name, displayName, ui: {pages}}]
    API-->>Shell: Extension manifest list

    Shell->>Sidebar: Rebuild sidebar from extension manifests
    Note over Sidebar: Sidebar items change to reflect<br/>Project B's extensions

    Sidebar-->>Dev: Updated sidebar (e.g., Jira, Vault, Logs)

    Dev->>Sidebar: Click "Jira > Issues"
    Sidebar->>UI: Navigate to /project-b-id/jira/issues

    UI->>UI: Dynamic import extension UI bundle
    UI->>API: GET /api/project-b-id/jira/issues (data fetch)
    API-->>UI: JSON data
    UI-->>Dev: Render Jira Issues page
```

## State Management
| State | Scope | Storage |
|-------|-------|---------|
| Active project ID | UI session | React Context + localStorage |
| Project list | Server | `~/.renre-kit/server.json` |
| Extension manifests | Per-project | Loaded from extension registry |
| Sidebar items | UI | Derived from active project's extensions |

## Notes
- Project switch is instant — no page reload required
- Extension UI bundles are loaded lazily on first navigation
- Sidebar completely rebuilds when switching projects
- URL structure includes project ID: `/{project-id}/{extension}/{page}`
