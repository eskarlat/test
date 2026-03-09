# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

RenRe Kit is a CLI tool that provides context to AI agents via a local Express worker service (port 42888) instead of MCP. It features an extension/plugin system, marketplace, Console UI, and Vault for secrets management.

**Status**: Design complete, no code implemented yet. Architecture docs in `/docs/architecture/` (C4, DFD, SEQ, ADR-001 through ADR-042). Implementation plan in `/plan/` (16 phases).

## Build & Dev Commands

```bash
pnpm install                          # Install all dependencies
pnpm run build                        # Build all packages (Turborepo)
pnpm run dev                          # Dev mode for CLI + worker
pnpm run test                         # Run all tests (Vitest)
pnpm run test -- --filter=@renre-kit/cli  # Test single package
pnpm run lint                         # ESLint across all packages
```

Individual package commands:
```bash
pnpm --filter @renre-kit/cli exec renre-kit --version
pnpm --filter @renre-kit/worker-service dev
pnpm --filter @renre-kit/console-ui dev
```

## Monorepo Structure

```
packages/
  cli/              # Commander.js + @clack/prompts, built with tsup
  worker-service/   # Express.js + better-sqlite3, built with tsup
  console-ui/       # React 19 + Vite + React Router v7 + Zustand + shadcn/ui
  extension-sdk/    # Types + build template, tsup (ESM + CJS + DTS)
extensions/         # Monorepo extension development location
```

Tooling: pnpm workspaces + Turborepo, TypeScript everywhere, Vitest for tests.

## Architecture — Key Decisions

### Single Server, Multi-Project
One Express server on port 42888 (fallback 42889-42898) serves all active projects. Routes namespaced: `/api/{project-id}/{extension}/{action}`. Extensions lazy-loaded at project registration, not server start.

### Extension System
- Extensions add backend routes (Express Router), UI pages (React dynamic `import()`), SQLite migrations, hooks, and skills
- **ScopedDatabase proxy**: Extensions never get raw SQLite handle. Table prefix `ext_{name}_*` enforced, `project_id` auto-injected in queries
- **Circuit breaker**: 5 errors → suspension → exponential cooldown (60s→15min max)
- **Manifest** (`manifest.json`): declares backend, UI, MCP, migrations, settings, permissions, hooks, skills, contextProvider
- **Permissions model**: database, network, MCP, hooks, vault, filesystem — displayed at install, cross-checked at mount

### Vault (Core, Not Extension)
- AES-256-GCM encryption, PBKDF2 key from machine identity
- `${VAULT:key}` resolved only in `type: "vault"` settings fields (prevents injection)
- Never exposed via HTTP (only key names)

### MCP Bridge
- stdio (spawn) or SSE (connect), one transport per extension
- Command allowlist: node, npx, python, python3, deno, bun, uvx, docker
- Shell metacharacter rejection in arguments

### Hooks & Skills
- Single merged hook file: `.github/hooks/renre-kit.json` (not per-extension)
- Hook entry point: `~/.renre-kit/scripts/worker-service.cjs`
- GitHub Copilot hook schema, 9 events: sessionStart, sessionEnd, userPromptSubmitted, preToolUse, postToolUse, errorOccurred, preCompact, subagentStart, subagentStop
- Skills placed in `.github/skills/{name}/SKILL.md`

### Hook Intelligence (Phases 15-16)
Session memory, observations, tool governance, prompt journal, error fingerprinting, tool analytics, subagent tracking, context recipes with token budgets. All stored in SQLite with FTS5 full-text search.

### Console UI
- React SPA served by worker, dynamic sidebar per project (extensions determine menu items)
- SSE (`GET /api/events`) for real-time updates, no polling
- Extension UI loaded via dynamic `import()` from `/extensions/{name}/{version}/ui/index.js`

## File Layout Conventions

```
~/.renre-kit/                          # Global store
  config.json                          # Server port, log level, marketplaces
  data.db                             # Shared SQLite (WAL mode)
  server.pid / server.json            # Running server state
  extensions/{name}/{version}/         # Cached extensions (multi-version)
  scripts/worker-service.cjs          # Hook entry point
  logs/{YYYY-MM-DD}.txt               # Daily logs
  logs/error-{YYYY-MM-DD}.json        # Error logs (JSONL)
  backups/data-{ts}-pre-{op}.db       # Pre-migration backups

{project}/
  .renre-kit/project.json             # {id, name}
  .renre-kit/extensions.json          # Installed extensions + settings
  .github/hooks/renre-kit.json        # Merged hook file
  .github/skills/{name}/SKILL.md      # Skill files
```

## Implementation Conventions

- **Paths**: Always `path.join()`, never `/` concatenation. Use `os.homedir()` for `~`
- **Line endings**: Always `\n`, never `os.EOL`
- **SQLite**: WAL mode, pre-migration backups mandatory, transactions per migration
- **Migrations**: `001_name.up.sql` / `001_name.down.sql`, zero-padded, bidirectional
- **Logging format**: `[ISO timestamp] [LEVEL] [source] message` — no secrets logged
- **Extension install pattern**: `[marketplace/]extension[@version]`
- **CLI pattern**: Commander.js for parsing + @clack/prompts for interactive wizards, picocolors for output
- **Platform helpers**: `src/shared/platform.ts` — `setFilePermissions()`, `getPlatformSignals()`, `resolvePaths()`
- **CI matrix**: macOS (arm64), Linux (x64), Windows (x64) x Node 20, 22

## Coding Rules

Detailed technology-specific rules in `/rules/`:
- [`typescript.md`](rules/typescript.md) — Module/build config, type conventions, core interfaces, extension manifest typing
- [`sql.md`](rules/sql.md) — Table naming, project scoping, ScopedDatabase proxy, migrations, FTS5, backups, core schemas
- [`nodejs.md`](rules/nodejs.md) — Express routes, error isolation, SSE, process management, cross-platform, CLI patterns, logging, vault, MCP, hooks
- [`react.md`](rules/react.md) — Zustand stores, dynamic extension loading, SSE hook, dashboard patterns, sidebar, error boundaries, file organization

## Implementation Order

Foundation (1-3) → Extension Platform (4-10) → Console UI (11-14) → Intelligence (15-16). Phases 2+3 can run in parallel. MVP = Phases 1-7 + 11. See `/plan/README.md` for dependency graph.
