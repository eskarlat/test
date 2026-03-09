# ADR-014: Extension Settings Hot-Reload via Remount

## Status
Accepted

## Context
Users configure extension settings via the Console UI settings page. When a setting changes (e.g., new API URL, different Vault key), the running extension needs to pick up the new values. We need to decide if settings are injected live or require a restart.

## Decision

**Settings changes trigger extension remount.** There is no live injection — the extension is cleanly unmounted and remounted with the new resolved settings.

### Remount Flow
```
User changes setting in Console UI
  → PUT /api/{project-id}/extensions/{name}/settings {key: value}
  → Worker saves to .renre-kit/extensions.json
  → Worker unmounts extension (close routes, kill MCP, cleanup)
  → Worker resolves new settings (including Vault refs)
  → Worker mounts extension with new config
  → UI receives confirmation, refreshes extension page
```

### What Happens During Remount
1. **Unmount**: Extension router removed, MCP process killed / SSE disconnected
2. **Resolve**: New settings read, `${VAULT:key}` references resolved from global Vault
3. **Mount**: Extension router factory called with new `ExtensionContext.config`, MCP respawned if applicable
4. **No migration re-run**: Migrations are version-based, not settings-based — they don't re-run on remount

### Duration
- Typical remount: <500ms (unmount router + remount router)
- With MCP stdio: ~2-3 seconds (process spawn overhead)
- With MCP SSE: ~1 second (reconnection)

### In-Flight Requests
- Requests arriving during remount receive HTTP 503 (Service Unavailable) with `Retry-After: 3` header
- UI shows brief loading state during remount

## Consequences

### Positive
- Clean state — no stale config lingering in extension memory
- Simple implementation — no need for config-change event system in extensions
- Extensions don't need to implement config reload logic
- Consistent behavior — mount always uses resolved settings

### Negative
- Brief downtime (~500ms-3s) during remount
- MCP processes restarted on every settings change
- In-flight requests fail with 503

### Mitigations
- Remount is fast enough to be imperceptible for most extensions
- 503 with Retry-After allows clients to auto-retry
- Settings changes are infrequent — typically during initial setup
