# ADR-044: Extension SDK API Versioning

## Status
Accepted

## Context
Extension backends depend on `ExtensionContext`, `ScopedDatabase`, hook request/response contracts, and the `/__context` / `/__hooks` route contracts defined in the Extension SDK (ADR-019). When RenRe Kit upgrades and these interfaces change, extensions built against an older SDK version could break silently — mount failures, runtime errors, or incorrect behavior with no clear error message.

We need a mechanism to:
1. Detect incompatible extensions before they break at runtime
2. Communicate breaking changes clearly to extension authors
3. Allow extensions to declare which SDK version they target

## Decision

### SDK Version Field in Manifest

Add a `minSdkVersion` field to the extension manifest:

```json
{
  "name": "jira-plugin",
  "version": "1.2.0",
  "minSdkVersion": "0.3.0",
  ...
}
```

- **Required** for extensions published to a marketplace
- **Optional** for local extensions (defaults to current SDK version, with a warning logged at mount time)
- Follows semver: `"0.3.0"` means "requires SDK features from 0.3.0 or later"

### Compatibility Check at Mount Time

When mounting an extension, the Extension Loader checks:

```
extension.minSdkVersion <= current worker SDK version
```

- If compatible: mount proceeds normally
- If incompatible: mount aborted with clear error:
  ```
  Extension "jira-plugin@1.2.0" requires SDK >=0.5.0, but worker provides 0.3.0.
  Upgrade RenRe Kit or install an older version of this extension.
  ```
- Extension marked as `status: "incompatible"` in the registry (visible in Console UI with a badge)

### SDK Version Published by Worker

The worker service exposes its SDK version:

```
GET /health → { ..., "sdkVersion": "0.3.0" }
```

The `sdkVersion` tracks the Extension SDK contract version, not the RenRe Kit release version. These may diverge — a RenRe Kit release can increment its version without changing the SDK contract.

### Breaking Change Policy

SDK version follows semver for the extension-facing contract:

| Change Type | SDK Version Bump | Example |
|---|---|---|
| New optional field in `ExtensionContext` | Patch | Adding `context.debugMode` |
| New method on `ScopedDatabase` | Minor | Adding `db.transaction()` |
| New hook event type | Minor | Adding `preReview` event |
| Changing `ExtensionContext` field type | Major | `config: Record<string, string>` → `config: Map` |
| Removing a method from `ScopedDatabase` | Major | Removing `db.exec()` |
| Changing hook response schema | Major | Renaming `permissionDecision` → `decision` |

**Pre-1.0.0**: Minor bumps may contain breaking changes (standard semver 0.x convention). Extensions targeting `0.x` should expect possible breakage on minor bumps and pin conservatively.

### Manifest Validation Enhancement

The manifest validator (ADR-020) gains additional checks:

- If `minSdkVersion` is present: validate it's a valid semver string
- If publishing to marketplace: `minSdkVersion` is required (reject without it)
- Warning if `minSdkVersion` is more than 2 minor versions behind current SDK (likely outdated)
- Extension names beginning with `__` are reserved for core use (reject)

### Extension Status in Console UI

Extensions that fail the SDK compatibility check appear in the Console with:
- Status badge: "Incompatible" (distinct from "error" or "needs setup")
- Tooltip: "Requires SDK >=X.Y.Z — upgrade RenRe Kit or install an older version"
- No mount attempt, no routes registered, no MCP spawned

### SDK Version Constants

The SDK version is defined in a single location:

```typescript
// packages/extension-sdk/src/version.ts
export const SDK_VERSION = "0.1.0";
```

This value is:
- Exported from `@renre-kit/extension-sdk` for extension authors
- Read by the worker service at startup for compatibility checks
- Included in `GET /health` response

## Consequences

### Positive
- Incompatible extensions fail fast with clear error messages instead of mysterious runtime errors
- Extension authors know exactly which SDK features they can use
- Users see "incompatible" status in Console UI and can take action
- Breaking changes are communicated through version numbers
- `GET /health` exposes SDK version for tooling and diagnostics

### Negative
- Extension authors must track SDK versions and update `minSdkVersion` in their manifest
- Pre-1.0.0 versioning allows breaking changes on minor bumps (necessary during rapid development)
- Additional validation step on every extension mount

### Mitigations
- SDK changelog documents breaking changes per version
- `renre-kit extension validate` warns about outdated `minSdkVersion`
- Marketplace search could filter by SDK compatibility (future)
- Compatibility check is a simple semver comparison — negligible overhead
