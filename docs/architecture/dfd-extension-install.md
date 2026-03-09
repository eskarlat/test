# DFD — Extension Install Flow

## Description
Data flow when a user installs an extension via `renre-kit marketplace add <extension-name>`.

```mermaid
flowchart TD
    User["Developer"] -->|"renre-kit marketplace add jira-plugin"| CLI["CLI: Marketplace Handler"]

    CLI -->|"Fetch marketplace index"| GH["GitHub Marketplace Repo"]
    GH -->|"marketplace.json"| CLI

    CLI -->|"Resolve extension repo URL"| GH2["GitHub Extension Repo"]
    GH2 -->|"Clone/download package"| ExtCache["~/.renre-kit/extensions/jira-plugin/1.0.0/"]

    CLI -->|"Read manifest.json"| ExtCache
    ExtCache -->|"manifest data"| CLI

    CLI -->|"Validate manifest (ADR-020)"| CLI
    CLI -->|"Display permissions + confirm (ADR-017)"| User

    CLI -->|"Add to extensions.json"| ProjConfig[".renre-kit/extensions.json"]
    CLI -->|"Copy hook definitions"| Hooks[".github/hooks/jira-plugin.json"]
    CLI -->|"Copy skill definitions"| Skills[".github/skills/jira-*/SKILL.md"]

    CLI -->|"If server running: POST /api/reload"| Worker["Worker Service"]
    Worker -->|"Mount extension routes"| ExtRegistry["Extension Registry"]
    Worker -->|"Run migrations"| DB["SQLite DB"]
    Worker -->|"Notify UI to refresh"| UI["Console UI"]
```

## Data Stores Affected
| Store | Operation | Data |
|-------|-----------|------|
| `~/.renre-kit/extensions/{name}/{version}/` | Write | Full extension package |
| `.renre-kit/extensions.json` | Update | Add extension entry |
| `.github/hooks/{name}.json` | Write | Hook definitions from manifest |
| `.github/skills/{skill}/SKILL.md` | Write | Skill files from extension |
| SQLite DB | Migrate | Extension tables (project-scoped) |

## Notes
- Extension packages are cached globally — shared across projects
- Only hooks/skills and extensions.json are project-specific
- If the server is not running, route mounting and migrations happen on next `renre-kit start`
