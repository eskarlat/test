# Node.js Rules

## Express Worker Service

### Route Namespacing

All extension routes are namespaced by project ID:
```
GET|POST|PUT|DELETE /api/{project-id}/{extension-name}/{action}
```

Core routes (no project scope):
```
GET  /health
GET  /api/projects
GET  /api/vault/keys
POST /api/vault/secrets
DELETE /api/vault/secrets/:key
POST /api/errors                    # UI error reports
GET  /api/marketplace               # Merged marketplace index
```

Real-time: Socket.IO (see Socket.IO section below).

### Extension Route Mounting

Extensions export a factory function that receives context and returns an Express Router:
```typescript
const factory: ExtensionRouterFactory = (ctx) => {
  const router = Router();
  router.get("/issues", (req, res) => {
    const rows = ctx.db.prepare("SELECT * FROM issues").all();
    res.json(rows);
  });
  return router;
};
export default factory;
```

The worker mounts it at `/api/{project-id}/{extension-name}/`.

### Error Handling & Isolation

- Wrap every extension route dispatch in try/catch — return 500, never crash the process
- Per-request timeout: 30 seconds default, returns 504 on expiry
- Circuit breaker: 5 consecutive errors in 60s window → suspend extension
  - Suspension returns 503 with `Retry-After` header
  - Cooldown doubles: 60s → 120s → 240s → max 15 minutes
  - Reset on first successful request after cooldown
- Memory monitoring: log warning if `process.memoryUsage().heapUsed > 512MB`

### Socket.IO Real-Time (ADR-048)

Server setup: `createServer(app)` + `new Server(httpServer)`, attached in `index.ts`.

```typescript
import { createServer } from "http";
import { Server } from "socket.io";

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: "*" },
  pingInterval: 25000,
  pingTimeout: 20000,
  connectionStateRecovery: { maxDisconnectionDuration: 120000 },
});

attachSocketBridge(io);
httpServer.listen(port, "127.0.0.1");
```

Room-based event scoping:
- `system` room — auto-joined on connect. System events: `extension:*`, `project:*`, `mcp:*`, `vault:*`, `updates:*`.
- `project:{pid}` room — joined/left via `project:join`/`project:leave`. Project events: `session:*`, `observation:*`, `tool:*`, `prompt:*`, `error:*`, `subagent:*`.
- `chat:{sessionId}` room — joined/left via `chat:join`/`chat:leave`. Chat streaming events.

EventBus → Socket.IO bridge (`socket-bridge.ts`) forwards events to rooms based on event prefix.

Client: `socket.io-client` with Zustand store (`useSocketStore`), transports `["websocket", "polling"]`, auto-reconnect with exponential backoff.

Graceful shutdown: close Socket.IO before HTTP server (`io.close()` → `httpServer.close()`).

## Process Management

### Server PID & Port

- Write PID to `~/.renre-kit/server.pid` on start
- Write state to `~/.renre-kit/server.json`: `{ pid, port, startedAt, activeProjects[] }`
- Stale PID detection: `process.kill(pid, 0)` — if throws, PID is stale, clean up and proceed
- Port conflict: try 42888, fallback through 42889-42898
- Set `chmod 0o600` on pid/json files (skip on Windows)

### Graceful Shutdown

Register all three signals:
```typescript
for (const signal of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  process.on(signal, async () => {
    // 1. Stop accepting new connections
    // 2. Unload all extensions (rollback in-flight requests)
    // 3. Kill MCP child processes
    // 4. Close SQLite connection
    // 5. Remove server.pid and server.json
    // 6. Exit
  });
}
```
`SIGBREAK` is Windows-specific — harmless to register on Unix.

### Detached Spawn (CLI → Worker)

```typescript
const child = spawn(process.execPath, [workerEntrypoint], {
  detached: true,
  stdio: "ignore",
  env: { ...process.env, RENRE_KIT_PORT: String(port) },
});
child.unref();
```

## Cross-Platform

### Paths

- Always `path.join()` or `path.resolve()` — never concatenate with `"/"`
- Global dir: `path.join(os.homedir(), ".renre-kit")`
- Normalize before comparing: `path.normalize()`
- Store paths with OS-native separators

