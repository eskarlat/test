# Phase 7 — Console UI: Worktrees Page

## Goal

Implement the Console UI Worktrees page with list view, create dialog, status badges, detail actions, disk usage display, and real-time updates via Socket.IO. Add Worktrees to the sidebar navigation.

## Reference

- ADR-051: Git Worktree Management (§8, §12)
- ADR-024: Console UI Pages (sidebar amendment)

## Dependencies

- Phase 2 (Worktree REST API & Socket.IO) — REST routes and Socket.IO events must be available

## Tasks

### 7.1 Zustand Store: `worktree-store`

File: `packages/console-ui/src/stores/worktree-store.ts`

- [ ] Create Zustand store for worktree state:
  ```typescript
  interface WorktreeStore {
    worktrees: Worktree[];
    totalDiskUsage: number;
    worktreeCount: number;
    loading: boolean;
    error: string | null;

    // Actions
    fetchWorktrees: (projectId: string) => Promise<void>;
    fetchDiskUsage: (projectId: string) => Promise<void>;
    createWorktree: (projectId: string, opts: CreateWorktreeInput) => Promise<Worktree>;
    removeWorktree: (projectId: string, worktreeId: string) => Promise<void>;
    triggerCleanup: (projectId: string) => Promise<CleanupResult>;

    // Socket.IO event handlers
    onWorktreeCreated: (data: WorktreeCreatedEvent) => void;
    onWorktreeStatusChanged: (data: WorktreeStatusChangedEvent) => void;
    onWorktreeRemoved: (data: WorktreeRemovedEvent) => void;
    onWorktreeError: (data: WorktreeErrorEvent) => void;
    onWorktreeCleanup: (data: WorktreeCleanupEvent) => void;
  }
  ```
- [ ] Implement API calls using existing `client.ts` HTTP client
- [ ] Implement Socket.IO event handlers that update store state in real-time
- [ ] Wire Socket.IO listeners on store initialization (subscribe to `worktree:*` events)

### 7.2 Worktree Type Definitions

File: `packages/console-ui/src/types/worktree.ts`

- [ ] Define client-side types matching ADR-051 §2:
  - `Worktree`, `WorktreeStatus`, `WorktreeCreator`, `CleanupPolicy`
  - `CreateWorktreeInput` (for the create dialog form)
  - `CleanupResult`
  - Socket.IO event payload types: `WorktreeCreatedEvent`, `WorktreeStatusChangedEvent`, etc.

### 7.3 Worktrees List Page

File: `packages/console-ui/src/routes/worktrees.tsx`

- [ ] Create page component at URL `/:projectId/worktrees`
- [ ] Header: "Worktrees" title, `[+ New Worktree]` button, `[Cleanup]` button
- [ ] Total disk usage summary: "Total disk usage: {X} MB across {N} worktrees"
- [ ] Render worktree cards (see Task 7.4)
- [ ] Empty state when no worktrees exist
- [ ] Loading skeleton while fetching
- [ ] Error state with retry

### 7.4 Worktree Card Component

File: `packages/console-ui/src/components/worktrees/WorktreeCard.tsx`

- [ ] Display worktree card matching ADR-051 §8.1 wireframe:
  - Header: worktree ID, branch name, status badge
  - Created by line: "Automation 'X' (Run #Y)" or "User (manual)" or "Chat session"
  - Path display
  - Metadata row: created time (relative), disk usage, cleanup policy
  - **Status-specific content:**
    - `in_use`: show progress info, link to run detail `[View Run]`
    - `ready`: show `[Open Terminal]` and `[Remove]` buttons
    - `completed`: show result summary, `[View Changes]`, `[Merge]`, `[Remove]` buttons
    - `error`: show error message, `[Retry]` and `[Remove]` buttons
    - `creating`/`removing`: show spinner

### 7.5 Status Badges

File: `packages/console-ui/src/components/worktrees/WorktreeStatusBadge.tsx`

- [ ] Implement status badges matching ADR-051 §8.4:
  | Status | Label | Color |
  |--------|-------|-------|
  | `creating` | CREATING | gray |
  | `ready` | READY | blue |
  | `in_use` | IN USE | green (animated pulse) |
  | `completed` | COMPLETED | green (solid) |
  | `error` | ERROR | red |
  | `removing` | REMOVING | gray |
- [ ] Use shadcn/ui Badge component with appropriate variant/color
- [ ] `in_use` badge should have subtle animation (pulse or shimmer) indicating active work

### 7.6 Create Worktree Dialog

File: `packages/console-ui/src/components/worktrees/CreateWorktreeDialog.tsx`

