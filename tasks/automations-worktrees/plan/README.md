# Automations & Worktree Management — Implementation Plan

## Overview

Implements ADR-050 (Automations — Scheduled Prompt Chains with Agent Tooling) and ADR-051 (Git Worktree Management).

## Phases

| # | Name | ADR | Dependencies | Deliverables |
|---|------|-----|-------------|-------------|
| 1 | WorktreeManager Core | ADR-051 | None | SQL schema, WorktreeManager class, cleanup, startup reconciliation |
| 2 | Worktree REST API & Socket.IO | ADR-051 | Phase 1 | REST routes, Socket.IO worktree events, app.ts wiring |
| 3 | AutomationEngine Core — Data & Scheduling | ADR-050 | None | SQL schema (4 tables), template engine, AutomationEngine CRUD, cron scheduling |
| 4 | Chain Executor & Tool Integration | ADR-050 | Phase 1, 2, 3 | ChainExecutor, ephemeral CopilotBridge sessions, autopilot, tool governance, worktree integration |
| 5 | Automation REST API & Socket.IO | ADR-050 | Phase 3, 4 | REST routes, Socket.IO automation rooms/events, log retention |
| 6 | Extension Scheduler | ADR-050 §16 | Phase 3 | ScopedScheduler, SDK types, scheduler permission, ext-cron routes, limits |
| 7 | Console UI — Worktrees Page | ADR-051 §8 | Phase 2 | Zustand store, worktree list, create dialog, status badges, detail actions |
| 8 | Console UI — Automations List & Chain Editor | ADR-050 §10.1-10.2 | Phase 5, 6 | Zustand store, automation list, chain editor, schedule/worktree/variable config |
| 9 | Console UI — Run History, Debug & Help | ADR-050 §10.3-10.4 | Phase 8 | Run history, run detail, chain timeline, tool call viewer, help panels |

## Dependency Graph

```
Phase 1 (WorktreeManager) ─────┐
Phase 2 (Worktree API) ◄───────┘──┐
Phase 3 (AutomationEngine) ────┐  │
                                ├──┴──► Phase 4 (Chain Executor) ──► Phase 5 (Automation API)
                                │                                         │
                                └──► Phase 6 (Extension Scheduler)        │
                                                    │                     │
Phase 7 (Worktree UI) ◄── Phase 2                   │                     │
                                                    ▼                     ▼
                                    Phase 8 (Automations UI) ──► Phase 9 (Runs/Help UI)
```

**Parallelism**: Phases 1 and 3 have no cross-dependencies and can run in parallel. Phase 6 can start as soon as Phase 3 is complete (independent of Phase 4). Phase 7 can start as soon as Phase 2 is complete. Phase 8 requires both Phase 5 and Phase 6.

## Affected Packages

| Package | Phases |
|---------|--------|
| `packages/worker-service` | 1, 2, 3, 4, 5, 6 |
| `packages/extension-sdk` | 6 |
| `packages/console-ui` | 7, 8, 9 |

## New Dependencies

| Package | Dependency | Phase |
|---------|-----------|-------|
| `@renre-kit/worker-service` | `node-cron` | 3 |
| `@renre-kit/worker-service` | `@types/node-cron` | 3 |

No new Console UI dependencies — uses existing shadcn/ui, Zustand, Socket.IO client, and React Router.

## ADR Amendment Wiring

Several ADR amendments from ADR-050/051 must be implemented during specific phases:

| Amendment | Phase | Detail |
|-----------|-------|--------|
| ADR-019: ScopedDatabase blocked tables | 6 | Add `_scheduler_*`, `_automation*` to blocked list |
| ADR-017: `scheduler` permission | 6 | New permission type for extensions |
| ADR-024: Sidebar structure | 7, 8 | Add Automations, Worktrees as core pages |
| ADR-047: CopilotBridge.closeSession() | 4 | Public method for ephemeral session cleanup |
| ADR-048: `automation:{runId}` room | 5 | New Socket.IO room type with events |
| ADR-048: `worktree:*` events | 2 | Add worktree events to project room |

## Verification Strategy

Each phase includes verification commands. After each phase:
1. `pnpm run lint` — ESLint
2. `pnpm run lint:duplication` — jscpd copy-paste detection
3. Subagent plan-vs-implementation check — verify every task item is fully implemented