### File Permissions

```typescript
function setFilePermissions(filePath: string, mode: number): void {
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, mode);
  }
  // Windows: rely on user profile directory ACLs
}
```

Use `0o600` for sensitive files (pid, server.json, data.db, vault).

### Line Endings

All generated files use `\n` — never `os.EOL`. Enforced by `.gitattributes` with `* text=auto`.

### Unicode Fallback

```typescript
const symbols = process.platform === "win32" && !process.env.WT_SESSION
  ? { check: "√", cross: "x", arrow: "->" }
  : { check: "✓", cross: "✗", arrow: "→" };
```

## CLI Patterns

### Commander + @clack Hybrid

Non-interactive mode (piping, CI, `--yes` flag): Commander parses args, output JSON or plain text.
Interactive mode (TTY): @clack/prompts for wizards with `intro()`, `outro()`, `text()`, `select()`, `confirm()`, `spinner()`.

Detection:
```typescript
const interactive = process.stdout.isTTY && !options.yes;
```

### Command Registration

```typescript
export function registerCommand(program: Command): void {
  program
    .command("action")
    .description("Description")
    .option("--json", "Output as JSON")
    .option("--yes", "Skip confirmation prompts")
    .action(async (options) => {
      if (interactive) {
        // @clack/prompts flow
      } else {
        // Non-interactive: use flags, output JSON
      }
    });
}
```

### Output Libraries

- Colors: `picocolors` (zero dependencies)
- Tables: `cli-table3`
- Git: `simple-git`
- Frontmatter: `gray-matter` (for SKILL.md parsing)

## Logging

### Format
```
[ISO timestamp] [LEVEL] [source] message
```

Levels: ERROR, WARN, INFO (default), DEBUG.

Sources: `worker`, `cli`, `ext:{name}`, `vault`, `mcp:{name}`, `backup`.

### File Locations
- General: `~/.renre-kit/logs/{YYYY-MM-DD}.txt` (plain text, daily rotation)
- Errors: `~/.renre-kit/logs/error-{YYYY-MM-DD}.json` (JSONL, structured)

### Secret Filtering

Never log:
- Vault secret values (only key names)
- SQL parameters
- MCP environment variables
- HTTP request/response bodies
- Settings with `type: "vault"` (show as `[REDACTED]`)

## Vault Resolution

- Secrets referenced as `${VAULT:key}` in extension settings
- Resolved only at extension mount time, not per-request
- Only resolved in settings fields declared with `type: "vault"` in the manifest schema
- Cross-checked against extension `permissions.vault` array
- Encryption: AES-256-GCM, PBKDF2 key derived from machine identity (hostname + username + hardware UUID)
- Never exposed via HTTP routes (only key names via `GET /api/vault/keys`)

## MCP Bridge

### Command Security

Allowlist: `node`, `npx`, `python`, `python3`, `deno`, `bun`, `uvx`, `docker`.

Reject arguments containing shell metacharacters: `;`, `|`, `&`, `` ` ``, `$()`, `>`, `<`.

### Lifecycle

- stdio: `child_process.spawn(command, args, { env })` — kill on extension unmount
- SSE: `EventSource(url, { headers })` — close on extension unmount
- One MCP transport per extension (not both)
- Auto-routes created: `/api/{pid}/{ext}/mcp/tools`, `/api/{pid}/{ext}/mcp/call`, `/api/{pid}/{ext}/mcp/resources`

## Hook Execution

### Entry Point

`~/.renre-kit/scripts/worker-service.cjs` dispatches hook events (ADR-046):
```
node "${RENRE_KIT_ROOT}/scripts/worker-service.cjs" hook <agent> <event> <feature>
```

- Core features: `context-inject`, `tool-governance`, `prompt-journal`, etc.
- Extension features: `{ext-name}:{action}` (e.g., `jira:session-init`)

### Execution Model

- Hooks within a batch execute in parallel via `Promise.allSettled()`
- Per-hook timeout enforcement
- Failures isolated — one hook failure never blocks others
- Results aggregated and returned to the calling agent
