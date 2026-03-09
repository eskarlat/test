---
description: Use after /plan to implement phases using a self-correcting Ralph loop. Each phase iterates until all validation gates pass, then advances. Works with any AI agent CLI (Copilot, Claude, etc).
model: opus
---

# /implement — Ralph Loop Phase Implementation

## Description

Execute an SDD plan phase-by-phase using the Ralph Loop methodology. Each phase runs inside a self-correcting `while true` loop that invokes an AI agent repeatedly until all validation gates pass. The agent sees its previous work in files and receives gate failure details to self-correct. No external plugins required — the loop logic is embedded in the extension scripts.

## How It Works

The Ralph loop is a simple concept: run an AI agent with the same prompt in a `while true` loop. Between iterations, check validation gates. If gates fail, append the failure details to the prompt and run again. The agent sees its previous file changes and the error output, so it self-corrects.

```
┌─────────────────────────────────────────────┐
│  while iteration < max_iterations:          │
│    1. Run agent with prompt                 │
│    2. Run gates (lint, duplication, tests)   │
│    3. If all pass → mark complete → break   │
│    4. Append gate failures to prompt        │
│    5. Next iteration (agent sees its work)  │
└─────────────────────────────────────────────┘
```

## Quick Start (Terminal)

The extension includes ready-to-run scripts. From the project root:

### Using Copilot (default)

```bash
# Implement next pending phase
.renre-kit/scripts/sdd-workflow/sdd-implement.sh my-task

# Implement specific phase
.renre-kit/scripts/sdd-workflow/sdd-implement.sh my-task --phase 2

# Implement all remaining phases
.renre-kit/scripts/sdd-workflow/sdd-implement.sh my-task --all

# Preview the prompt without running
.renre-kit/scripts/sdd-workflow/sdd-implement.sh my-task --dry-run
```

### Using Claude Code

```bash
.renre-kit/scripts/sdd-workflow/sdd-implement.sh my-task --agent claude --agent-flags "--dangerously-skip-permissions"
```

### Using any agent

```bash
.renre-kit/scripts/sdd-workflow/sdd-implement.sh my-task --agent <binary> --agent-flags "<flags>"
```

The only requirement is that the agent CLI supports `-p "prompt"` for non-interactive execution.

## Instructions (When Running Inside an Agent)

If you are an AI agent executing this skill directly (not via the shell scripts), follow this workflow. This embeds the full Ralph loop logic so no external tools are needed.

### Step 0: Locate the Plan

1. If the user specifies a task name: read `.renre-kit/tasks/{task-name}/plan/README.md`
2. If the user specifies a phase: read that specific phase file
3. If neither: list `.renre-kit/tasks/` directories, show them, ask which to implement

Read the plan README to understand:
- Total phases and their dependencies
- Which phases are completed (check `Status` column)
- The next pending phase

Read ALL ADRs in `.renre-kit/tasks/{task-name}/adr/` — implementations must match exactly.

### Step 1: Read the Phase

Read the phase file completely. Understand:
- Objective
- Prerequisites (verify they are met)
- Every task and sub-task with file paths
- Acceptance criteria

### Step 2: Pre-Implementation Research

Before writing code:
1. Read existing files that will be modified
2. Run Explore agents in parallel for unfamiliar areas
3. Read relevant project rules (`rules/typescript.md`, `rules/nodejs.md`, etc.)
4. Check ADR specs — implementation must match exactly, not a simplified version

### Step 3: Implement All Tasks

Execute each task sequentially:
- Write production-quality code — no stubs, no TODO, no placeholders
- Follow project conventions from `rules/` directory
- Write tests alongside code
- Create files at exactly the planned paths
- Read before write — always understand current state first

### Step 4: Run Validation Gates (The Ralph Loop)

This is the core loop. Run all gates, fix failures, repeat until clean.

```
ITERATION = 1
MAX_ITERATIONS = 30

LOOP:
  Run Gate 1: Lint
  Run Gate 2: Duplication
  Run Gate 3: Tests
  Run Gate 4: Plan-vs-Implementation (subagent)

  If ALL pass → EXIT LOOP
  If ANY fail → fix issues → ITERATION++ → LOOP
  If ITERATION > MAX_ITERATIONS → report to user → stop
```

