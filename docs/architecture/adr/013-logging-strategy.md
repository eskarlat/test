# ADR-013: Logging Strategy

## Status
Accepted

## Context
The worker service, CLI, and extensions all produce logs. We need a consistent logging strategy covering format, storage, rotation, and access.

## Decision

### Log Location
All logs written to `~/.renre-kit/logs/`:
```
~/.renre-kit/logs/
  2026-03-07.txt
  2026-03-08.txt
  ...
```
- One file per day (date only, no time in filename)
- Plain text format for easy `grep`/`tail`

### Log Format
```
[2026-03-07T14:23:01.123Z] [INFO] [worker] Server started on port 42888
[2026-03-07T14:23:01.456Z] [INFO] [ext:jira-plugin] Mounted for project abc-123
[2026-03-07T14:23:02.789Z] [ERROR] [ext:jira-plugin] Migration 003 failed: table already exists
[2026-03-07T14:23:03.000Z] [DEBUG] [vault] Resolved 3 secrets for extension jira-plugin
[2026-03-07T14:23:03.100Z] [INFO] [mcp:github-mcp] stdio process spawned (PID 12345)
[2026-03-07T14:23:04.200Z] [WARN] [cli] Stale PID detected, recovering...
```

Format: `[ISO timestamp] [LEVEL] [source] message`

### Log Levels
| Level | Usage |
|-------|-------|
| `ERROR` | Failures that prevent an operation from completing |
| `WARN` | Recoverable issues (stale PID, reconnect, deprecated usage) |
| `INFO` | Key lifecycle events (start, stop, mount, unmount, install, query) |
| `DEBUG` | Detailed operational data (SQL queries, HTTP requests, Vault resolution) |

Default level: `INFO`. Configurable in `~/.renre-kit/config.json`:
```json
{
  "logLevel": "info"
}
```

### What Gets Logged

**Always logged (INFO+):**
- Server start/stop with port
- Project registration/unregistration
- Extension mount/unmount
- Extension install/uninstall
- MCP process spawn/kill, SSE connect/disconnect
- Migration execution (up/down)
- Hook execution (event, extension, duration, success/fail)
- CLI commands (`query`, `marketplace`, `start`, `stop`)
- Errors and stack traces

**Debug level:**
- HTTP request/response (method, URL, status, duration)
- SQL queries (without parameter values)
- Vault key resolution (key names only, never values)
- Extension settings resolution
- MCP tool calls (tool name, duration)

### PII and Secret Filtering
- **Vault values are NEVER logged** — only key names
- SQL query parameters are not logged at any level
- Extension settings with `type: "vault"` show as `[REDACTED]` in logs
- MCP environment variables are not logged
- HTTP request/response bodies are not logged (only metadata)

### Error Boundary Logging
Unhandled errors from extensions (backend crashes, UI render failures, MCP errors) are captured by error boundaries and written to structured JSON files:

```
~/.renre-kit/logs/error-2026-03-07.json
```

Each line is a JSON object (JSONL format):
```json
{"timestamp":"2026-03-07T14:23:05.123Z","source":"ext:jira-plugin","projectId":"abc-123","type":"backend","error":"Cannot read property 'title' of undefined","stack":"TypeError: Cannot read property...","context":{"route":"GET /issues","method":"GET"}}
{"timestamp":"2026-03-07T14:23:06.456Z","source":"ext:figma-mcp","projectId":"abc-123","type":"mcp","error":"MCP process exited with code 1","context":{"transport":"stdio","pid":12345}}
{"timestamp":"2026-03-07T14:25:00.789Z","source":"console-ui","projectId":"abc-123","type":"ui","error":"IssuesPage render failed","stack":"Error: ...","context":{"extensionName":"jira-plugin","pageId":"issues"}}
```

**Error types:**
| Type | Source | Captured By |
|------|--------|-------------|
| `backend` | Extension route handler throws | Express error middleware |
| `ui` | Extension React component crashes | `ExtensionErrorBoundary` in Console UI |
| `mcp` | MCP process crash or connection failure | MCP manager |
| `migration` | SQL migration failure | Migration runner |
| `hook` | Hook command execution failure | Hook executor |

**UI Error Boundary** catches extension render errors, shows a fallback UI ("Extension crashed — view error in logs"), and POSTs the error to the worker service for logging:
```
POST /api/errors { source, type, error, stack, context }
```

### Rotation
- General logs: one `.txt` per day — natural rotation
- Error logs: one `.json` per day — structured for parsing
- No automatic deletion — users manage disk space
- Future: configurable retention policy (e.g., keep last 30 days)

### Access
- General logs visible in Console UI dashboard (Logs page) — reads log files and streams
- Error logs viewable in Console UI with filtering by extension, type, date
- CLI: `tail -f ~/.renre-kit/logs/$(date +%Y-%m-%d).txt` for live monitoring
- Future: `renre-kit logs` CLI command with filtering

## Consequences

### Positive
- Everything logged — full audit trail for debugging
- Daily files are easy to manage and search
- PII filtering prevents accidental secret exposure
- Plain text — no special tools needed to read

### Negative
- No structured logging (JSON) — harder to parse programmatically
- No log aggregation to external services
- Disk usage grows without automatic cleanup

### Mitigations
- Plain text is sufficient for local developer tool
- Future: JSON log format option for power users
- Future: `renre-kit logs clean --older-than 30d`
