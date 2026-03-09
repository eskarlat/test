# Phase 9 — MCP Bridge

## Goal
Implement the MCP bridge system: extensions can declare stdio or SSE MCP servers, the worker manages their lifecycle, and standard bridge routes expose MCP tools via HTTP.

## Reference
- ADR-008: Extensions as MCP Bridges (command allowlist, shell metacharacter validation)
- ADR-019: Extension SDK Contract (MCPClient interface)
- ADR-041: Cross-Platform Compatibility (spawn, not exec)
- C4 Code: MCPConfig, MCPStdioConfig, MCPSSEConfig, MCPClient

## Dependencies
- Phase 4 (extension system — loader, context)
- Phase 5 (Vault — resolving `${VAULT:key}` in MCP env/headers)

## Tasks

### 9.1 MCP Manager
- [ ] `MCPManager` class: tracks running MCP connections per project + extension
- [ ] `connect(projectId, extensionName, mcpConfig)` — start stdio or SSE connection
- [ ] `disconnect(projectId, extensionName)` — kill process or close SSE connection
- [ ] `disconnectAll(projectId)` — cleanup all MCPs for a project
- [ ] `getClient(projectId, extensionName)` — return `MCPClient` instance
- [ ] `getStatus(projectId)` — return status of all MCP connections for project

### 9.2 stdio transport
- [ ] **Validate command against allowlist** before spawning (ADR-008): `node`, `npx`, `python`, `python3`, `deno`, `bun`, `uvx`, `docker`. Reject with clear error if command not in list. Users can extend allowlist via `~/.renre-kit/config.json` → `mcp.allowedCommands`
- [ ] **Validate args for shell metacharacters** (ADR-008): reject if args contain `;`, `|`, `&`, `` ` ``, `$()`, `>`, `<` — prevents shell injection even through allowed commands
- [ ] Spawn child process using `child_process.spawn()` (not `exec`) with `mcpConfig.command` + `mcpConfig.args` — no shell interpolation (ADR-041)
- [ ] Set working directory and environment variables (resolved from Vault)
- [ ] Communicate via stdin/stdout using JSON-RPC (MCP protocol)
- [ ] Handle process crash: log error, emit `mcp:disconnected` SSE event
- [ ] Auto-restart on crash (max 3 retries with exponential backoff)
- [ ] Kill process on disconnect/unmount
- [ ] Track PID for status reporting

### 9.3 SSE transport
- [ ] Connect to `mcpConfig.url` via EventSource (or HTTP SSE client)
- [ ] Include auth headers from config (resolved from Vault)
- [ ] Auto-reconnect on disconnect (`reconnect: true`, `reconnectIntervalMs`)
- [ ] Exponential backoff on repeated failures
- [ ] Emit `mcp:connected` / `mcp:disconnected` SSE events
- [ ] Close connection on disconnect/unmount
- [ ] Future consideration: connection pooling for MCP servers shared across projects (ADR-008 mitigation)

### 9.4 MCPClient implementation
- [ ] `listTools()` — send `tools/list` JSON-RPC request, return tool array
- [ ] `callTool(name, args)` — send `tools/call` JSON-RPC request, return result
- [ ] `listResources()` — send `resources/list` JSON-RPC request
- [ ] `readResource(uri)` — send `resources/read` JSON-RPC request
- [ ] Timeout handling per request (default 30s)

### 9.5 Standard bridge routes
- [ ] Auto-register routes for every MCP-enabled extension:
  - `GET /api/{pid}/{ext}/mcp/tools` — list available MCP tools
  - `POST /api/{pid}/{ext}/mcp/call` — invoke an MCP tool `{ tool, arguments }`
  - `GET /api/{pid}/{ext}/mcp/resources` — list MCP resources
  - `GET /api/{pid}/{ext}/mcp/resource?uri=...` — read an MCP resource
- [ ] 503 if MCP not connected (connecting/crashed state)
- [ ] Pass errors from MCP server through to HTTP response

### 9.6 MCP status route
- [ ] `GET /api/{pid}/mcp/status` — return all MCP connections for project
- [ ] Each entry: `{ extensionName, transport, status, pid?, url?, uptime, toolCount, error? }`
- [ ] Status values: `connecting`, `connected`, `disconnected`, `error`

### 9.7 Integration with extension loader
- [ ] When extension has `mcp` in manifest: create MCPClient and pass in ExtensionContext
- [ ] Connect MCP on extension mount, disconnect on unmount
- [ ] Resolve `${VAULT:key}` in `mcp.env` (stdio) and `mcp.headers` (SSE) before connecting
- [ ] MCP connection failure should not block extension mount (extension works, MCP routes return 503)

## Verification
```bash
# Create a test MCP extension (stdio)
mkdir -p ~/.renre-kit/extensions/echo-mcp/0.1.0
cat > ~/.renre-kit/extensions/echo-mcp/0.1.0/manifest.json << 'EOF'
{
  "name": "echo-mcp",
  "version": "0.1.0",
  "displayName": "Echo MCP",
  "description": "Test MCP extension (stdio)",
  "author": "test",
  "mcp": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-echo"]
  }
}
EOF

# Start server, register project with echo-mcp
# Check MCP status
curl http://localhost:42888/api/{pid}/mcp/status
# → [{ "extensionName": "echo-mcp", "transport": "stdio", "status": "connected", "pid": 12345 }]

# List tools
curl http://localhost:42888/api/{pid}/echo-mcp/mcp/tools
# → { "tools": [{ "name": "echo", ... }] }

# Call a tool
curl -X POST http://localhost:42888/api/{pid}/echo-mcp/mcp/call \
  -H "Content-Type: application/json" \
  -d '{"tool": "echo", "arguments": {"text": "hello"}}'
# → { "result": "hello" }
```

## Files Created
```
packages/worker-service/src/core/mcp-manager.ts
packages/worker-service/src/core/mcp-stdio-transport.ts
packages/worker-service/src/core/mcp-sse-transport.ts
packages/worker-service/src/core/mcp-client.ts
packages/worker-service/src/routes/mcp.ts
packages/worker-service/src/middleware/mcp-bridge-routes.ts
```