#### Gate 1: Lint

```bash
pnpm run lint
```

- Zero errors required
- Fix `complexity` warnings (max 10 branches per function)
- Fix `sonarjs/cognitive-complexity` warnings (max 15)
- DO NOT use `eslint-disable` — refactor instead:
  - Extract conditional logic into helper functions
  - Use early returns instead of nested if/else
  - Replace switch with lookup objects
  - Break large functions into focused helpers

#### Gate 2: Duplication

```bash
pnpm run lint:duplication
```

- Zero new duplications
- If found: extract shared logic into utilities, use existing modules

#### Gate 3: Tests

```bash
pnpm run test
```

- All existing tests pass (no regressions)
- New tests for this phase's code pass

#### Gate 4: Plan-vs-Implementation

Launch a subagent (Agent tool, subagent_type: Explore) to verify:
- Every task item is fully implemented (not stubbed, not TODO)
- Implementation matches ADR specs
- File paths match the plan
- Test files exist for new code
- Acceptance criteria are met

Report: PASS / FAIL / DEVIATION per item. Fix all FAIL and DEVIATION.

### Step 5: Self-Correction (Ralph Pattern)

When a gate fails:

1. **Read the error output** — don't guess, read the actual errors
2. **Identify the root cause** — not symptoms
3. **Fix the code** — targeted edit, not wholesale rewrite
4. **Re-run the failed gate** — verify the fix works
5. **Re-run ALL gates** — ensure no regressions
6. **Repeat** until all gates pass

This is the Ralph philosophy: **failures are data**. Each failed gate tells the agent exactly what to fix. The loop continues until the work is genuinely complete.

**Common self-correction patterns:**
- Lint error → read the specific rule → fix the code → re-lint
- Test failure → read the test → read the implementation → fix mismatch → re-test
- Duplication → identify the copies → extract to shared utility → re-check
- Plan mismatch → read the plan item → read the ADR → fix implementation → re-verify

### Step 6: Update Plan Status

After all gates pass:
1. Edit `.renre-kit/tasks/{task-name}/plan/README.md`
2. Change phase status from `Pending` to `Completed`

### Step 7: Advance or Report

**If more phases remain:**
```
Phase {NN}: {Title} — Completed
Iterations: {N}
Gates: lint ✓ | duplication ✓ | tests ✓ | plan-vs-implementation ✓
Next: Phase {NN+1}: {Title}
Continue? (y/n)
```

**If all phases complete:**
- Report: "All phases implemented and validated."
- Suggest: "Run `/check` (or `sdd-check.sh`) for final verification."

### Handling Edge Cases

**Plan has errors:**
1. Fix the implementation to be correct
2. Update the phase file to match
3. Update affected ADRs
4. Note deviation in phase file under `## Deviations from Original Plan`

**Task is blocked:**
1. Check prerequisites
2. Document the blocker
3. Ask the user — do not skip

**Gate keeps failing after 3 attempts on same issue:**
1. Document the problem in the phase file under `## Known Issues`
2. Move to the next gate
3. Report to the user

## Script Reference

| Script | Purpose |
|--------|---------|
| `.renre-kit/scripts/sdd-workflow/sdd-implement.sh` | Ralph loop driver — runs agent + gates in a loop per phase |
| `.renre-kit/scripts/sdd-workflow/sdd-check.sh` | Full verification — audits all phases + gates |
| `.renre-kit/scripts/sdd-workflow/lib/gates.sh` | Gate runners (lint, duplication, tests) |
| `.renre-kit/scripts/sdd-workflow/lib/prompt-builder.sh` | Builds agent prompts from plan files |

### sdd-implement.sh flags

| Flag | Default | Description |
|------|---------|-------------|
| `--phase <N>` | next pending | Specific phase number |
| `--max-iterations <N>` | 30 | Safety limit |
| `--agent <cmd>` | `copilot` | Agent CLI binary |
| `--agent-flags <flags>` | `--yolo` | Flags for agent (permissions, model, etc.) |
| `--all` | false | Implement all remaining phases |
| `--dry-run` | false | Print prompt, don't run |
