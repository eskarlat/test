# Phase 9 — Console UI: Run History, Debug & Help

## Goal

Implement the automation run history list, run detail view with chain timeline, step detail tabs (prompt, response, tools, debug), tool call log viewer, live streaming view via Socket.IO, and full-page help drawer.

## Reference

- ADR-050: Automations (§10.3, §10.4, §10.2.1 full help drawer)

## Dependencies

- Phase 8 (Automations List & Chain Editor) — automation store, types, and page structure must exist

## Tasks

### 9.1 Run History Store Extension

File: `packages/console-ui/src/stores/automation-store.ts` (amend)

- [ ] Add run-related state and actions:
  ```typescript
  // Additional state
  runs: AutomationRun[];
  activeRun: AutomationRunDetail | null;
  runLoading: boolean;

  // Additional actions
  fetchRuns: (projectId: string, automationId: string, opts?: { limit?: number; status?: string }) => Promise<void>;
  fetchRunDetails: (projectId: string, automationId: string, runId: string) => Promise<void>;
  cancelRun: (projectId: string, automationId: string, runId: string) => Promise<void>;

  // Socket.IO run-level events (automation:{runId} room)
  joinRunRoom: (runId: string) => void;
  leaveRunRoom: (runId: string) => void;
  onStepStarted: (data: StepStartedEvent) => void;
  onStepCompleted: (data: StepCompletedEvent) => void;
  onStepFailed: (data: StepFailedEvent) => void;
  onToolCalled: (data: ToolCalledEvent) => void;
  onMessageDelta: (data: MessageDeltaEvent) => void;
  onAutomationLog: (data: AutomationLogEvent) => void;
  ```

### 9.2 Run History Types

File: `packages/console-ui/src/types/automation.ts` (amend)

- [ ] Add types:
  - `AutomationRun` (summary for list view)
  - `AutomationRunDetail` (full detail with steps and tool calls)
  - `StepExecution` with all debug fields
  - `ToolCallLog` with `autoApproved` field
  - `WorktreeRunInfo`
  - Socket.IO event types for run-level events

### 9.3 Run History Page

File: `packages/console-ui/src/routes/automation-runs.tsx`

- [ ] Create page at URL `/:projectId/automations/:id/runs`
- [ ] Header: "{automation.name} — Run History"
- [ ] Render run list matching ADR-050 §10.3 wireframe:
  - Each run card shows:
    - Run number
    - Status badge (completed ✓, completed_with_warnings ⚠, failed ✗, cancelled, timed_out)
    - Trigger type (Scheduled / Manual)
    - Timestamp (relative + absolute)
    - Duration
    - Step progress: "Steps: {completed}/{total}" with failure indication
    - Total token count
    - Worktree info (if applicable): branch, path, cleanup status
    - Error message (for failed runs)
    - `[Details]` button → navigates to run detail
- [ ] Running automations appear at the top of the history list with animated `running` badge and live duration counter
- [ ] Status filter dropdown (all / completed / failed / running / etc.)
- [ ] Pagination or infinite scroll

### 9.4 Run Status Badges

File: `packages/console-ui/src/components/automations/RunStatusBadge.tsx`

- [ ] Status badges for runs:
  | Status | Icon | Color |
  |--------|------|-------|
  | `completed` | ✓ | green |
  | `completed_with_warnings` | ⚠ | yellow |
  | `failed` | ✗ | red |
  | `cancelled` | ⊘ | gray |
  | `timed_out` | ⏰ | orange |
  | `running` | spinner | blue (animated) |
  | `pending` | ○ | gray |

- [ ] Step status badges:
  | Status | Color |
  |--------|-------|
  | `completed` | green |
  | `failed` | red |
  | `skipped` | yellow |
  | `running` | blue (animated) |
  | `pending` | gray |

### 9.5 Run Detail Page

File: `packages/console-ui/src/routes/automation-run-detail.tsx`

- [ ] Create page at URL `/:projectId/automations/:id/runs/:runId`
- [ ] Header: "Run #{number} — {automation.name}" with status, start time, duration

- [ ] **Chain Timeline** (ADR-050 §10.4):
  - Horizontal timeline bar showing all steps
  - Each step labeled with: name, duration, model/effort
  - Color-coded by status (green=completed, red=failed, yellow=skipped, gray=pending)
  - Proportional width based on duration

- [ ] **Worktree info section** (when applicable):
  - Branch name, path, cleanup status (active/cleaned_up/retained)
  - Link to Worktrees page

- [ ] **Step detail sections** — one collapsible section per step (see Task 9.6)

- [ ] **Final Output section**:
  - Display the last step's response in a formatted block (markdown rendering if text, JSON viewer if JSON)

- [ ] **Cancel button** for running automations

### 9.6 Step Detail Component

File: `packages/console-ui/src/components/automations/StepDetail.tsx`

- [ ] Step header: "Step {N}: {name}" with status badge and duration
- [ ] **Tab bar**: `[Prompt]  [Response]  [Tools ({count})]  [Debug]`

  **Prompt tab:**
  - Resolved prompt text (after variable substitution) in a code block
  - System prompt text in a separate code block
  - Model and reasoning effort display

  **Response tab:**
  - Full LLM response text
  - Markdown rendering for text output
  - JSON syntax highlighting for JSON output
  - Token count: input / output

  **Tools tab:**
  - Tool call log list (Task 9.7)
  - Count of total tool calls

  **Debug tab:**
  - All metadata: model, effort, step index, timeout, onError strategy
  - Timing: startedAt, completedAt, durationMs
  - Token breakdown: inputTokens, outputTokens
  - Error details (if failed)
  - Auto-approved tool count
  - Governance-denied tool count

