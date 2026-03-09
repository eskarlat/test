# ADR-007: CLI `query` Command as API Proxy

## Status
Accepted

## Context
AI agents and developers need to interact with extension data. The worker service exposes HTTP APIs, but AI agents work better with CLI commands (shell execution in hooks, piping, scripting).

Options considered:
1. **Direct HTTP** — agents call `curl localhost:42888/api/...` directly
2. **CLI proxy** — `renre-kit query` translates CLI args to HTTP calls
3. **Both** — CLI proxy for convenience, direct HTTP always available

## Decision
**`renre-kit query` is the primary interface for programmatic access.** It translates CLI arguments to HTTP requests against the worker service. Direct HTTP remains available for advanced use cases.

### Command Format
```
renre-kit query <extension> <action> [options]
```

### Mapping Rules
| CLI | HTTP |
|-----|------|
| `query jira issues` | `GET /api/{pid}/jira/issues` |
| `query jira add -d '{"title":"x"}'` | `POST /api/{pid}/jira/add` |
| `query jira update -d '{"id":1}' --method PUT` | `PUT /api/{pid}/jira/update` |
| `query jira delete -d '{"id":1}' --method DELETE` | `DELETE /api/{pid}/jira/delete` |

### Discovery
```
renre-kit query --help              # list all installed extensions
renre-kit query jira --help         # list all available actions for jira extension
```
Extensions declare their available actions in `manifest.json`. The `--help` flag queries the extension registry and returns action names, HTTP methods, and descriptions — useful for both developers and AI agents to discover capabilities at runtime.

### Options
- `--help` — list available extensions or actions for a given extension
- `--json` — output raw JSON (default for piping, detected via `isatty`)
- `-d <data>` — JSON body (implies POST unless `--method` overrides)
- `--method <M>` — explicit HTTP method override
- `--project <id>` — target a specific project (default: current directory's project)

## Consequences

### Positive
- AI agents use simple shell commands in hooks — no HTTP client needed
- Output format controllable (`--json` for machine parsing, table for humans)
- Project scoping is automatic (reads from `.renre-kit/`)
- Composable with Unix tools: `renre-kit query jira issues --json | jq '.[] | .title'`

### Negative
- Extra layer between consumer and API — slight overhead
- CLI must stay in sync with extension API changes
- Some complex queries may be hard to express in CLI args

### Mitigations
- CLI is a thin translation layer — minimal logic, just HTTP proxy
- Direct HTTP always available as escape hatch
- Future: `renre-kit query --raw /custom/path` for arbitrary routes
