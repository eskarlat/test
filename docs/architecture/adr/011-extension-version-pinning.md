# ADR-011: Extension Version Pinning

## Status
Accepted

## Context
Extensions are cached globally in `~/.renre-kit/extensions/`. Multiple projects may need different versions of the same extension. We need a versioning strategy.

## Decision

### Multi-Version Cache
Global cache stores each version separately:
```
~/.renre-kit/extensions/
  jira-plugin/
    1.0.0/
      manifest.json
      backend/
      ui/
      migrations/
    1.2.0/
      manifest.json
      ...
```

### Version Pinning in Projects
`.renre-kit/extensions.json` pins the exact version per project:
```json
{
  "extensions": [
    {
      "name": "jira-plugin",
      "version": "1.0.0",
      "source": "marketplace",
      "installedAt": "2026-03-07T10:00:00Z"
    }
  ]
}
```

### CLI Commands

| Command | Behavior |
|---------|----------|
| `marketplace add jira-plugin` | Install **latest** version from marketplace |
| `marketplace add jira-plugin@1.0.0` | Install **specific** version |
| `marketplace add jira-plugin@latest` | Explicit latest (same as no version) |

### Upgrade Flow
```
renre-kit marketplace add jira-plugin@1.2.0
```
1. Download v1.2.0 to global cache (if not already cached)
2. Update `extensions.json` version pin from 1.0.0 → 1.2.0
3. If server running: unmount v1.0.0, run new migrations from v1.2.0, mount v1.2.0
4. Hooks/skills files updated from new version

### Version Resolution at Mount Time
When the worker service mounts an extension:
1. Read version from `.renre-kit/extensions.json`
2. Load from `~/.renre-kit/extensions/{name}/{version}/`
3. If version directory missing → error: "Extension jira-plugin@1.0.0 not found in cache. Run `renre-kit marketplace add jira-plugin@1.0.0`"

## Consequences

### Positive
- Projects are reproducible — pinned versions don't change unexpectedly
- Multiple projects can use different versions simultaneously
- Upgrade is explicit — never automatic

### Negative
- Disk usage increases with multiple cached versions
- Migration path between versions must be handled by extension authors

### Mitigations
- Future: `renre-kit cache clean` to remove unused versions
- Marketplace metadata includes minimum/maximum compatible versions
