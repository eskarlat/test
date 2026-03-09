# ADR-002: Extension Lazy Loading

## Status
Accepted

## Context
Extensions provide backend routes, DB migrations, and UI bundles. Since different projects use different extensions, and the server handles multiple projects, we need a strategy for when to load extension code.

Options considered:
1. **Eager loading** — mount all extensions for all projects on server start
2. **Project-activation loading** — mount extensions when a project registers via `renre-kit start`
3. **Lazy loading** — mount extensions on first request to their route

## Decision
**Hybrid approach: mount extensions at project registration time (`renre-kit start`), not on every HTTP request.** When a project registers, its extensions are loaded and routers mounted. When a project unregisters (`renre-kit stop`), its extension routers are unmounted.

This is "lazy" relative to server start (extensions aren't loaded until a project activates) but "eager" relative to individual requests (no first-request penalty).

## Consequences

### Positive
- No startup cost for extensions of inactive projects
- Predictable request latency — no cold-start on first request
- Clean resource management — unmount when project deactivates
- Migrations run at a predictable time (project registration)

### Negative
- `renre-kit start` takes longer as extensions load
- Memory usage grows with number of active projects

### Mitigations
- Extension loading is parallelized
- Extensions are standard Node.js modules — loading is fast
- Inactive project extensions are fully unloaded

### Extension Crash Isolation

Extensions run inside the worker service process, so a misbehaving extension can affect stability. The following safeguards apply:

**Request-level protection (v1):**
- **Per-request timeout:** Each HTTP request to an extension route has a configurable timeout (default: 30 seconds). If the extension handler does not respond within this window, the request is aborted with a `504 Gateway Timeout` and logged as an extension error.
- **Circuit breaker:** If an extension produces 5 consecutive errors (uncaught exceptions or timeouts) within a 60-second window, the extension is automatically **suspended** — its routes return `503 Service Unavailable` with a `Retry-After: 60` header. After the cooldown, the next request reactivates the extension. Consecutive suspensions double the cooldown (60s, 120s, 240s, max 15 minutes).
- **Uncaught exception isolation:** Extension route handlers are wrapped in a try/catch boundary. Uncaught exceptions are caught, logged via the error intelligence system (ADR-031), and return a `500` response — they do not crash the worker process.
- **Memory monitoring:** The worker periodically checks `process.memoryUsage()`. If heap usage exceeds a configurable threshold (default: 512 MB), the worker logs a warning and emits an SSE event. Extensions mounted most recently are flagged as suspects in the log.

**Process-level protection (future v2):**
- Extension backends run in isolated `worker_threads` with restricted `require()` / `import()` capabilities
- Per-extension memory limits via `worker_threads` `resourceLimits`
- Extensions cannot access `process.env`, `process.exit()`, or the main thread's global state