### 9.7 Tool Call Log Viewer

File: `packages/console-ui/src/components/automations/ToolCallLog.tsx`

- [ ] Display each tool call matching ADR-050 §10.4 tool call wireframe:
  - Row format: `{index}. {toolName}  │  {source}  │  {status}  │  {duration}`
  - Source badge: Built-in / Extension / MCP (with extension name for ext/mcp)
  - Success/failure indicator
  - **Auto-approved badge**: highlight `autoApproved: true` calls with distinct visual (e.g., "AUTOPILOT" badge)
  - **Governance-denied badge**: highlight denied calls with "DENIED" badge
  - Expandable detail:
    - Arguments (JSON formatted)
    - Result (JSON formatted, truncated with "show more" for large results)
    - Error message (if failed)
    - Timestamp

### 9.8 Live Run View (Socket.IO Streaming)

File: `packages/console-ui/src/components/automations/LiveRunView.tsx`

- [ ] When viewing a run with status `running`:
  - Join `automation:{runId}` Socket.IO room
  - Show live step progress (steps light up as they start/complete)
  - Stream `automation:message-delta` events to show LLM response in real-time
  - Show `automation:tool-called` events as they happen
  - Show `automation:log` events in a live log tail
  - Show `automation:step-started` / `automation:step-completed` transitions
  - Auto-scroll to latest activity

- [ ] On run completion:
  - Leave `automation:{runId}` room
  - Refresh full run details via REST

- [ ] Cancel button calls `cancelRun()` and shows toast

### 9.9 Full Help Drawer

File: `packages/console-ui/src/components/automations/HelpDrawer.tsx`

- [ ] Implement full-page help drawer matching ADR-050 §10.2.1 "Full help drawer":
  - Opened via top-level `[? Help]` button on chain editor
  - Slide-in drawer from right side

  **Sections:**
  1. **What is an Automation?**
     - Chain of LLM prompts on a schedule
     - Different models/efforts per step
     - Output feeds between steps

  2. **Prompt Chain**
     - Steps run sequentially
     - `{{prev.output}}` passes data
     - JSON output format for structured extraction

  3. **Template Variables** — full reference table:
     | Variable | Description |
     |----------|-------------|
     | `{{prev.output}}` | Previous step's full response |
     | `{{prev.json.field}}` | JSON field from previous step |
     | `{{steps.name.output}}` | Output from a named step |
     | `{{variables.key}}` | Custom variables |
     | `{{project.name}}` | Project name |
     | `{{project.id}}` | Project ID |
     | `{{now}}` | Current ISO datetime |
     | `{{now.date}}` | Current date |
     | `{{now.time}}` | Current time |
     | `{{worktree.path}}` | Worktree directory |
     | `{{worktree.branch}}` | Worktree branch |

  4. **Scheduling**
     - Cron syntax with examples
     - Once (single execution)
     - Manual (Run Now only)

  5. **Worktrees**
     - What they are, when to use
     - Cleanup policies
     - Link to Worktrees page

  6. **Models & Effort**
     - Different models per step tips
     - Effort levels explained

  7. **Error Handling**
     - Stop: abort chain
     - Skip: mark skipped, continue
     - Retry: retry N times

  8. **Tools**
     - Built-in tools, extension routes, MCP server tools
     - Per-step selection

### 9.10 Route Registration

File: `packages/console-ui/src/main.tsx` (amend)

- [ ] Add routes:
  - `/:projectId/automations/:id/runs` → `AutomationRunsPage`
  - `/:projectId/automations/:id/runs/:runId` → `AutomationRunDetailPage`
- [ ] Lazy load page components

### 9.11 Extension Job Logs Modal

File: `packages/console-ui/src/components/automations/ExtensionJobLogsModal.tsx`

- [ ] Simple modal showing run history for an extension cron job
- [ ] Fetches from `GET /api/:pid/ext-cron/:jobId/runs`
- [ ] Each row: status badge, timestamp, duration, error (if any)
- [ ] Pagination with limit parameter

### 9.12 Tests

File: `packages/console-ui/src/routes/automation-runs.test.tsx`

- [ ] Test run history page renders run list
- [ ] Test run status badges display correctly
- [ ] Test status filter works
- [ ] Test clicking Details navigates to run detail

File: `packages/console-ui/src/routes/automation-run-detail.test.tsx`

- [ ] Test run detail page renders chain timeline
- [ ] Test step detail tabs switch correctly
- [ ] Test prompt tab shows resolved prompt and system prompt
- [ ] Test response tab renders LLM response
- [ ] Test tools tab shows tool call log
- [ ] Test tool call expandable shows arguments/result
- [ ] Test auto-approved badge appears for autopilot calls
- [ ] Test cancel button for running automations
- [ ] Test worktree info section when applicable

File: `packages/console-ui/src/components/automations/HelpDrawer.test.tsx`

- [ ] Test help drawer opens and closes
- [ ] Test all sections are rendered
- [ ] Test template variables table is complete

File: `packages/console-ui/src/components/automations/LiveRunView.test.tsx`

- [ ] Test Socket.IO room join/leave on mount/unmount
- [ ] Test live step progress updates
- [ ] Test message delta streaming

## Verification

```bash
pnpm run lint
pnpm run lint:duplication
pnpm --filter @renre-kit/console-ui test -- --run automation-runs automation-run-detail HelpDrawer LiveRunView
pnpm run build
```
