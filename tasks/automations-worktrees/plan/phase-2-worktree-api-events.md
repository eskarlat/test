# Phase 2 — Worktree REST API & Socket.IO Events

## Goal

Expose WorktreeManager functionality via REST routes and integrate Socket.IO events for real-time worktree updates. Wire the WorktreeManager into the worker service application lifecycle.

## Reference

- ADR-051: Git Worktree Management (§6, §7)
- ADR-048: Socket.IO Real-Time Communication (worktree event amendment)

## Dependencies

- Phase 1 (WorktreeManager Core) — WorktreeManager class must exist

## Tasks

### 2.1 REST Routes: Worktree CRUD

File: `packages/worker-service/src/routes/worktrees.ts`

- [ ] Create Express Router with project-scoped routes
- [ ] **Route ordering** (ADR-051 §6 note): register static routes before parameterized `/{id}` routes to prevent Express matching `cleanup` or `disk-usage` as a worktree ID

- [ ] `GET /api/:pid/worktrees` — List worktrees for project
  - Call `worktreeManager.list(projectId)`
  - Return `200` with `Worktree[]`

- [ ] `POST /api/:pid/worktrees` — Create a new worktree
  - Body: `WorktreeCreateOptions` (minus `projectId` which comes from URL)
  - Validate required fields: `branch`, `cleanupPolicy`, `createdBy`
  - Validate `createdBy.type` is one of `"automation" | "chat" | "user"`
  - If `cleanupPolicy === "ttl"` and no `ttlMs`, use default from config
  - Call `worktreeManager.create(opts)`
  - Return `201` with created `Worktree`
  - Return `400` for validation errors, `409` for branch checkout conflicts

- [ ] `POST /api/:pid/worktrees/cleanup` — Trigger manual cleanup
  - Call `worktreeManager.runCleanup()`
  - Return `200` with `CleanupResult`

- [ ] `GET /api/:pid/worktrees/disk-usage` — Total disk usage
  - Call `worktreeManager.totalDiskUsage(projectId)`
  - Return `200` with `{ totalBytes: number, worktreeCount: number }`

- [ ] `GET /api/:pid/worktrees/:id` — Get worktree details
  - Call `worktreeManager.get(worktreeId)`
  - Return `200` with `Worktree`
  - Return `404` if not found

- [ ] `DELETE /api/:pid/worktrees/:id` — Remove a worktree
  - Call `worktreeManager.remove(worktreeId)`
  - Return `204` on success
  - Return `409` if worktree is `in_use`

- [ ] `GET /api/:pid/worktrees/:id/status` — Get worktree status with fresh disk usage
  - Call `worktreeManager.updateDiskUsage(worktreeId)` then `worktreeManager.get(worktreeId)`
  - Return `200` with `{ status, diskUsageBytes, lastAccessedAt }`

### 2.2 Socket.IO Event Wiring

File: `packages/worker-service/src/core/socket-bridge.ts` (amend existing)

- [ ] Add `worktree:*` event forwarding from WorktreeManager to Socket.IO rooms (ADR-048 amendment)
- [ ] All worktree events emit to `project:{projectId}` room:
  - `worktree:created` — `{ worktreeId, branch, path, createdByType }`
  - `worktree:status-changed` — `{ worktreeId, oldStatus, newStatus }`
  - `worktree:in-use` — `{ worktreeId, automationRunId?, chatSessionId? }`
  - `worktree:completed` — `{ worktreeId, success }`
  - `worktree:removed` — `{ worktreeId }`
  - `worktree:error` — `{ worktreeId, error }`
  - `worktree:cleanup` — `{ removed: number, freedBytes: number }`
- [ ] WorktreeManager emits events via the `io` instance passed in constructor
- [ ] Ensure event emission happens in WorktreeManager methods (Phase 1) — this task verifies the wiring is correct

### 2.3 Wire WorktreeManager into App Lifecycle

File: `packages/worker-service/src/app.ts` (amend existing)

- [ ] Instantiate `WorktreeManager` with `db` and `io` after Socket.IO server is created
- [ ] Call `worktreeManager.start()` during server startup (after DB is ready)
- [ ] Call `worktreeManager.stop()` during graceful shutdown
- [ ] Register worktree routes on the Express app:
  ```typescript
  app.use("/api/:pid/worktrees", worktreeRoutes(worktreeManager));
  ```
- [ ] Export `worktreeManager` instance for access by AutomationEngine (Phase 4)

### 2.4 Tests

File: `packages/worker-service/src/routes/worktrees.test.ts`

- [ ] Test `GET /api/:pid/worktrees` returns worktree list
- [ ] Test `POST /api/:pid/worktrees` creates worktree successfully
- [ ] Test `POST /api/:pid/worktrees` returns 400 for missing required fields
- [ ] Test `POST /api/:pid/worktrees` returns 409 for branch conflict
- [ ] Test `POST /api/:pid/worktrees/cleanup` triggers cleanup and returns result
- [ ] Test `GET /api/:pid/worktrees/disk-usage` returns total bytes
- [ ] Test `GET /api/:pid/worktrees/:id` returns worktree details
- [ ] Test `GET /api/:pid/worktrees/:id` returns 404 for unknown worktree
- [ ] Test `DELETE /api/:pid/worktrees/:id` removes worktree
- [ ] Test `DELETE /api/:pid/worktrees/:id` returns 409 for in_use worktree
- [ ] Test route ordering: `/cleanup` and `/disk-usage` are not matched as `:id`

## Verification

```bash
pnpm run lint
pnpm run lint:duplication
pnpm --filter @renre-kit/worker-service test -- --run worktrees
pnpm run build
```
