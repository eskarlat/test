#!/bin/bash
# prompt-builder.sh — Constructs agent prompts from SDD plan files
# Source this file: . "$(dirname "$0")/lib/prompt-builder.sh"

set -euo pipefail

# Find the task directory. Args: task_name
# Sets TASK_DIR to the absolute path.
resolve_task_dir() {
  local task_name="$1"
  TASK_DIR=".renre-kit/tasks/${task_name}"

  if [[ ! -d "$TASK_DIR" ]]; then
    echo "Error: Task directory not found: $TASK_DIR" >&2
    return 1
  fi
}

# Find the next pending phase. Args: task_dir
# Sets NEXT_PHASE_NUM and NEXT_PHASE_FILE.
find_next_phase() {
  local task_dir="$1"
  local plan_dir="${task_dir}/plan"

  NEXT_PHASE_NUM=""
  NEXT_PHASE_FILE=""

  # Read README.md to find first Pending phase
  local readme="${plan_dir}/README.md"
  if [[ ! -f "$readme" ]]; then
    echo "Error: Plan README not found: $readme" >&2
    return 1
  fi

  # Parse the phases table — look for first "Pending" status
  NEXT_PHASE_NUM=$(grep -E '^\|\s*[0-9]+' "$readme" | grep -i 'pending' | head -1 | sed 's/|//g' | awk '{print $1}' | xargs)

  if [[ -z "$NEXT_PHASE_NUM" ]]; then
    echo "All phases completed." >&2
    return 1
  fi

  # Zero-pad to 2 digits
  NEXT_PHASE_NUM=$(printf "%02d" "$NEXT_PHASE_NUM")

  # Find the matching phase file
  NEXT_PHASE_FILE=$(ls "${plan_dir}"/phase-${NEXT_PHASE_NUM}-*.md 2>/dev/null | head -1)

  if [[ -z "$NEXT_PHASE_FILE" || ! -f "$NEXT_PHASE_FILE" ]]; then
    echo "Error: Phase file not found for phase ${NEXT_PHASE_NUM} in ${plan_dir}/" >&2
    return 1
  fi
}

# Read all ADRs into a single string. Args: task_dir
# Sets ADRS_CONTENT.
read_adrs() {
  local task_dir="$1"
  local adr_dir="${task_dir}/adr"

  ADRS_CONTENT=""

  if [[ ! -d "$adr_dir" ]]; then
    return 0
  fi

  for adr_file in "${adr_dir}"/*.md; do
    [[ -f "$adr_file" ]] || continue
    ADRS_CONTENT+="--- $(basename "$adr_file") ---\n"
    ADRS_CONTENT+="$(cat "$adr_file")\n\n"
  done
}

# Build the full implementation prompt. Args: task_name, phase_num (optional)
# Sets IMPLEMENTATION_PROMPT.
build_implementation_prompt() {
  local task_name="$1"
  local phase_num="${2:-}"

  resolve_task_dir "$task_name"

  if [[ -n "$phase_num" ]]; then
    NEXT_PHASE_NUM=$(printf "%02d" "$phase_num")
    NEXT_PHASE_FILE=$(ls "${TASK_DIR}/plan"/phase-${NEXT_PHASE_NUM}-*.md 2>/dev/null | head -1)
    if [[ -z "$NEXT_PHASE_FILE" || ! -f "$NEXT_PHASE_FILE" ]]; then
      echo "Error: Phase file not found for phase ${NEXT_PHASE_NUM}" >&2
      return 1
    fi
  else
    find_next_phase "$TASK_DIR"
  fi

  read_adrs "$TASK_DIR"

  local phase_content
  phase_content=$(cat "$NEXT_PHASE_FILE")

  local phase_title
  phase_title=$(head -1 "$NEXT_PHASE_FILE" | sed 's/^#\s*//')

  IMPLEMENTATION_PROMPT="Implement ${phase_title} of task \"${task_name}\".

## Phase Specification

${phase_content}

## Architecture Decision Records

${ADRS_CONTENT}

## Implementation Rules

- Production-quality code ONLY — no stubs, no TODO, no placeholders, no throw new Error('not implemented')
- Match ADR specifications exactly — if ADR says AES-256-GCM, implement AES-256-GCM
- Follow project conventions from rules/ directory (read rules/typescript.md, rules/nodejs.md, rules/sql.md, rules/react.md as relevant)
- Write tests for every new function/module — match existing test patterns
- Create files at exactly the planned file paths
- Read existing files before modifying them
- Prefer editing existing files over creating new ones

## Validation Gates

After implementing all tasks, run these checks. If any fail, fix the issues and re-run.

### Gate 1: Lint
\`\`\`bash
pnpm run lint
\`\`\`
Zero errors required. Fix complexity (max 10) and cognitive complexity (max 15) warnings.
DO NOT use eslint-disable — refactor instead.

### Gate 2: Duplication
\`\`\`bash
pnpm run lint:duplication
\`\`\`
Zero new duplications. Extract shared logic into utilities if found.

### Gate 3: Tests
\`\`\`bash
pnpm run test
\`\`\`
All tests must pass — existing and new.

### Gate 4: Plan-vs-Implementation
Review every task item in the phase. Verify:
- Implementation exists (not stubbed)
- Matches ADR specs
- File paths match plan
- Tests exist for new code
- Acceptance criteria met
"
}

# Build the check prompt for full verification. Args: task_name
# Sets CHECK_PROMPT.
build_check_prompt() {
  local task_name="$1"

  resolve_task_dir "$task_name"
  read_adrs "$TASK_DIR"

  local plan_readme
  plan_readme=$(cat "${TASK_DIR}/plan/README.md")

  # Collect all phase files
  local all_phases=""
  for phase_file in "${TASK_DIR}/plan"/phase-*.md; do
    [[ -f "$phase_file" ]] || continue
    all_phases+="--- $(basename "$phase_file") ---\n"
    all_phases+="$(cat "$phase_file")\n\n"
  done

  CHECK_PROMPT="Verify plan-vs-implementation parity for ALL phases of task \"${task_name}\".

## Plan Overview

${plan_readme}

## All Phase Specifications

${all_phases}

## Architecture Decision Records

${ADRS_CONTENT}

## Verification Instructions

For EVERY task item in EVERY completed phase:

1. EXISTENCE: Implementation exists at the planned file path. Not a stub, TODO, placeholder, or skeleton.
2. CORRECTNESS: Matches ADR specifications exactly — data models, API contracts, algorithms, error handling.
3. COMPLETENESS: Every sub-task checkbox item is done. Test files exist for new code.
4. ACCEPTANCE CRITERIA: Each criterion is individually met.

## Validation Gates

Run all of these and fix any failures:

### Gate 1: Lint
\`\`\`bash
pnpm run lint
\`\`\`
Zero errors. Complexity max 10, cognitive complexity max 15. Refactor, do not suppress.

### Gate 2: Duplication
\`\`\`bash
pnpm run lint:duplication
\`\`\`
Zero duplications.

### Gate 3: Tests
\`\`\`bash
pnpm run test
\`\`\`
All pass.

## Report Format

For each phase, list:
- PASS items (task + evidence file path)
- FAIL items (task + what is missing/wrong)
- DEVIATION items (how it differs + explanation)

Then fix ALL FAIL and DEVIATION items. Re-run gates until clean.
"
}
