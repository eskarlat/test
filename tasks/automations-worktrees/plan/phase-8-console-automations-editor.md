# Phase 8 — Console UI: Automations List & Chain Editor

## Goal

Implement the Automations page with automation list view, visual chain editor for creating/editing automations, schedule configuration, worktree settings, variable editor, model/effort selectors, tool access configuration, autopilot confirmation dialog, and extension cron jobs section.

## Reference

- ADR-050: Automations (§10.1, §10.2, §16.9)
- ADR-024: Console UI Pages (sidebar amendment)

## Dependencies

- Phase 5 (Automation REST API) — REST routes must be available
- Phase 6 (Extension Scheduler) — ext-cron REST routes for extension jobs section

## Tasks

### 8.1 Zustand Store: `automation-store`

File: `packages/console-ui/src/stores/automation-store.ts`

- [ ] Create Zustand store for automation state:
  ```typescript
  interface AutomationStore {
    automations: Automation[];
    extensionJobs: ExtensionCronJob[];
    models: ModelInfo[];
    loading: boolean;
    error: string | null;

    // Automation actions
    fetchAutomations: (projectId: string) => Promise<void>;
    createAutomation: (projectId: string, input: CreateAutomationInput) => Promise<Automation>;
    updateAutomation: (projectId: string, id: string, updates: UpdateAutomationInput) => Promise<Automation>;
    deleteAutomation: (projectId: string, id: string) => Promise<void>;
    toggleAutomation: (projectId: string, id: string, enabled: boolean) => Promise<void>;
    triggerRun: (projectId: string, id: string) => Promise<string>;

    // Extension job actions
    fetchExtensionJobs: (projectId: string) => Promise<void>;
    toggleExtensionJob: (projectId: string, jobId: string, enabled: boolean) => Promise<void>;

    // Model list
    fetchModels: (projectId: string) => Promise<void>;

    // Socket.IO event handlers
    onRunStarted: (data: RunStartedEvent) => void;
    onRunCompleted: (data: RunCompletedEvent) => void;
  }
  ```
- [ ] Implement API calls using existing HTTP client
- [ ] Wire Socket.IO listeners for `automation:run-started` and `automation:run-completed` on project room

### 8.2 Automation Type Definitions

File: `packages/console-ui/src/types/automation.ts`

- [ ] Define client-side types matching ADR-050 §2:
  - `Automation`, `AutomationSchedule`, `PromptStep`, `ToolAccess`, `WorktreeConfig`
  - `CreateAutomationInput`, `UpdateAutomationInput`
  - `ModelInfo` (from CopilotBridge.listModels)
  - `ExtensionCronJob`, `ExtensionCronJobRun` (for extension jobs section)
  - Socket.IO event payload types

### 8.3 Automations List Page

File: `packages/console-ui/src/routes/automations.tsx`

- [ ] Create page component at URL `/:projectId/automations`
- [ ] Header: "Automations" title, `[+ New Automation]` button
- [ ] **User Automations section** (ADR-050 §10.1):
  - Section header: "User Automations" with description "(user-created prompt chains — full edit/delete control)"
  - Render automation cards (Task 8.4)
- [ ] **Extension Jobs section** (ADR-050 §16.9):
  - Section header: "Extension Jobs" with description "(registered by extensions — view & toggle only)"
  - Render extension cron job cards (Task 8.5)
  - Only shown if there are extension jobs
- [ ] Empty state for each section
- [ ] Loading skeleton while fetching

### 8.4 Automation Card Component

File: `packages/console-ui/src/components/automations/AutomationCard.tsx`

- [ ] Display automation card matching ADR-050 §10.1 wireframe:
  - Header: automation name, ON/OFF toggle
  - Schedule display: cron human-readable description (e.g., "Every weekday at 9:00 AM")
  - Step count
  - Last run status with relative time
  - Model chain display (e.g., "gpt-4o → claude-sonnet → gpt-4o")
  - Worktree indicator (if enabled)
  - Action buttons: `[Run Now]`, `[Edit]`, `[···]` menu (delete, view history)
