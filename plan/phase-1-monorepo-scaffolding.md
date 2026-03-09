# Phase 1 — Monorepo Scaffolding

## Goal
Set up the monorepo structure, build tooling, and dev environment so all packages can be developed and built.

## Reference
- ADR-015: Repository Structure
- ADR-021: CLI Framework

## Tasks

### 1.1 Initialize monorepo
- [ ] Create root `package.json` with pnpm workspaces
- [ ] Configure `pnpm-workspace.yaml` for `packages/*` and `extensions/*`
- [ ] Add `turbo.json` for build orchestration
- [ ] Add root `tsconfig.base.json` with shared TypeScript config

### 1.1b Project scaffolding (ADR-015)
- [ ] Create `extensions/` directory with `.gitkeep` (monorepo extension development location)
- [ ] Create `.renre-kit/marketplace.json` stub in monorepo root (default marketplace index)
- [ ] Create `schemas/` directory with `.gitkeep` (JSON Schemas deployed to renre-kit.dev/schemas/ via CI — schemas authored in Phases 2, 7, 10)

### 1.2 Create package stubs
- [ ] `packages/cli/` — package.json, tsconfig.json, `src/index.ts` (hello world)
- [ ] `packages/worker-service/` — package.json, tsconfig.json, `src/index.ts`
- [ ] `packages/console-ui/` — Vite + React project scaffold
- [ ] `packages/extension-sdk/` — package.json, tsconfig.json, `src/index.ts`

### 1.3 Configure build tooling
- [ ] CLI: tsup config (ESM output, single file)
- [ ] Worker service: tsup config
- [ ] Console UI: Vite config with React, Tailwind, shadcn/ui init
- [ ] Extension SDK: tsup config (ESM + CJS + DTS)

### 1.4 Configure dev tooling
- [ ] ESLint config (shared across packages)
- [ ] Prettier config
- [ ] Vitest config (workspace-level)
- [ ] `.gitignore` for node_modules, dist, .renre-kit
- [ ] `.gitattributes` with `* text=auto` for consistent line endings (ADR-041). All generated files must use `\n` — never `os.EOL`
- [ ] CI workflow (GitHub Actions): test matrix for macOS, Linux, Windows × Node 20, 22 (ADR-041)
- [ ] Platform abstraction helpers: `src/shared/platform.ts` — `setFilePermissions()`, `getPlatformSignals()`, `resolvePaths()` (ADR-041)

### 1.5 Verify builds
- [ ] `pnpm install` succeeds
- [ ] `pnpm run build` builds all packages
- [ ] `pnpm run dev` starts dev mode for CLI + worker
- [ ] CLI bin link works: `renre-kit --version` outputs version

## Verification
```bash
pnpm install
pnpm run build
pnpm --filter @renre-kit/cli exec renre-kit --version
# Should output: 0.1.0
```

## Files Created
```
package.json
pnpm-workspace.yaml
turbo.json
tsconfig.base.json
.gitignore
.gitattributes
.eslintrc.js
.prettierrc
packages/cli/package.json
packages/cli/tsconfig.json
packages/cli/src/index.ts
packages/worker-service/package.json
packages/worker-service/tsconfig.json
packages/worker-service/src/index.ts
packages/console-ui/package.json
packages/console-ui/tsconfig.json
packages/console-ui/vite.config.ts
packages/console-ui/tailwind.config.ts
packages/console-ui/src/main.tsx
packages/extension-sdk/package.json
packages/extension-sdk/tsconfig.json
packages/extension-sdk/src/index.ts
extensions/.gitkeep
schemas/.gitkeep
.renre-kit/marketplace.json
```
