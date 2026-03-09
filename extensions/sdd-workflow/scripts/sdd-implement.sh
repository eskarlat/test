#!/bin/bash
# sdd-implement.sh — Ralph loop implementation driver for SDD workflow
#
# Runs an AI agent in a while loop, checking validation gates between
# iterations. The agent sees its previous work in files and receives
# gate failure details in the prompt to self-correct.
#
# Usage:
#   ./sdd-implement.sh <task-name> [options]
#
# Options:
#   --phase <N>            Implement specific phase (default: next pending)
#   --max-iterations <N>   Safety limit (default: 30)
#   --agent <cmd>          Agent command (default: copilot)
#   --agent-flags <flags>  Agent flags (default: --yolo)
#   --all                  Implement all remaining phases sequentially
#   --dry-run              Show the prompt without running the agent
#
# Examples:
#   ./sdd-implement.sh user-auth
#   ./sdd-implement.sh user-auth --phase 2
#   ./sdd-implement.sh user-auth --agent claude --agent-flags "--dangerously-skip-permissions"
#   ./sdd-implement.sh user-auth --all --max-iterations 20

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/lib/gates.sh"
. "${SCRIPT_DIR}/lib/prompt-builder.sh"

# --- Defaults ---
TASK_NAME=""
PHASE_NUM=""
MAX_ITERATIONS=30
AGENT_CMD="copilot"
AGENT_FLAGS="--yolo"
IMPLEMENT_ALL=false
DRY_RUN=false

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case $1 in
    --phase)
      PHASE_NUM="$2"
      shift 2
      ;;
    --max-iterations)
      MAX_ITERATIONS="$2"
      shift 2
      ;;
    --agent)
      AGENT_CMD="$2"
      shift 2
      ;;
    --agent-flags)
      AGENT_FLAGS="$2"
      shift 2
      ;;
    --all)
      IMPLEMENT_ALL=true
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    -h|--help)
      sed -n '2,/^$/p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      if [[ -z "$TASK_NAME" ]]; then
        TASK_NAME="$1"
      else
        echo "Error: unexpected argument: $1" >&2
        exit 1
      fi
      shift
      ;;
  esac
done

if [[ -z "$TASK_NAME" ]]; then
  echo "Error: task name required" >&2
  echo "Usage: $0 <task-name> [options]" >&2

  # List available tasks
  if [[ -d ".renre-kit/tasks" ]]; then
    echo "" >&2
    echo "Available tasks:" >&2
    ls -1 ".renre-kit/tasks/" 2>/dev/null | sed 's/^/  /' >&2
  fi
  exit 1
fi

# --- Implement one phase ---
implement_phase() {
  local task="$1"
  local phase="${2:-}"

  echo ""
  echo "════════════════════════════════════════════════════════════"

  # Build prompt
  if [[ -n "$phase" ]]; then
    build_implementation_prompt "$task" "$phase"
  else
    build_implementation_prompt "$task"
  fi

  local phase_num="$NEXT_PHASE_NUM"

  echo "Phase ${phase_num} | Task: ${task} | Agent: ${AGENT_CMD} ${AGENT_FLAGS}"
  echo "Max iterations: ${MAX_ITERATIONS}"
  echo "════════════════════════════════════════════════════════════"

  if $DRY_RUN; then
    echo ""
    echo "--- PROMPT START ---"
    echo -e "$IMPLEMENTATION_PROMPT"
    echo "--- PROMPT END ---"
    return 0
  fi

  local iteration=0
  local prompt="$IMPLEMENTATION_PROMPT"

  while [[ $iteration -lt $MAX_ITERATIONS ]]; do
    iteration=$((iteration + 1))
    echo ""
    echo "🔄 Iteration ${iteration}/${MAX_ITERATIONS}"
    echo "────────────────────────────────────────"

    # Write prompt to temp file (avoids shell escaping issues with large prompts)
    local prompt_file
    prompt_file=$(mktemp "${TMPDIR:-/tmp}/sdd-prompt-XXXXXX.md")
    echo -e "$prompt" > "$prompt_file"

    # Run agent
    echo "Running: ${AGENT_CMD} ${AGENT_FLAGS} -p <prompt>"
    ${AGENT_CMD} ${AGENT_FLAGS} -p "$(cat "$prompt_file")" || true

    rm -f "$prompt_file"

    # Run validation gates
    echo ""
    echo "Running validation gates..."
    run_all_gates "$iteration"

    if $GATES_PASSED; then
      echo ""
      echo -e "${GREEN}✅ All gates passed at iteration ${iteration}${NC}"

      # Update plan status
      local readme=".renre-kit/tasks/${task}/plan/README.md"
      if [[ -f "$readme" ]]; then
        # Replace "Pending" with "Completed" for this phase number
        local phase_int=$((10#$phase_num))
        sed -i.bak "s/^\(|[[:space:]]*${phase_int}[[:space:]]*|.*|\)[[:space:]]*Pending[[:space:]]*|/\1 Completed |/" "$readme"
        rm -f "${readme}.bak"
        echo "Updated plan status: Phase ${phase_num} → Completed"
      fi

      return 0
    fi

    # Append gate failure details to prompt for next iteration
    prompt="${IMPLEMENTATION_PROMPT}

${GATES_REPORT}

IMPORTANT: The above gates failed in the previous iteration. Read the error output carefully and fix ALL issues before running gates again. Do not repeat the same mistakes."

    echo ""
    echo "Gates failed — feeding results to next iteration..."
  done

  echo ""
  echo -e "${RED}⚠️  Max iterations (${MAX_ITERATIONS}) reached without all gates passing.${NC}"
  echo "Last gate report:"
  echo -e "$GATES_REPORT"
  return 1
}

# --- Main ---
if $IMPLEMENT_ALL; then
  echo "Implementing all remaining phases for task: ${TASK_NAME}"

  while true; do
    resolve_task_dir "$TASK_NAME"
    find_next_phase "$TASK_DIR" || {
      echo ""
      echo "✅ All phases completed for task: ${TASK_NAME}"
      echo "Run: ./sdd-check.sh ${TASK_NAME} — for final verification"
      break
    }

    implement_phase "$TASK_NAME" || {
      echo ""
      echo "Phase ${NEXT_PHASE_NUM} did not complete. Stopping."
      exit 1
    }
  done
else
  implement_phase "$TASK_NAME" "$PHASE_NUM"
fi
