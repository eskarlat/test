#!/bin/bash
# sdd-check.sh — Plan-vs-implementation verification for SDD workflow
#
# Runs validation gates and launches an AI agent to audit all phases
# against the plan. Fixes issues and re-checks until 100% parity.
#
# Usage:
#   ./sdd-check.sh <task-name> [options]
#
# Options:
#   --max-iterations <N>   Fix-and-recheck cycles (default: 10)
#   --agent <cmd>          Agent command (default: copilot)
#   --agent-flags <flags>  Agent flags (default: --yolo)
#   --gates-only           Only run lint/duplication/tests, skip agent audit
#   --dry-run              Show the prompt without running the agent
#
# Examples:
#   ./sdd-check.sh user-auth
#   ./sdd-check.sh user-auth --gates-only
#   ./sdd-check.sh user-auth --agent claude --agent-flags "--dangerously-skip-permissions"

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
. "${SCRIPT_DIR}/lib/gates.sh"
. "${SCRIPT_DIR}/lib/prompt-builder.sh"

# --- Defaults ---
TASK_NAME=""
MAX_ITERATIONS=10
AGENT_CMD="copilot"
AGENT_FLAGS="--yolo"
GATES_ONLY=false
DRY_RUN=false

# --- Parse args ---
while [[ $# -gt 0 ]]; do
  case $1 in
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
    --gates-only)
      GATES_ONLY=true
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
  if [[ -d ".renre-kit/tasks" ]]; then
    echo "" >&2
    echo "Available tasks:" >&2
    ls -1 ".renre-kit/tasks/" 2>/dev/null | sed 's/^/  /' >&2
  fi
  exit 1
fi

echo "════════════════════════════════════════════════════════════"
echo "SDD Check: ${TASK_NAME}"
echo "Agent: ${AGENT_CMD} ${AGENT_FLAGS}"
echo "Max iterations: ${MAX_ITERATIONS}"
echo "════════════════════════════════════════════════════════════"

# Build the full check prompt
build_check_prompt "$TASK_NAME"

if $DRY_RUN; then
  echo ""
  echo "--- PROMPT START ---"
  echo -e "$CHECK_PROMPT"
  echo "--- PROMPT END ---"
  exit 0
fi

iteration=0
while [[ $iteration -lt $MAX_ITERATIONS ]]; do
  iteration=$((iteration + 1))
  echo ""
  echo "🔍 Check iteration ${iteration}/${MAX_ITERATIONS}"
  echo "────────────────────────────────────────"

  # Run validation gates first
  echo "Running validation gates..."
  run_all_gates "$iteration"

  if $GATES_PASSED; then
    if $GATES_ONLY; then
      echo ""
      echo -e "${GREEN}✅ All gates passed.${NC}"
      exit 0
    fi

    echo -e "${GREEN}Gates passed. Running agent audit...${NC}"
  else
    echo "Gates failed. Running agent to fix issues..."
  fi

  if ! $GATES_ONLY; then
    # Build prompt with gate results appended
    local_prompt="${CHECK_PROMPT}"

    if ! $GATES_PASSED; then
      local_prompt="${CHECK_PROMPT}

${GATES_REPORT}

IMPORTANT: Fix ALL gate failures above before proceeding with the plan-vs-implementation audit."
    fi

    # Write prompt to temp file
    prompt_file=$(mktemp "${TMPDIR:-/tmp}/sdd-check-XXXXXX.md")
    echo -e "$local_prompt" > "$prompt_file"

    echo "Running: ${AGENT_CMD} ${AGENT_FLAGS} -p <prompt>"
    ${AGENT_CMD} ${AGENT_FLAGS} -p "$(cat "$prompt_file")" || true

    rm -f "$prompt_file"

    # Re-run gates after agent fixes
    echo ""
    echo "Re-running gates after agent fixes..."
    run_all_gates "$iteration"

    if $GATES_PASSED; then
      echo ""
      echo -e "${GREEN}✅ All gates passed. Verification complete.${NC}"
      echo ""
      echo "Task: ${TASK_NAME}"
      echo "Lint: ✓ | Duplication: ✓ | Tests: ✓ | Agent audit: ✓"
      exit 0
    fi
  fi

  echo "Issues remain — continuing to next iteration..."
done

echo ""
echo -e "${RED}⚠️  Max iterations (${MAX_ITERATIONS}) reached. Issues remain:${NC}"
echo -e "$GATES_REPORT"
exit 1
