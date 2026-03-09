# Phase 6 — CLI Query Command

## Goal
Implement `renre-kit query` — the CLI proxy that translates CLI arguments into HTTP requests to the worker service. Includes `--help` discovery for listing extensions and actions.

## Reference
- ADR-007: CLI Query as API Proxy
- ADR-021: CLI Framework (isTTY detection, command tree)
- C4 Code: QueryOptions

## Dependencies
- Phase 2 (CLI core — project resolution, server client)
- Phase 4 (extension system — mounted routes)

## Tasks

### 6.1 Query command registration
- [ ] Register `query` command with Commander: `renre-kit query <extension> [action] [options]`
- [ ] Flags: `--json`, `-d <data>`, `--method <M>`, `--project <id>`, `--help`

### 6.2 Command-to-HTTP mapping
- [ ] Resolve project ID from `.renre-kit/project.json`
- [ ] Read server port from `~/.renre-kit/server.json`
- [ ] CLI-side pre-validation: read `.renre-kit/extensions.json` and verify extension is installed BEFORE making HTTP request (ADR-007, seq-query). Return `Error: Extension "x" not installed` if not found
- [ ] Build URL: `http://localhost:{port}/api/{projectId}/{extension}/{action}`
- [ ] Support positional arguments mapping to query parameters: e.g. `renre-kit query vault get SECRET` → `GET /api/{pid}/vault/get?key=SECRET` (seq-query)
- [ ] Default method: GET (switches to POST when `-d` provided)
- [ ] `--method` overrides explicit HTTP method
- [ ] Send request with JSON body if `-d` provided
- [ ] Handle response: parse JSON, format output

### 6.3 Output formatting
- [ ] `--json` flag or non-TTY: output raw JSON
- [ ] Explicit `isatty` detection: when `!process.stdout.isTTY`, default to JSON output without requiring `--json` flag (ADR-007 + ADR-021)
- [ ] TTY without `--json`: format as table using cli-table3
- [ ] Error responses: show HTTP status + error message

### 6.4 Discovery (`--help`)
- [ ] `renre-kit query --help` → list all installed extensions (from extensions.json)
- [ ] `renre-kit query <ext> --help` → fetch actions from `GET /api/{pid}/{ext}/__actions`
- [ ] Worker side: extension registry serves `__actions` route from manifest `backend.actions`

### 6.5 Error handling
- [ ] Server not running → clear error: "Worker service not running. Run `renre-kit start`"
- [ ] Extension not installed → "Extension 'x' not installed. Run `renre-kit marketplace search x`"
- [ ] Connection timeout (3s default) → "Worker service not responding" (plan implementation detail, not in ADRs)
- [ ] HTTP error responses → show status code + body

## Verification
```bash
# Start server with test extension from Phase 4
renre-kit start --no-browser

# Query extension
renre-kit query test-ext hello
# → { "message": "Hello from test-ext" }

# JSON output
renre-kit query test-ext hello --json | jq '.message'
# → "Hello from test-ext"

# Discovery
renre-kit query --help
# → Lists installed extensions

renre-kit query test-ext --help
# → Lists available actions

# Error: server not running
renre-kit stop
renre-kit query test-ext hello
# → "Worker service not running. Run `renre-kit start`"
```

## Files Created
```
packages/cli/src/commands/query.ts
packages/worker-service/src/middleware/actions-route.ts
```
