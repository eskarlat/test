# Sequence Diagram — `renre-kit marketplace add`

## Description
Installs an extension from the marketplace into the current project.

```mermaid
sequenceDiagram
    actor Dev as Developer
    participant CLI as CLI
    participant GitHub as GitHub Marketplace Repo
    participant GlobalStore as ~/.renre-kit/
    participant ProjectFS as Project .renre-kit/ + .github/
    participant Worker as Worker Service
    participant ExtRegistry as Extension Registry
    participant DB as SQLite DB

    Dev->>CLI: renre-kit marketplace add jira-plugin

    CLI->>GlobalStore: Read marketplace-cache.json
    alt Cache expired or missing
        CLI->>GitHub: Fetch marketplace.json from repo
        GitHub-->>CLI: Marketplace index
        CLI->>GlobalStore: Update marketplace-cache.json
    end

    CLI->>CLI: Find "jira-plugin" in index
    alt Extension not found
        CLI-->>Dev: Error: Extension "jira-plugin" not found
    end

    CLI->>GlobalStore: Check if extensions/jira-plugin/1.0.0/ exists
    alt Not cached globally
        CLI->>GitHub: Clone/download extension repo
        GitHub-->>CLI: Extension package
        CLI->>GlobalStore: Save to extensions/jira-plugin/1.0.0/
    else Already cached
        CLI->>CLI: Use cached version
    end

    CLI->>GlobalStore: Read extensions/jira-plugin/1.0.0/manifest.json

    CLI->>CLI: Validate manifest (ADR-020)
    alt Validation fails
        CLI-->>Dev: Error: Invalid manifest — {details}
    end

    CLI->>Dev: Display permissions and request confirmation (ADR-017)
    alt User rejects permissions
        CLI-->>Dev: Installation cancelled
    end

    CLI->>ProjectFS: Update .renre-kit/extensions.json (add entry)
    CLI->>ProjectFS: Copy hooks to .github/hooks/jira-plugin.json
    CLI->>ProjectFS: Copy skills to .github/skills/{skill-name}/SKILL.md

    CLI->>CLI: Check if server is running (server.pid)

    alt Server is running
        CLI->>Worker: POST /api/projects/{id}/extensions/reload
        Worker->>ExtRegistry: mount(projectId, "jira-plugin")
        ExtRegistry->>GlobalStore: Load extension backend
        ExtRegistry->>DB: Run migrations (project-scoped)
        ExtRegistry->>Worker: Register router
        Worker-->>CLI: Extension mounted

        Note over Worker: UI receives SSE event (extension:installed) to refresh sidebar
    end

    CLI-->>Dev: Installed jira-plugin v1.0.0
```

## Error Cases
| Error | Handling |
|-------|----------|
| Extension not in marketplace | Show error, suggest `marketplace search` |
| Extension already installed in project | Show warning, offer `--force` to reinstall |
| Download failure | Retry once, then show error with manual install instructions |
| Migration failure | Rollback, unmount extension, show error |