- [ ] `[Run Now]` calls `triggerRun()`, shows toast on success/conflict
- [ ] Toggle switch calls `toggleAutomation()` with autopilot dialog (Task 8.10)
- [ ] `[Edit]` navigates to chain editor

### 8.5 Extension Cron Job Card

File: `packages/console-ui/src/components/automations/ExtensionJobCard.tsx`

- [ ] Display extension job card matching ADR-050 §16.9 wireframe:
  - Header: `{extension-name}: {job-name}`, ON/OFF toggle
  - Schedule: cron human-readable description
  - Last run status with relative time
  - Average duration
  - Description text
  - Action buttons: `[Pause]`/`[Resume]`, `[Logs]`
- [ ] Toggle calls `toggleExtensionJob()`
- [ ] `[Logs]` opens run history for this job (simple modal or expandable section)

### 8.6 Chain Editor Page

File: `packages/console-ui/src/routes/automation-editor.tsx`

- [ ] Create editor page at URL `/:projectId/automations/new` and `/:projectId/automations/:id/edit`
- [ ] Top bar: "Edit: {name}" (or "New Automation"), `[? Help]`, `[Save]`, `[Cancel]`
- [ ] Load existing automation data when editing
- [ ] Form sections (each with `[?]` help icon — see Task 8.12):

  **Name & Description:**
  - Name text input (required)
  - Description text input (optional)

  **Schedule section** (ADR-050 §10.2):
  - Type radio: Cron / Once / Manual
  - Cron expression input with human-readable preview
  - Timezone dropdown (IANA timezones)
  - Active date range (optional `startsAt`/`endsAt` date pickers)
  - For "Once": datetime picker for `runAt`
  - For "Manual": no schedule fields

  **Worktree section** (ADR-050 §10.2):
  - Checkbox: "Run in isolated worktree"
  - Branch dropdown (when enabled)
  - Cleanup policy dropdown (always/on success/never/TTL)
  - TTL input (when TTL selected)
  - Info box explaining worktree concept

  **System Prompt section:**
  - Multiline textarea
  - Supports template variables (displayed in placeholder/help)

  **Variables section:**
  - Key-value pair list
  - `[+ Add Variable]` button
  - Remove button per variable

  **Max Duration:**
  - Number input for total chain timeout in minutes

### 8.7 Prompt Step Editor

File: `packages/console-ui/src/components/automations/PromptStepEditor.tsx`

- [ ] Visual step component matching ADR-050 §10.2 wireframe:
  - Step header: "Step {N}: {name}" with drag handle (for reordering)
  - Step name input
  - Model dropdown (populated from `fetchModels()`)
  - Reasoning effort dropdown: low / medium / high
  - Timeout input (seconds)
  - Tool access configuration (Task 8.8)
  - Error handling dropdown: stop / skip / retry
  - Retry count input (visible when "retry" selected)
  - Output format radio: Text / JSON
  - Prompt textarea (multiline, with template variable hints)
  - Remove step button

- [ ] **Visual chain connector** between steps:
  - Arrow/line connecting step output to next step input
  - Label: "output feeds into next step"

- [ ] `[+ Add Step]` button at the bottom to append new steps
- [ ] Drag-and-drop reordering of steps (or up/down buttons)

### 8.8 Tool Access Selector

File: `packages/console-ui/src/components/automations/ToolAccessSelector.tsx`

- [ ] Per-step tool access configuration (ADR-050 §7):
  - Checkbox: "Built-in tools" (file read, search, shell)
  - Extensions dropdown: "all" or multi-select specific extensions
    - Populated from project's installed extensions
  - MCP dropdown: "all" or multi-select specific MCP servers
    - Populated from project's configured MCP servers

### 8.9 Model Selector

File: `packages/console-ui/src/components/automations/ModelSelector.tsx`

- [ ] Dropdown showing available models from CopilotBridge
- [ ] Display model name with capability badges (vision, reasoning)
- [ ] Effort level selector next to model selector

### 8.10 Autopilot Confirmation Dialog

