# Phase 14 — SSE Integration & Live Updates

## Goal
Wire SSE event emissions into all worker service components and connect live dashboard updates in the Console UI. The SSE infrastructure (EventBus, SSE endpoint, event history buffer) was built in Phase 3. The Console UI SSE listener (`useWorkerEvents`) and Toast components were built in Phase 11. This phase wires everything together.

## Reference
- ADR-023: Real-Time Worker-UI Communication
- ADR-045: Console UI Graceful Degradation
- C4 Component: SSE Event Stream

## Dependencies
- Phase 11 (Console UI shell — `useWorkerEvents` hook, stores, Toast components)
- Phase 3 (worker service core — EventBus, SSE endpoint, event history buffer)

## Tasks

### 14.1 Wire event emissions into worker service components
- [ ] Extension registry: emit `extension:mounted`, `extension:unmounted`, `extension:error` on mount/unmount/error
- [ ] Marketplace installer: emit `extension:installed`, `extension:removed`, `extension:upgraded` on install/remove/upgrade
- [ ] MCP manager: emit `mcp:connected`, `mcp:disconnected` on connect/disconnect/crash
- [ ] Vault resolver: emit `vault:updated` with `{ action: "set" | "delete", key }` on set/delete
- [ ] Project manager: emit `project:registered`, `project:unregistered` on register/unregister
- [ ] Settings resolver: emit `extension:remounted` on hot-reload
- [ ] Update checker: emit `updates:available` with `{ extensions: [{name, current, latest}] }` on start

### 14.2 Wire SSE events to toast notifications
- [ ] `extension:installed` → success toast "Installed {name}@{version}"
- [ ] `extension:error` → error toast "Error in {name}: {error}"
- [ ] `mcp:disconnected` → warning toast "MCP {name} disconnected"
- [ ] `updates:available` → info toast "{count} extension updates available"

### 14.3 Live dashboard updates
- [ ] System Home: activity feed auto-updates from SSE events (reads from event history buffer)
- [ ] System Home: project cards refresh on `project:registered/unregistered`
- [ ] Project Home: extension list refreshes on `extension:mounted/unmounted/installed/removed`
- [ ] Project Home: MCP status refreshes on `mcp:connected/disconnected`
- [ ] Project Home: sessions refresh on `session:started/ended` events
- [ ] Sidebar: updates when extensions are installed/removed/remounted

## Verification
```bash
# Start server, open Console in browser
renre-kit start
open http://localhost:42888

# In a separate terminal, install an extension:
renre-kit marketplace add official/test-ext@0.1.0 --yes

# Console should immediately:
# - Show toast "Installed test-ext@0.1.0"
# - Update sidebar with test-ext pages
# - Update extension list on Project Home
# - Add entry to activity feed on System Home

# Remove the extension:
renre-kit marketplace remove test-ext --yes

# Console should immediately:
# - Show toast "Removed test-ext"
# - Remove from sidebar
# - Update extension list

# Change a vault secret:
curl -X POST http://localhost:42888/api/vault/secrets \
  -H "Content-Type: application/json" \
  -d '{"key":"test_key","value":"secret"}'

# Vault page should update immediately

# Verify SSE connection:
curl -N http://localhost:42888/api/events
# → Should stream keepalive comments and events
```

## Files Modified
```
packages/worker-service/src/
  core/extension-registry.ts       # Add eventBus.emit() calls
  core/vault-resolver.ts           # Add eventBus.emit() calls
  core/settings-resolver.ts        # Add eventBus.emit() calls
  core/mcp-manager.ts              # Add eventBus.emit() calls
  routes/projects.ts               # Add eventBus.emit() calls
  routes/marketplace.ts            # Add eventBus.emit() calls

packages/console-ui/src/
  api/events.ts                    # Add toast event wiring
  routes/index.tsx                 # Wire activity feed to SSE
  components/dashboard/            # Wire live updates
```
