# ADR-008: Extensions as MCP Bridges

## Status
Accepted

## Context
The MCP (Model Context Protocol) ecosystem provides standardized tool servers that AI agents can connect to. However, MCP requires a separate protocol layer (stdio/SSE transport) and each agent must natively support MCP. RenRe Kit extensions already provide HTTP routes — we can leverage this to bridge MCP servers into the standard RenRe Kit API.

Options considered:
1. **Ignore MCP** — only support native extension routes
2. **Direct MCP passthrough** — expose raw MCP protocol to consumers
3. **Extension as MCP bridge** — extensions optionally run MCP servers, routes proxy to MCP tools via HTTP

## Decision
**Extensions can optionally declare an MCP server configuration in their manifest.** Each extension supports exactly one MCP transport type — either **stdio** (local spawn) or **SSE** (connect to running server). The extension's backend routes act as an HTTP-to-MCP bridge, translating REST calls into MCP tool invocations.

One extension = one MCP transport. E.g., `jira-mcp` uses stdio (spawns locally), `figma-mcp` uses SSE (connects to Figma's remote server).

### Transport Types

| Transport | Lifecycle | Use Case |
|-----------|-----------|----------|
| **stdio** | Worker spawns MCP server as child process, communicates via stdin/stdout. Killed on unmount. | Local MCP servers (GitHub, filesystem, DB tools) |
| **sse** | Worker connects to a running MCP server via Server-Sent Events. Disconnects on unmount. | Remote/pre-running MCP servers (Figma, SaaS APIs, shared infra) |

### MCP Lifecycle

**stdio:**
```
Extension Mount → Spawn child process → stdio connected → Ready
HTTP Request → Extension Route → MCP tool call (stdin/stdout) → Response
Extension Unmount → Kill child process → Cleanup
```

**SSE:**
```
Extension Mount → Connect to SSE URL → Handshake → Ready
HTTP Request → Extension Route → MCP tool call (SSE) → Response
Extension Unmount → Close SSE connection → Cleanup
```

### Standard Bridge Routes
Every MCP-enabled extension automatically gets these routes (regardless of transport):

| Route | Method | Description |
|-------|--------|-------------|
| `/api/{pid}/{ext}/mcp/tools` | GET | List available MCP tools |
| `/api/{pid}/{ext}/mcp/call` | POST | Invoke an MCP tool |
| `/api/{pid}/{ext}/mcp/resources` | GET | List MCP resources |
| `/api/{pid}/{ext}/mcp/resource` | GET | Read an MCP resource |

### stdio Command Security

**Command Allowlist:** stdio MCP extensions can only spawn commands from a validated allowlist. This prevents malicious extensions from executing arbitrary system commands.

**Allowed commands (v1):**
| Command | Reason |
|---------|--------|
| `node` | Node.js scripts |
| `npx` | npm package execution |
| `python` / `python3` | Python MCP servers |
| `deno` | Deno MCP servers |
| `bun` | Bun MCP servers |
| `uvx` | Python uv tool runner |
| `docker` | Containerized MCP servers |

**Validation rules:**
1. `mcp.command` must be in the allowlist — install fails otherwise with error: `"Command '{cmd}' is not allowed. Permitted: node, npx, python, python3, deno, bun, uvx, docker"`
2. `mcp.args` must not contain shell metacharacters (`;`, `|`, `&`, `` ` ``, `$()`, `>`, `<`) — prevents shell injection even through allowed commands
3. The installation prompt (ADR-017) shows the exact command + args being spawned:
   ```
   jira-mcp@1.0.0 requests the following permissions:
     MCP (stdio) — will run: npx -y @modelcontextprotocol/server-github
   ```
4. Custom commands can be added to user's `~/.renre-kit/config.json` under `mcp.allowedCommands` for advanced use cases

**Future:** Consider running stdio MCP processes inside a restricted container/sandbox.

### Manifest Configuration

**stdio example (local spawn):**
```json
{
  "name": "github-mcp",
  "mcp": {
    "transport": "stdio",
    "command": "npx",
    "args": ["-y", "@modelcontextprotocol/server-github"],
    "env": {
      "GITHUB_TOKEN": "${VAULT:github_token}"
    }
  }
}
```

**SSE example (remote server):**
```json
{
  "name": "figma-mcp",
  "mcp": {
    "transport": "sse",
    "url": "https://figma-mcp.example.com/sse",
    "headers": {
      "Authorization": "Bearer ${VAULT:figma_token}"
    },
    "reconnect": true,
    "reconnectIntervalMs": 5000
  }
}
```

### CLI Usage
```bash
# Both transports are transparent to the CLI consumer
renre-kit query github-mcp mcp/tools --json       # stdio-backed
renre-kit query figma-mcp mcp/tools --json         # SSE-backed

# Call a tool — same interface regardless of transport
renre-kit query figma-mcp mcp/call -d '{"tool": "get_file", "arguments": {"fileKey": "abc123"}}'
```

## Consequences

### Positive
- MCP ecosystem is accessible via standard HTTP and CLI — no MCP client needed in the AI agent
- Extensions unify MCP and custom logic under one API surface
- MCP servers are managed (spawned/killed) by the worker service — no manual process management
- Vault integration for MCP server secrets (e.g., `${VAULT:github_token}`)
- AI agents that don't support MCP natively can still use MCP tools via `renre-kit query`

### Negative
- **stdio**: Extra child process per MCP extension per active project — memory overhead
- **SSE**: Dependency on remote server availability — network failures affect extension
- MCP transport adds serialization latency vs native routes
- Must handle crashes (stdio) and disconnections (SSE)

### Mitigations
- MCP connections are only established when the project is active (lazy with project registration)
- **stdio**: Health monitoring with automatic restart on crash (max 3 retries)
- **SSE**: Auto-reconnect with configurable interval (`reconnectIntervalMs`), exponential backoff
- **SSE**: Vault integration for auth headers — secrets never stored in manifest
- Cleanup guaranteed on extension unmount / project stop (kill process or close connection)
- Future: connection pooling for MCP servers shared across projects using the same extension
