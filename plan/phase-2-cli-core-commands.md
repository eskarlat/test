# Phase 2 — CLI Core Commands

## Goal
Implement the core CLI commands: `init`, `start`, `stop`, `status`, `uninstall`. These commands manage the project lifecycle and worker service process.

## Reference
- ADR-021: CLI Framework (Commander.js + @clack/prompts)
- ADR-010: Server Crash Recovery & Port Handling
- ADR-018: Status Command
- SEQ: init, start-server

## Dependencies
- Phase 1 (monorepo scaffolding)

## Tasks

### 2.1 CLI entry point & command registration
- [ ] Set up Commander.js program with name, version, description
- [ ] Register command files pattern (`registerXxxCommand`)
- [ ] Configure bin entry point in package.json
- [ ] Add @clack/prompts, picocolors, cli-table3 dependencies

### 2.2 Shared utilities
- [ ] `utils/paths.ts` — resolve `~/.renre-kit/`, `.renre-kit/`, walk-up parent dirs for `project.json`. Use `path.join(os.homedir(), '.renre-kit')` — never hardcode `~` or `/` (ADR-041)
- [ ] `utils/config.ts` — read/write `~/.renre-kit/config.json` with defaults
- [ ] `utils/pid.ts` — PID file read/write, stale PID detection (`process.kill(pid, 0)` — works cross-platform), health check fallback. Set file permissions `0o600` on `server.pid` (skip on Windows) (ADR-010, ADR-041)
- [ ] `utils/logger.ts` — wrapper around @clack/prompts (interactive) and plain console (non-interactive)
- [ ] `utils/formatter.ts` — JSON and table output formatting. CLI Unicode fallbacks: use ASCII symbols (√/X) on Windows cmd.exe when `process.env.WT_SESSION` is not set (ADR-041)

### 2.3 `renre-kit init`
- [ ] Check if `.renre-kit/` already exists (error if so)
- [ ] Interactive mode: prompt for project name with @clack
- [ ] Non-interactive mode: use `--name` flag or folder name
- [ ] Generate UUID for project ID
- [ ] Create `.renre-kit/project.json` with `{id, name}`
- [ ] Create `.renre-kit/extensions.json` with `{extensions: []}`
- [ ] Create `.github/hooks/` and `.github/skills/` directories
- [ ] Generate `.github/hooks/renre-kit.json` with 9 core features (ADR-037): core features only (no extensions yet). This ensures tool governance, session memory, context injection, etc. are active from first use without needing any extension installed
- [ ] Add `.renre-kit/` to project `.gitignore` if not already present (prevents Vault key name leakage via `extensions.json`) (ADR-009)
- [ ] Create `~/.renre-kit/` global directory if not exists
- [ ] Create `~/.renre-kit/backups/` directory (ADR-042)
- [ ] Write `~/.renre-kit/projects/{id}.json` metadata
- [ ] Write default `~/.renre-kit/config.json` if not exists
- [ ] Tests: init in empty dir, init in already-initialized dir, non-interactive mode

### 2.4 `renre-kit start`
- [ ] Resolve project ID from `.renre-kit/project.json` (walk up dirs)
- [ ] Check `~/.renre-kit/server.pid` — detect stale PID
- [ ] If server not running: spawn worker service as detached child process
- [ ] Port conflict handling: try 42888, then 42889-42898
- [ ] Write `server.pid` and `server.json` with actual port
- [ ] Register project via `POST /api/projects/register`
- [ ] Worker reads `.renre-kit/extensions.json` during registration (not CLI) — CLI sends project path, worker discovers extensions
- [ ] After registration: verify/report extension mount status and failures from worker response
- [ ] Non-blocking update check (print notice if updates available)
- [ ] `--port <port>` flag: override default port 42888 (ADR-021)
- [ ] Open browser to `localhost:{port}` (unless `--no-browser`)
- [ ] Print "Console running at localhost:{port}"
- [ ] Tests: start fresh, start with existing server, stale PID recovery, port conflict

### 2.5 `renre-kit stop`
- [ ] Resolve project ID
- [ ] Send `POST /api/projects/unregister` to worker
- [ ] Remove project from `server.json`
- [ ] If no active projects remain: send SIGTERM, delete `server.pid`
- [ ] `--force` flag: kill server regardless
- [ ] Tests: stop last project (server stops), stop one of many (server stays)

### 2.6 `renre-kit status`
- [ ] Read `server.pid` and `server.json` for server state
- [ ] If server running: fetch `/health` for uptime/memory
- [ ] Resolve current project (if in a project dir)
- [ ] `--project <id>` flag: show status for specific project (default: current directory) — ADR-018 + ADR-021
- [ ] List active projects with extension counts
- [ ] Show mounted extensions for current project with detail: route counts, MCP transport type/status (e.g. `jira-plugin@1.0.0 mounted (3 routes, MCP: stdio)`) — ADR-018
- [ ] Show "Marketplaces:" section listing configured marketplace registries from `~/.renre-kit/config.json` — ADR-018
- [ ] Show log level in server info section — ADR-018
- [ ] When server not running: show "Last run: {timestamp} (port {port})" from historical server.json — ADR-018
- [ ] Show update availability from marketplace cache
- [ ] `--json` flag: output raw JSON
- [ ] `--short` flag: one-line summary
- [ ] Handle all states: server up/down, in project/not in project
- [ ] Tests: status with server running, server stopped, in project, outside project, --project flag

### 2.7 `renre-kit uninstall`
- [ ] Remove `.renre-kit/` directory from project
- [ ] Remove `.github/hooks/` and `.github/skills/` extension-generated files
- [ ] Remove project from `~/.renre-kit/projects/`
- [ ] If server running: unregister project
- [ ] `--keep-data` flag: keep DB data, only remove config
- [ ] Confirmation prompt (interactive) or `--yes` flag
- [ ] Tests: uninstall with server running, uninstall with keep-data

### 2.8 JSON Schemas (ADR-015)
- [ ] Author `schemas/config.json` — JSON Schema for `~/.renre-kit/config.json` (marketplaces array, port, logLevel)
- [ ] Author `schemas/project.json` — JSON Schema for `.renre-kit/project.json` (`id`, `name`)
- [ ] Author `schemas/extensions.json` — JSON Schema for `.renre-kit/extensions.json` (extensions array with name, version, enabled, source, marketplace, settings)
- [ ] Add `$schema` reference to `.renre-kit/marketplace.json` stub and generated `project.json`/`extensions.json` in `init` command

## Verification
```bash
# Init
cd /tmp/test-project
renre-kit init --name test-project
ls .renre-kit/project.json    # should exist
ls .github/hooks/             # should exist

# Start (requires Phase 3 worker service stub)
renre-kit start --no-browser
renre-kit status              # should show server running

# Stop
renre-kit stop
renre-kit status              # should show server stopped

# Uninstall
renre-kit uninstall --yes
ls .renre-kit/                # should not exist
```

## Files Created
```
packages/cli/src/index.ts
packages/cli/src/commands/init.ts
packages/cli/src/commands/start.ts
packages/cli/src/commands/stop.ts
packages/cli/src/commands/status.ts
packages/cli/src/commands/uninstall.ts
packages/cli/src/utils/paths.ts
packages/cli/src/utils/config.ts
packages/cli/src/utils/pid.ts
packages/cli/src/utils/logger.ts
packages/cli/src/utils/formatter.ts
packages/cli/src/services/project-manager.ts
packages/cli/src/services/server-client.ts
schemas/config.json
schemas/project.json
schemas/extensions.json
```
