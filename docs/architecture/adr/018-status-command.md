# ADR-018: `renre-kit status` Command

## Status
Accepted

## Context
Users need a way to inspect the current state of the system: is the server running, on which port, which projects are active, which extensions are mounted, are there update notifications. Currently no single command provides this overview.

## Decision

### `renre-kit status` Command
A single command that outputs the full system state.

```bash
$ renre-kit status
```

**Output:**
```
Server:     running (PID 12345, port 42888)
Uptime:     2h 15m
Log level:  info

Active projects (2):
  ● my-app          /Users/dev/projects/my-app       3 extensions
  ● backend-api     /Users/dev/projects/backend-api   2 extensions

Current project: my-app
  Extensions:
    ✓ jira-plugin@1.0.0      mounted   (3 routes, MCP: stdio)
    ✓ figma-mcp@0.5.0        mounted   (MCP: sse, connected)
    ✓ vault-connect@1.2.0    mounted   (2 routes)

  Updates available:
    jira-plugin      1.0.0 → 1.1.0
    figma-mcp        0.5.0 → 0.6.0

Marketplaces:
  official            github.com/x/renre-kit (default)
  company-internal    github.com/myco/renre-kit-ext
```

### Flags

| Flag | Output |
|------|--------|
| `--json` | Machine-readable JSON output |
| `--project <id>` | Show status for specific project (default: current directory) |
| `--short` | One-line summary: `Server: running :42888 | 2 projects | 5 extensions` |

### When Server is Not Running

```bash
$ renre-kit status

Server:     not running
Last run:   2026-03-07T10:30:00Z (port 42888)

Current project: my-app (/Users/dev/projects/my-app)
  Extensions (3 installed, not mounted):
    - jira-plugin@1.0.0
    - figma-mcp@0.5.0
    - vault-connect@1.2.0

Run `renre-kit start` to start the server.
```

### When Not in a Project Directory

```bash
$ renre-kit status

Server:     running (PID 12345, port 42888)

Active projects (2):
  ● my-app          /Users/dev/projects/my-app       3 extensions
  ● backend-api     /Users/dev/projects/backend-api   2 extensions

Not in a renre-kit project directory.
Run `renre-kit init` to initialize, or `cd` to a project.
```

### Data Sources
| Data | Source |
|------|--------|
| Server running/PID/port | `~/.renre-kit/server.pid` + `server.json` |
| Active projects | `~/.renre-kit/server.json` (activeProjects) |
| Current project | `.renre-kit/project.json` (walk up directories) |
| Installed extensions | `.renre-kit/extensions.json` |
| Mounted extensions | `GET /api/{project-id}/extensions` (if server running) |
| Update availability | Marketplace cache comparison |
| Marketplace list | `~/.renre-kit/config.json` |

## Consequences

### Positive
- Single command for full system overview
- Useful for debugging (is it running? which port? what's mounted?)
- `--json` enables scripting and CI integration
- Shows update availability inline
- Works whether server is running or not

### Negative
- Must handle multiple states (server up/down, in project/not in project)
- Update check may be stale if marketplace cache is old

### Mitigations
- Graceful output for every state combination
- Cache staleness is acceptable for status — `marketplace search` forces refresh
