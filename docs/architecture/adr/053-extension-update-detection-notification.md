# ADR-053: Extension Update Detection & Notification Center

## Status
Accepted

## Context
ADR-016 defined the upgrade command and a basic auto-check on `renre-kit start` that prints available updates. With the new source-agnostic resolver (ADR-052), extensions can come from marketplace, direct GitHub repos, or any git host. Update detection needs to work across all source types.

Additionally, the Console UI only has ephemeral 5-second toasts (`Toast.tsx`, `ToastContainer.tsx`). There is no persistent notification system for users who keep the Console UI open — they miss events that happen between page views.

## Decision

### 1. Update Detection Service

A `checkForUpdates()` function in `packages/source-resolver/` that detects newer versions for all installed extensions:

```typescript
interface UpdateCheckResult {
  name: string;
  installedVersion: string;
  latestVersion: string;
  source: string;
}

async function checkForUpdates(
  extensions: ExtensionEntry[],
  marketplaceCache: MarketplaceCache,
): Promise<UpdateCheckResult[]>;
```

Detection method per source type:

| Source | Detection method |
|--------|-----------------|
| `marketplace:*` | Compare installed version vs marketplace index (refreshed on cache expiry) |
| `github:*` / `git:*` | `git ls-remote --tags <repo>` → filter semver → compare against installed |
| `local:*` / `local+link:*` | Skip — user controls the source |

For git-based sources, `git ls-remote --tags` returns all tags without cloning. Tags are filtered for valid semver, sorted, and the highest is compared against the installed version.

### 2. Check Timing

**On `renre-kit start`**: Non-blocking check after server starts. Results printed to CLI:

```
Updates available:
  jira-plugin    1.0.0 → 1.2.0  (marketplace:official)
  figma-mcp      0.3.0 → 0.4.1  (github:acme/figma-mcp)
Run: renre-kit marketplace upgrade --all
```

**Periodic background**: Worker runs a scheduled check (configurable, default every 6 hours). Uses `setInterval` in the worker process. Last check timestamp stored in SQLite to avoid redundant checks across restarts.

### 3. Notification Channels

All three channels fire simultaneously when updates are detected:

**CLI output**: Table of available updates printed to stdout on `renre-kit start`.

**Console UI SSE**: Worker emits `extension:update-available` event via Socket.IO with payload:
```json
{
  "updates": [
    { "name": "jira-plugin", "current": "1.0.0", "latest": "1.2.0", "source": "marketplace:official" }
  ]
}
```

**Hook event**: Fire `extensionUpdateAvailable` hook event so AI agents can be informed and suggest the upgrade to the user. Payload matches the SSE event.

### 4. Console UI: Persistent Notification Center

A dropdown panel accessible from the Toolbar (bell icon with unread badge). Aggregates notifications from all sources, not just extension updates.

**Notification types:**
- `update` — extension update available (with "Update" action button)
- `extension` — installed, removed, upgraded, error
- `mcp` — MCP bridge connected/disconnected
- `error` — extension errors, mount failures
- `system` — server events, project registration

**Enhanced notification store** (`notification-store.ts`):

```typescript
interface Notification {
  id: string;
  type: "update" | "extension" | "mcp" | "error" | "system";
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  action?: { label: string; handler: () => void };
}

// Added to existing store:
notifications: Notification[];       // max 100, oldest dropped
unreadCount: number;
addNotification(n: Omit<Notification, "id" | "read">): void;
markRead(id: string): void;
markAllRead(): void;
clearAll(): void;
```

**SSE event → notification mapping** (in `events.ts`):
- `extension:installed` → notification + toast
- `extension:removed` → notification + toast
- `extension:upgraded` → notification + toast
- `extension:error` → notification + toast (error variant)
- `extension:update-available` → notification only (persistent badge, no toast)
- `mcp:connected` / `mcp:disconnected` → notification + toast
- `project:registered` / `project:unregistered` → notification only

**Toolbar integration:** Bell icon in `Toolbar.tsx` (next to theme toggle and search). Badge shows `unreadCount`. Click opens `NotificationCenter` dropdown.

## Consequences

### Positive
- Users discover updates across all source types (marketplace, GitHub, any git host)
- Dual check timing covers both CLI and Console UI users
- Hook event enables AI agents to proactively suggest upgrades
- Persistent Notification Center means users don't miss events between page views
- Single notification system for all event types (not just updates)

### Negative
- `git ls-remote --tags` for each git-based extension adds network calls during checks
- Periodic background check adds a recurring operation to the worker
- Notification Center adds UI complexity

### Mitigations
- Update checks are non-blocking — they don't delay startup or user operations
- `git ls-remote` is lightweight (no data transfer, just refs)
- Background check interval is configurable (default 6h)
- Failed checks for individual extensions don't block results for others (partial results returned)
- Notification list capped at 100 entries to prevent unbounded growth

## Related
- ADR-016: Extension Upgrade Flow (this ADR extends the auto-check from ADR-016 to all source types)
- ADR-052: Source-Agnostic Extension Resolution (resolver provides version resolution infrastructure)
- ADR-023: Realtime Worker-UI Communication (SSE/Socket.IO transport for update events)
- ADR-048: Socket.IO Realtime Communication (transport layer for notification delivery)
