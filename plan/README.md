# RenRe Kit — Implementation Plan

## Overview
Phased implementation plan for RenRe Kit CLI, Worker Service, and Console UI. Each phase is self-contained, testable, and builds on previous phases.

## Architecture Reference
All architecture documents are in `/docs/architecture/` (C4, DFD, SEQ, ADR-001 through ADR-045).

## Phases

| Phase | Name | Status | Dependencies | Deliverable |
|-------|------|--------|--------------|-------------|
| 1 | [Monorepo Scaffolding](./phase-1-monorepo-scaffolding.md) | ✅ done | — | Build & dev environment ready |
| 2 | [CLI Core Commands](./phase-2-cli-core-commands.md) | ✅ done | Phase 1 | `init`, `start`, `stop`, `status`, `uninstall` working |
| 3 | [Worker Service Core](./phase-3-worker-service-core.md) | ✅ done | Phase 1 | Express server with health, projects, SQLite, logging, EventBus, SSE endpoint, core migrations |
| 4 | [Extension System](./phase-4-extension-system.md) | ✅ done | Phase 3 | Extension loader, registry, migrations, manifest validation |
| 5 | [Vault Core](./phase-5-vault-core.md) | ✅ done | Phase 3, 4 | Global secret store, resolver, internal API |
| 6 | [CLI Query Command](./phase-6-cli-query-command.md) | ✅ done | Phase 2, 4 | `query` proxy command with `--help` discovery |
| 7 | [Marketplace](./phase-7-marketplace.md) | ✅ done | Phase 2, 4, 5 | `marketplace add/remove/search/upgrade`, multi-marketplace |
| 8 | [Hooks & Skills](./phase-8-hooks-and-skills.md) | ✅ done | Phase 4, 7 | Hook execution, skill file management, worker-service.cjs |
| 9 | [MCP Bridge](./phase-9-mcp-bridge.md) | ✅ done | Phase 4, 5 | stdio + SSE MCP lifecycle, bridge routes |
| 10 | [Extension SDK](./phase-10-extension-sdk.md) | ✅ done | Phase 4, 9 | Types, build template, example extension |
| 11 | [Console UI Shell](./phase-11-console-ui-shell.md) | ✅ done | Phase 3 | React SPA, toolbar, sidebar, routing, project switcher, SSE listener, connection status |
| 12 | [Console Dashboard](./phase-12-console-dashboard.md) | ✅ done | Phase 11, 4, 5 | System home, project home, logs page |
| 13 | [Console Marketplace UI](./phase-13-console-marketplace-ui.md) | ✅ done | Phase 11, 7, 5 | Browse, install, settings, vault picker |
| 14 | [SSE Integration & Live Updates](./phase-14-sse-realtime-events.md) | ✅ done | Phase 11, 3 | Wire event emissions into all components, live dashboard updates |
| 15 | [Hook Intelligence](./phase-15-hook-intelligence.md) | ✅ done | Phase 8, 3, 4 | Session memory, observations, tool governance, prompt journal, error intelligence, tool analytics, subagent tracking, context recipes, FTS5 search |
| 16 | [Console Intelligence UI](./phase-16-console-intelligence-ui.md) | ✅ done | Phase 11, 15, 14 | Session timeline, observations page, tool governance dashboard, prompt journal, error dashboard, context recipe editor |

## Dependency Graph

```
Phase 1 (Scaffolding)
  ├── Phase 2 (CLI Core)
  │     ├── Phase 6 (Query)
  │     └── Phase 7 (Marketplace)
  │           └── Phase 8 (Hooks & Skills)
  │                 └── Phase 15 (Hook Intelligence)
  ├── Phase 3 (Worker Service)
  │     ├── Phase 4 (Extension System)
  │     │     ├── Phase 5 (Vault)
  │     │     ├── Phase 6 (Query)
  │     │     ├── Phase 7 (Marketplace)
  │     │     ├── Phase 9 (MCP Bridge)
  │     │     ├── Phase 10 (Extension SDK)
  │     │     └── Phase 15 (Hook Intelligence)
  │     ├── Phase 11 (Console Shell)
  │     │     ├── Phase 12 (Dashboard)
  │     │     ├── Phase 13 (Marketplace UI)
  │     │     ├── Phase 14 (SSE Events)
  │     │     └── Phase 16 (Intelligence UI)
  │     ├── Phase 14 (SSE Events)
  │     └── Phase 15 (Hook Intelligence)
  └── Phase 10 (Extension SDK)
```

## Parallelism Notes
- **Phases 2 and 3** can execute in parallel (both depend only on Phase 1)
- **Phase 5 (Vault core)** depends on Phase 4 only for the Settings Resolver integration; Vault encryption/storage/API could start after Phase 3 alone
- **Phases 6, 7, 8, 9** can partially overlap once Phase 4 is complete
- **Phase 12** has soft dependencies on Phases 8 (Hook Activity) and 9 (MCP Status) — renders empty states gracefully

## Phase Groups

### Foundation (Phases 1-3)
Core infrastructure: monorepo, CLI, worker service, SQLite.

### Extension Platform (Phases 4-10)
Extension system, Vault, marketplace, hooks, MCP, SDK.

### Console UI (Phases 11-14)
React SPA, dashboard, marketplace UI, real-time events.

### Hook Intelligence (Phases 15-16)
Core AI agent intelligence features powered by hook events.

## MVP Milestone
**After Phase 7 + Phase 11**, the system delivers a minimum viable product:
- CLI: `init`, `start`, `stop`, `status`, `query` (Phases 1-3, 6)
- Worker: Express server, SQLite, extension loading, Vault (Phases 3-5)
- Marketplace: install/remove extensions from GitHub (Phase 7)
- Console UI: basic shell with project switcher (Phase 11)

Phases 8-10, 14-16 (hooks, MCP, SDK, SSE, intelligence) can be deferred past MVP.

## Testing Strategy
- Each phase includes verification steps
- Unit tests with Vitest
- Integration tests against running worker service
- CLI tests: command execution + expected output
- UI tests: component tests with Vitest + React Testing Library
- CI matrix: macOS (arm64), Linux (x64), Windows (x64) × Node 20, 22 (ADR-041)

## Security Cross-Cutting Concerns
The following security measures apply across multiple phases (see ADRs 002, 008, 009, 017, 019, 041, 042):
- **MCP command allowlist** (Phase 9): stdio commands validated against allowlist + shell metacharacter rejection
- **ScopedDatabase proxy** (Phase 4): extensions never receive raw SQLite handle — table prefix isolation, auto project_id filtering
- **Vault injection protection** (Phase 5): `${VAULT:key}` resolved only in `type: "vault"` settings, cross-checked against permissions
- **Extension crash isolation** (Phase 4): per-request timeouts, circuit breaker, try/catch boundaries
- **Pre-migration backups** (Phase 3, 4): automatic `data.db` backup before any migration run (core + extension)
- **Core schema migrations** (Phase 3): versioned, append-only SQL migrations for core tables (ADR-043)
- **SDK API versioning** (Phase 4, 10): `minSdkVersion` in manifest, compatibility check at mount (ADR-044)
- **UI graceful degradation** (Phase 11): connection status, cached data, reconnection strategy (ADR-045)
- **Cross-platform compatibility** (Phase 1, 2, 3): `path.join()`, `os.homedir()`, platform-aware signal handling
