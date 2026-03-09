# Sequence Diagram — `renre-kit init`

## Description
Initializes RenRe Kit in the current project directory.

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant CLI as CLI
    participant FS as File System
    participant GlobalStore as ~/.renre-kit/

    Dev->>CLI: renre-kit init
    CLI->>FS: Check if .renre-kit/ exists
    FS-->>CLI: Not found

    CLI->>CLI: Generate project ID (UUID)
    CLI->>FS: Create .renre-kit/project.json {id, name}
    CLI->>FS: Create .renre-kit/extensions.json (empty)
    CLI->>FS: Create .github/hooks/ directory
    CLI->>FS: Create .github/skills/ directory

    CLI->>GlobalStore: Write projects/{project-id}.json
    Note over GlobalStore: {id, name, path, version, createdAt}

    CLI-->>Dev: Initialized renre-kit in /path/to/project

    alt .renre-kit/ already exists
        CLI-->>Dev: Error: renre-kit already initialized
    end
```

## Files Created
| File | Content |
|------|---------|
| `.renre-kit/project.json` | `{ "id": "<uuid>", "name": "<folder-name>" }` |
| `.renre-kit/extensions.json` | `{ "extensions": [] }` |
| `.github/hooks/` | Empty directory |
| `.github/skills/` | Empty directory |
| `~/.renre-kit/projects/{id}.json` | Project metadata |

## CLI Project Resolution
When any CLI command runs (e.g., `renre-kit query`), it resolves the project by:
1. Looking for `.renre-kit/project.json` in the current directory
2. If not found, walking up parent directories until found
3. Reading `project.json` to get the project `id`
4. Using that `id` for API route namespacing (`/api/{project-id}/...`)
