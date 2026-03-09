# ADR-010: Server Crash Recovery & Port Conflict Handling

## Status
Accepted

## Context
The worker service runs as a background process. It can crash, and its default port (42888) may be occupied. We need strategies for both scenarios.

## Decision

### Crash Recovery

**Stale PID detection:**
When the CLI reads `~/.renre-kit/server.pid`, it verifies the process is actually running:
1. Read PID from file
2. Send signal 0 (`kill -0 <pid>`) to check if process exists
3. If process doesn't exist → PID is stale → delete `server.pid` → start fresh
4. If process exists but doesn't respond to `GET /health` within 3 seconds → treat as hung → kill process → delete PID → start fresh

**Auto-restart:**
- The CLI spawns the worker service as a detached child process
- On `renre-kit start`, if stale PID detected, auto-recover and start new instance
- No daemon-level auto-restart (no systemd/launchd) — CLI handles recovery on next interaction
- Worker service logs crash reason to `~/.renre-kit/logs/` before exiting

**Graceful shutdown:**
- Worker listens for SIGTERM and SIGINT
- On signal: unmount all extensions, close DB connections, close MCP processes, delete `server.pid`
- Timeout: if graceful shutdown takes >5 seconds, force exit

### Port Conflict Handling

When port 42888 is occupied:
1. Check if the occupying process is a renre-kit worker (check `/health` endpoint)
2. If yes → it's already running, reuse it
3. If no → try next port (42889, 42890, ...) up to 42898 (10 attempts)
4. Write the actual port to `~/.renre-kit/server.json` so CLI knows where to connect
5. If all ports exhausted → error with message listing conflicting processes

**Port resolution for CLI commands:**
- CLI reads port from `~/.renre-kit/server.json` (not hardcoded 42888)
- `server.json` always reflects the actual running port

## Consequences

### Positive
- Transparent crash recovery — user just runs `renre-kit start` again
- Port conflicts resolved automatically without user intervention
- CLI always knows the correct port via `server.json`

### Negative
- Dynamic port means bookmarked `localhost:42888` may not work after port conflict
- Up to 10 port attempts adds slight startup latency on conflict

### Mitigations
- CLI prints the actual URL on start: "Console running at localhost:42889"
- Port 42888 is still the default and will be used when available

### Cross-Platform Compatibility

The crash recovery and port handling mechanisms must work across macOS, Linux, and Windows:

| Mechanism | macOS/Linux | Windows |
|-----------|-------------|---------|
| PID file check | `kill -0 <pid>` (signal 0) | `process.kill(pid, 0)` works in Node.js on all platforms — no change needed |
| Graceful shutdown signals | SIGTERM, SIGINT | SIGINT works. SIGTERM is not reliable on Windows — use `process.on('SIGINT')` + `process.on('SIGBREAK')` |
| Force kill | `process.kill(pid, 'SIGKILL')` | `process.kill(pid)` on Windows sends unconditional termination (no SIGKILL equivalent, but same effect) |
| Data directory | `~/.renre-kit/` | `os.homedir() + '/.renre-kit/'` — works on all platforms via `os.homedir()` |
| File paths | Forward slashes | Use `path.join()` / `path.resolve()` everywhere — never hardcode `/` separators |
| File permissions | `chmod 600` for `server.pid`, `server.json` | Windows uses ACLs — skip `chmod` on win32, rely on user profile directory permissions |
| Detached process spawn | `{ detached: true, stdio: 'ignore' }` + `unref()` | Same Node.js API works on Windows |
| Process name check | `/proc/{pid}/cmdline` or `ps` | `wmic process where ProcessId={pid} get CommandLine` or `tasklist` |

**Implementation rules:**
1. Always use `path.join()` / `path.resolve()` — never string concatenation with `/`
2. Always use `os.homedir()` — never hardcode `~`
3. Use `process.platform === 'win32'` for platform-specific branches
4. Signal handling: register both `SIGINT` and `SIGBREAK` (Windows) in addition to `SIGTERM`
5. Test CI matrix must include: macOS (arm64), Linux (x64), Windows (x64)