- [ ] Implement dialog matching ADR-051 §8.2 wireframe:
  - Radio: "Use existing branch" / "Create new branch"
  - Branch name input (text input for new, dropdown for existing)
  - Base branch dropdown (when creating new branch)
  - Cleanup policy radio group:
    - Always — auto-remove when done
    - On success — keep on failure for debugging
    - Never — manual cleanup
    - TTL — auto-remove after [input] hours
  - TTL input field (visible only when TTL selected)
  - Cancel / Create Worktree buttons
- [ ] Form validation: branch name required, TTL must be positive number
- [ ] On submit: call `worktreeStore.createWorktree()`
- [ ] Show error toast on failure (e.g., branch checkout conflict)
- [ ] Close dialog on success

### 7.7 Worktree Detail Actions

File: `packages/console-ui/src/components/worktrees/WorktreeActions.tsx`

- [ ] Implement action buttons for completed worktrees (ADR-051 §8.3):
  - **View Changes**: opens a panel/modal showing `git diff` output from worktree
    - Calls backend: `git -C {worktreePath} diff HEAD`
    - Displays diff in a code block with syntax highlighting
  - **Open Terminal**: copies worktree path to clipboard with toast notification
  - **Merge**: opens confirmation dialog for merging worktree branch into target branch
    - Target branch selector (dropdown of local branches, default: baseBranch or main)
    - Confirmation text: "Merge {worktreeBranch} into {targetBranch}?"
    - Backend executes: `git -C {projectPath} merge {worktreeBranch}` (fast-forward preferred)
    - On merge conflict: show error with message "Merge conflict detected — resolve manually in terminal" and copy worktree path
    - On success: show toast with merge result, optionally offer to remove worktree
  - **Create PR**: opens GitHub PR creation URL in browser
    - Requires worktree branch to be pushed to remote first
    - If not pushed: offer to push (`git -C {projectPath} push -u origin {worktreeBranch}`)
    - Construct GitHub URL: `https://github.com/{owner}/{repo}/compare/{baseBranch}...{worktreeBranch}?expand=1`
    - If not a GitHub repo: show "Not available — project is not hosted on GitHub" message
  - **Remove**: confirmation dialog (warns if changes exist), calls `removeWorktree()`

- [ ] Implement remove confirmation dialog:
  - "Are you sure? This worktree has uncommitted changes." (conditional)
  - Cancel / Remove buttons

### 7.8 Disk Usage Display

File: `packages/console-ui/src/components/worktrees/DiskUsageBar.tsx`

- [ ] Show total disk usage for project worktrees
- [ ] Format bytes to human-readable (KB/MB/GB)
- [ ] Optional progress bar against `maxWorktreeDiskMb` limit

### 7.9 Sidebar Navigation Update

File: `packages/console-ui/src/components/layout/Sidebar.tsx` (amend existing)

- [ ] Add "Worktrees" as a core sidebar item (ADR-051 §12, ADR-024 amendment):
  ```
  Dashboard
  Chat
  Automations        ← Phase 8 adds this
  Worktrees          ← NEW
  ────────────────
  (extension pages)
  ────────────────
  Extension Manager
  Logs
  ```
- [ ] Use appropriate icon for Worktrees (e.g., GitBranch icon)
- [ ] Active state styling when on `/:projectId/worktrees`

### 7.10 Route Registration

File: `packages/console-ui/src/main.tsx` (amend existing router config)

- [ ] Add route: `/:projectId/worktrees` → `WorktreesPage`
- [ ] Lazy load the page component

### 7.11 Socket.IO Event Subscription

File: `packages/console-ui/src/routes/worktrees.tsx` or store

- [ ] Subscribe to `worktree:*` events when page mounts / store initializes
- [ ] `worktree:created` → add new worktree to list
- [ ] `worktree:status-changed` → update status in list
- [ ] `worktree:in-use` → update status, show active indicator
- [ ] `worktree:completed` → update status
- [ ] `worktree:removed` → remove from list
- [ ] `worktree:error` → update status, show error
- [ ] `worktree:cleanup` → show toast with cleanup results, refresh list

### 7.12 Tests

File: `packages/console-ui/src/routes/worktrees.test.tsx`

- [ ] Test WorktreesPage renders empty state
- [ ] Test WorktreesPage renders worktree list
- [ ] Test status badges display correct colors
- [ ] Test create dialog opens and submits
- [ ] Test create dialog validates required fields
- [ ] Test remove confirmation dialog
- [ ] Test disk usage display

File: `packages/console-ui/src/stores/worktree-store.test.ts`

- [ ] Test fetchWorktrees populates store
- [ ] Test createWorktree adds to store
- [ ] Test removeWorktree removes from store
- [ ] Test Socket.IO event handlers update state correctly

## Verification

```bash
pnpm run lint
pnpm run lint:duplication
pnpm --filter @renre-kit/console-ui test -- --run worktrees
pnpm run build
```
