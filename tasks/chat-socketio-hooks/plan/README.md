# Console Chat + Socket.IO + Hook Event Args — Implementation Plan

## Overview

Implements ADR-046 (Hook Event Argument Passing), ADR-048 (Socket.IO Real-Time Communication), and ADR-047 (Console Chat UI with GitHub Copilot SDK).

## Phases

| # | Name | ADR | Dependencies | Deliverables |
|---|------|-----|-------------|-------------|
| 1 | Hook Event Argument Passing | ADR-046 | None | Event arg in generated hook commands, backwards-compatible script |
| 2 | Socket.IO Migration | ADR-048 | None | Unified real-time transport replacing SSE |
| 3 | Extension SDK — Chat Types | ADR-047 | None | ScopedLLM, LLM types, manifest chatTools/chatAgents |
| 4 | CopilotBridge & Chat Backend | ADR-047 | Phase 2, 3 | Bridge, REST routes, Socket.IO chat events, built-in tools |
| 5 | Chat UI — Core | ADR-047 | Phase 2, 4 | Chat page, store, message list, input, model selector, streaming |
| 6 | Chat UI — Advanced Components | ADR-047 | Phase 5 | Tool rounds, diffs, permissions, reasoning, virtualization, keyboard |
| 7 | Extension Chat Integration | ADR-047 | Phase 3, 4 | Extension tools/agents in chat, ScopedLLM wiring, intelligence hooks |

## Dependency Graph

```
Phase 1 (Hook Event Args)              ── standalone, can run in parallel
Phase 2 (Socket.IO) ─────────┐
Phase 3 (SDK Types) ──┐      │
                       ├──► Phase 4 (Chat Backend) ──► Phase 5 (Chat UI Core) ──► Phase 6 (Chat UI Advanced)
                       │                          │
                       └──────────────────────────┴──► Phase 7 (Extension Chat)
```

**Parallelism**: Phases 1, 2, 3 have no cross-dependencies and can run in parallel. Phase 4 requires both 2 and 3. Phase 7 can start after Phase 4 (does not need UI phases).

## Affected Packages

| Package | Phases |
|---------|--------|
| `packages/cli` | 1 |
| `packages/worker-service` | 1, 2, 4, 7 |
| `packages/console-ui` | 2, 5, 6 |
| `packages/extension-sdk` | 3 |
| `worker-service.cjs` (global script) | 1 |
| `schemas/manifest.json` | 3 |

## New Dependencies

| Package | Dependency | Phase |
|---------|-----------|-------|
| `@renre-kit/worker-service` | `socket.io` | 2 |
| `@renre-kit/worker-service` | `@github/copilot-sdk` | 4 |
| `@renre-kit/console-ui` | `socket.io-client` | 2 |
| `@renre-kit/console-ui` | `@tanstack/react-virtual` | 6 |

## Verification Strategy

Each phase includes verification commands. After each phase:
1. `pnpm run lint` — ESLint
2. `pnpm run lint:duplication` — jscpd copy-paste detection
3. `pnpm run build` — TypeScript compilation
4. Phase-specific verification commands