File: `packages/console-ui/src/components/automations/AutopilotDialog.tsx`

- [ ] Implement confirmation dialog matching ADR-050 §5.1:
  ```
  Enable Autopilot Mode

  This automation will run in autopilot mode.

  All tool permission requests (file writes, shell
  commands, API calls) will be automatically approved
  without human review.

  You can review all actions in the run logs afterward.

  Tool governance rules still apply — denied tools
  will be blocked regardless of autopilot mode.

  [Cancel]  [Enable Autopilot]
  ```
- [ ] Show when:
  - Creating a new automation (on save)
  - Enabling a previously disabled automation (on toggle)
- [ ] Store acknowledgment (don't re-show for same automation unless disabled and re-enabled)

### 8.11 Form Submission & Validation

File: `packages/console-ui/src/routes/automation-editor.tsx`

- [ ] Validate form before submission:
  - Name required
  - At least 1 step in chain
  - Each step has: name, prompt, model, onError
  - Cron expression valid (if type is cron)
  - runAt is in the future (if type is once)
- [ ] Show inline validation errors
- [ ] On save: call `createAutomation()` or `updateAutomation()`
- [ ] Show autopilot dialog before final save (Task 8.10)
- [ ] Navigate back to automations list on success
- [ ] Show error toast on failure

### 8.12 Section Help Icons

File: `packages/console-ui/src/components/automations/SectionHelp.tsx`

- [ ] Reusable `[?]` help icon component that toggles inline help panel
- [ ] Collapsible panel below section header with help content
- [ ] Implement help content for each section (ADR-050 §10.2.1):
  - **Schedule**: cron syntax reference, examples, "Once" and "Manual" explanations
  - **Worktree**: what worktrees are, when to use, cleanup options
  - **System Prompt**: purpose, template variables, tips
  - **Variables**: all available template variables with syntax
  - **Prompt Chain**: chain concept, `{{prev.output}}`, model tips, error handling

### 8.13 Sidebar Navigation Update

File: `packages/console-ui/src/components/layout/Sidebar.tsx` (amend)

- [ ] Add "Automations" as a core sidebar item (ADR-050 §13, ADR-024 amendment):
  ```
  Dashboard
  Chat
  Automations        ← NEW
  Worktrees
  ────────────────
  (extension pages)
  ────────────────
  Extension Manager
  Logs
  ```
- [ ] Use appropriate icon (e.g., Timer/Clock icon)
- [ ] Active state when on `/:projectId/automations` or `/:projectId/automations/*`

### 8.14 Route Registration

File: `packages/console-ui/src/main.tsx` (amend)

- [ ] Add routes:
  - `/:projectId/automations` → `AutomationsPage`
  - `/:projectId/automations/new` → `AutomationEditorPage`
  - `/:projectId/automations/:id/edit` → `AutomationEditorPage`
- [ ] Lazy load page components

### 8.15 Tests

File: `packages/console-ui/src/routes/automations.test.tsx`

- [ ] Test AutomationsPage renders automation list
- [ ] Test AutomationsPage renders extension jobs section
- [ ] Test AutomationsPage empty state
- [ ] Test automation card displays schedule, model chain, last run
- [ ] Test toggle calls API
- [ ] Test Run Now button calls trigger API

File: `packages/console-ui/src/routes/automation-editor.test.tsx`

- [ ] Test editor renders all sections
- [ ] Test adding/removing steps
- [ ] Test cron expression validation
- [ ] Test form submission creates automation
- [ ] Test form submission with validation errors shows inline errors
- [ ] Test autopilot dialog appears on save

File: `packages/console-ui/src/stores/automation-store.test.ts`

- [ ] Test fetchAutomations populates store
- [ ] Test createAutomation adds to store
- [ ] Test toggleAutomation updates store
- [ ] Test Socket.IO events update automation last run status

## Verification

```bash
pnpm run lint
pnpm run lint:duplication
pnpm --filter @renre-kit/console-ui test -- --run automations automation-editor
pnpm run build
```
