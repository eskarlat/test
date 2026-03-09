# Phase 10 — Extension SDK

## Goal
Create the `@renre-kit/extension-sdk` package with TypeScript types, build template, and a working example extension that exercises backend routes, migrations, UI pages, and MCP integration.

## Reference
- ADR-019: Extension SDK Contract
- ADR-020: Manifest Validation
- ADR-022: Console UI Tech Stack (extension UI build)
- ADR-044: Extension SDK API Versioning

## Dependencies
- Phase 4 (extension system — runtime contract)
- Phase 9 (MCP bridge — MCPClient interface)

## Tasks

### 10.1 SDK package setup
- [ ] Create `packages/extension-sdk/` with `package.json` (`@renre-kit/extension-sdk`)
- [ ] Configure tsup build: output ESM + CJS, declarations
- [ ] Export all public types from `src/index.ts`

### 10.2 Backend types
- [ ] `ScopedDatabase` — scoped proxy interface with `prepare()`, `exec()`, `tablePrefix` (ADR-019). Extensions never receive the raw `better-sqlite3` handle. Includes `ScopedStatement` type for query results
- [ ] `ExtensionContext` — projectId, db (`ScopedDatabase | null`), logger, config, mcp
- [ ] `ExtensionLogger` — error, warn, info, debug methods
- [ ] `MCPClient` — listTools, callTool, listResources, readResource
- [ ] `MCPTool`, `MCPResource` — tool/resource metadata types
- [ ] `ExtensionRouterFactory` — `(context: ExtensionContext) => Router`

### 10.3 UI types
- [ ] `ExtensionPageProps` — projectId, extensionName, apiBaseUrl
- [ ] `ExtensionModule` — `{ pages: Record<string, ComponentType<ExtensionPageProps>> }`

### 10.4 Manifest types
- [ ] `ExtensionManifest` — full TypeScript type matching C4 code doc, including `minSdkVersion?: string` field (ADR-044)
- [ ] `SettingDefinition` — string, vault, number, boolean, select types
- [ ] `ExtensionPermissions` — database, network, mcp, hooks, vault, filesystem
- [ ] `MCPConfig`, `MCPStdioConfig`, `MCPSSEConfig` — discriminated union. `MCPStdioConfig.command` documented as restricted to allowlist (ADR-008)
- [ ] `HookConfig` — versioned Copilot hook schema type

### 10.4b SDK version constant (ADR-044)
- [ ] `src/version.ts` — exports `SDK_VERSION` constant (e.g., `"0.1.0"`)
- [ ] Worker service reads this at startup for compatibility checks and `GET /health` response (`sdkVersion` field)
- [ ] SDK version follows semver for the extension-facing contract (independent of RenRe Kit release version)
- [ ] Document breaking change policy: pre-1.0.0 minor bumps may contain breaking changes

### 10.5 Context Provider types (ADR-036)
- [ ] `ContextProviderManifest` — `{ name: string, description: string, icon?: string, defaultEnabled: boolean, configSchema?: ProviderSettingDefinition[] }`
- [ ] `ProviderSettingDefinition` — `{ key: string, label: string, type: "string" | "number" | "boolean" | "select", default: unknown, description?: string, options?: { label: string, value: string }[] }`
- [ ] `ContextRequest` — `{ projectId: string, config: Record<string, unknown>, tokenBudget: number, sessionInput: { timestamp, cwd, source, initialPrompt?, sessionId? } }`
- [ ] `ContextResponse` — `{ content: string, estimatedTokens: number, itemCount: number, truncated: boolean, metadata?: { lastUpdated?: string, source?: string } }`
- [ ] Export from `types/context-provider.ts`

### 10.6 Vite config template
- [ ] Export a base Vite config for extension UI builds
- [ ] React externalized (provided by Console shell)
- [ ] Output as ES module to `ui/index.js`
- [ ] Include in SDK as `vite.extension.config.ts` template

### 10.7 Example extension
- [ ] Create `examples/example-extension/` in monorepo root
- [ ] `manifest.json` — declares backend, ui, migrations, settings, hooks, skills
- [ ] `backend/index.ts` — router with CRUD routes using db + logger
- [ ] `migrations/001_init.up.sql` + `001_init.down.sql`
- [ ] `ui/src/index.tsx` — two pages (list + detail) using ExtensionPageProps
- [ ] `ui/vite.config.ts` — using SDK template config
- [ ] Add `workspace:*` dependency on `@renre-kit/extension-sdk`
- [ ] Build script in package.json

### 10.8 JSON Schema for manifest.json (ADR-015)
- [ ] Author `schemas/manifest.json` — full JSON Schema for extension `manifest.json`, covering all fields declared in `ExtensionManifest` TypeScript type (backend, ui, mcp, migrations, settings, permissions, hooks, skills, contextProvider, minSdkVersion)
- [ ] Add `$schema` field to `examples/example-extension/manifest.json`

### 10.9 SDK documentation
- [ ] `packages/extension-sdk/README.md` — quick start guide
- [ ] Document backend contract with code examples
- [ ] Document UI contract with code examples
- [ ] Document manifest.json schema with all fields
- [ ] Document build process for UI bundles
- [ ] Note: Future — `create-extension` CLI scaffolding tool (ADR-019 mention)

## Verification
```bash
# Build SDK
cd packages/extension-sdk && pnpm build

# Verify types are exported
pnpm tsc --noEmit -p examples/example-extension/tsconfig.json

# Build example extension UI
cd examples/example-extension && pnpm build

# Verify output structure
ls examples/example-extension/backend/index.js
ls examples/example-extension/ui/index.js
ls examples/example-extension/manifest.json
ls examples/example-extension/migrations/

# Install example extension manually and test
cp -r examples/example-extension ~/.renre-kit/extensions/example-extension/0.1.0/
# Start server, register project, verify routes work
curl http://localhost:42888/api/{pid}/example-extension/items
```

## Files Created
```
packages/extension-sdk/
  package.json
  tsconfig.json
  tsup.config.ts
  src/
    index.ts
    types/backend.ts
    types/ui.ts
    types/manifest.ts
    types/mcp.ts
    types/context-provider.ts
    version.ts
  vite.extension.config.ts
  README.md

schemas/manifest.json

examples/example-extension/
  package.json
  manifest.json
  backend/
    index.ts
  migrations/
    001_init.up.sql
    001_init.down.sql
  ui/
    src/index.tsx
    vite.config.ts
  tsconfig.json
```
