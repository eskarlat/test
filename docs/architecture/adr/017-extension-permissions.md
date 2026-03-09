# ADR-017: Extension Permissions Model

## Status
Accepted

## Context
Extensions run inside the worker service process and can declare backends, MCP servers, hooks, and UI. We need to define what permissions an extension can request, how users are informed, and how the system enforces boundaries.

## Decision

### Permissions Declared in Manifest
Each extension declares the permissions it needs in `manifest.json`. Users see these during installation and must accept them.

```json
{
  "name": "jira-plugin",
  "permissions": {
    "database": true,
    "network": ["https://api.atlassian.net/*"],
    "mcp": true,
    "hooks": ["sessionStart", "userPromptSubmitted"],
    "vault": ["JIRA_API_TOKEN", "JIRA_BASE_URL"],
    "filesystem": false
  }
}
```

### Permission Types

| Permission | Description | Default |
|-----------|-------------|---------|
| `database` | Can create tables and read/write to SQLite (project-scoped) | `false` |
| `network` | List of URL patterns the extension backend can reach | `[]` (none) |
| `mcp` | Can spawn/connect to MCP servers | `false` |
| `hooks` | Which hook events the extension registers | `[]` |
| `vault` | Which Vault keys the extension needs access to (resolved at mount) | `[]` |
| `filesystem` | Can read/write files on disk (beyond its own extension directory) | `false` |

### Installation Prompt
When a user runs `renre-kit marketplace add jira-plugin`, the CLI displays:

```
jira-plugin@2.1.0 requests the following permissions:

  ✓ Database        — create and manage tables (project-scoped)
  ✓ Network         — https://api.atlassian.net/*
  ✓ Hooks           — sessionStart, userPromptSubmitted
  ✓ Vault secrets   — JIRA_API_TOKEN, JIRA_BASE_URL

Install? (y/N)
```

Users must confirm. `--yes` flag skips confirmation (for scripts/CI).

### Console UI — Extension Permissions View
The Extension Manager page shows permissions for each installed extension. Users can review what each extension has access to at any time.

### Enforcement

**v1 — Enforced where possible, advisory otherwise:**
- Permissions are displayed to the user at install time
- Extensions run in the same Node.js process — no hard sandboxing (see crash isolation in ADR-002)
- `vault` permissions are **enforced**: extensions only receive Vault keys listed in their permissions. `${VAULT:key}` resolution is restricted to `type: "vault"` settings and cross-checked against this list (ADR-009).
- `database` is **enforced**: extensions without `database: true` receive `null` for `db` in `ExtensionContext`. Extensions with database access receive a `ScopedDatabase` proxy (ADR-019) — never the raw handle. The proxy restricts queries to the extension's prefixed tables and blocks access to core tables.
- `mcp` is **enforced**: MCP stdio commands are validated against an allowlist (ADR-008). Shell metacharacters in args are rejected.
- `hooks` is **enforced**: hook payloads are only dispatched to extensions that declare the specific hook event in their permissions.
- `network` and `filesystem` are **advisory** — logged but not blocked at the Node.js process level.
- **Extension route handlers are wrapped in try/catch boundaries** with per-request timeouts and circuit breaker suspension (ADR-002) — a misbehaving extension cannot crash the worker.

**Future — Fully enforced:**
- Network: proxy extension HTTP calls through a gateway that checks URL patterns
- Filesystem: extension backend runs in a restricted context
- Process isolation via `worker_threads` with `resourceLimits`

### Permission Changes on Upgrade
When upgrading an extension (ADR-016), if the new version requests additional permissions:

```
Upgrading jira-plugin 0.0.1 → 0.0.2

New permissions requested:
  + Network    — https://api.slack.com/* (NEW)
  + Hooks      — sessionEnd (NEW)

Accept new permissions? (y/N)
```

Upgrade is blocked until user accepts. `--yes` flag auto-accepts.

## Consequences

### Positive
- Users are informed about what extensions can do before installing
- Vault access is scoped — extensions can't read arbitrary secrets
- DB access is gated — extensions without permission get no DB connection
- Permission changes on upgrade are explicit

### Negative
- v1 is mostly advisory — a malicious extension could bypass network/filesystem restrictions
- Adds friction to installation (permission prompt)
- Extension authors must declare permissions accurately

### Mitigations
- Official marketplace extensions are reviewed before listing
- Trust model is similar to npm packages / browser extensions
- Future enforcement roadmap reduces risk over time
- `--yes` flag for trusted/automated installs
