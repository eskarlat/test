---
description: Verify plan-vs-implementation parity across all phases. Runs lint, duplication, complexity, and completeness checks. Fixes all issues found. Works with any AI agent CLI.
model: opus
---

# /check — Plan-vs-Implementation Verification

## Description

Comprehensive verification that implementation matches the plan 100%. Checks every phase, every task, every validation gate. Finds and fixes all discrepancies. Runs as a Ralph loop — iterates until everything is clean.

## Quick Start (Terminal)

```bash
# Full check with Copilot (default)
.renre-kit/scripts/sdd-workflow/sdd-check.sh my-task

# Gates only (no agent audit)
.renre-kit/scripts/sdd-workflow/sdd-check.sh my-task --gates-only

# Using Claude Code
.renre-kit/scripts/sdd-workflow/sdd-check.sh my-task --agent claude --agent-flags "--dangerously-skip-permissions"

# Preview prompt
.renre-kit/scripts/sdd-workflow/sdd-check.sh my-task --dry-run
```

## Instructions (When Running Inside an Agent)

If you are an AI agent executing this skill directly, follow this workflow.

### Step 0: Locate the Plan

1. If the user specifies a task name: use `.renre-kit/tasks/{task-name}/`
2. If not: list `.renre-kit/tasks/` directories, show them, ask which to check

Read:
- `.renre-kit/tasks/{task-name}/plan/README.md` — all phases
- All ADR files in `.renre-kit/tasks/{task-name}/adr/`
- All diagram files in `.renre-kit/tasks/{task-name}/diagrams/`

### Step 1: Phase-by-Phase Audit (Parallel)

Launch parallel subagents — one per completed/in-progress phase. Each subagent (Agent tool, subagent_type: Explore) receives:

```
Audit Phase {NN} of task "{task-name}" for plan-vs-implementation parity.

Read the phase plan: .renre-kit/tasks/{task-name}/plan/phase-{NN}-{name}.md
Read all ADRs in: .renre-kit/tasks/{task-name}/adr/

For EVERY task item and sub-item:

1. EXISTENCE: Does the implementation exist at the planned file path?
   Not a stub, TODO, placeholder, or skeleton. Actually functional.

2. CORRECTNESS: Does it match ADR specs?
   Data models, API contracts, algorithms, error handling, security.

3. COMPLETENESS: Are all sub-tasks done?
   Every checkbox item. Test files exist for new code.

4. ACCEPTANCE CRITERIA: Each criterion individually met?

Report:
## Phase {NN}: {Title}
### PASS
- [task] — [evidence: file:line]
### FAIL
- [task] — [what is missing/wrong]
### DEVIATION
- [task] — [how it differs]
### SUMMARY
Total: N | Pass: N | Fail: N | Deviation: N
```

### Step 2: Run Validation Gates

```bash
pnpm run lint
pnpm run lint:duplication
pnpm run test
```

Analyze output:
- **Lint errors**: list each with file path and rule
- **Complexity > 10**: flag the function
- **Cognitive complexity > 15**: flag the function
- **Duplications**: list blocks with file paths
- **Test failures**: list with error messages

### Step 3: Consolidated Report

```markdown
# Verification Report: {task-name}

## Overall Status: PASS | FAIL

## Phase Results
| Phase | Total | Pass | Fail | Deviation |
|-------|-------|------|------|-----------|
| 01    | N     | N    | N    | N         |

## Lint: errors N | complexity warnings N | cognitive warnings N
## Duplication: blocks N
## Tests: total N | pass N | fail N

## Issues Requiring Fix
1. [description + file + fix needed]
```

### Step 4: Fix All Issues (Ralph Loop)

If status is FAIL, fix everything. This is a loop — repeat until clean.

**Priority order:**
1. FAIL items — missing/broken implementations
2. Test failures — fix code or tests
3. Lint errors — must be zero
4. Complexity violations — refactor:
   - `complexity > 10`: extract branches, early returns, lookup tables
   - `cognitive complexity > 15`: break nested logic, extract named conditions, split functions
5. Duplication — extract shared utilities
6. DEVIATION items — align with plan (or update plan if implementation is better, noting why)
7. Lint warnings — fix remaining

For each fix: read file → targeted edit → verify fix.

### Step 5: Re-Verify (Loop)

After fixes, re-run everything:
1. `pnpm run lint` — clean
2. `pnpm run lint:duplication` — clean
3. `pnpm run test` — pass
4. Re-audit any phase that had FAIL/DEVIATION items

**Repeat Steps 3-5 until overall status is PASS.**

### Step 6: Update Plan

Once everything passes:
1. Update phase statuses in plan README
2. Report: "Verification complete. All phases match plan. All gates pass."

## Script Reference

### sdd-check.sh flags

| Flag | Default | Description |
|------|---------|-------------|
| `--max-iterations <N>` | 10 | Fix-and-recheck cycles |
| `--agent <cmd>` | `copilot` | Agent CLI binary |
| `--agent-flags <flags>` | `--yolo` | Agent permission flags |
| `--gates-only` | false | Skip agent audit, only run lint/dup/tests |
| `--dry-run` | false | Print prompt, don't run |

## Tips

1. **Run `/check` after every `/implement` phase.** Catches drift early.
2. **Use `--gates-only` for quick smoke tests.** Full audit is slower but more thorough.
3. **Be strict.** "Close enough" is FAIL. If plan says Zod validation, a manual `if` check is FAIL.
4. **Fix, don't flag.** This is not just a reporter — fix every issue found. Only inform the user of issues you cannot fix (missing external dep, ambiguous requirement).
5. **Don't weaken the plan.** If something is hard to implement as specified, fix the implementation. Only update the plan when the spec is genuinely wrong.
