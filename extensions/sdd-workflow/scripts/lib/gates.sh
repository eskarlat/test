#!/bin/bash
# gates.sh — Validation gate runners for SDD workflow
# Source this file: . "$(dirname "$0")/lib/gates.sh"

set -euo pipefail

# Colors (if terminal supports it)
if [[ -t 1 ]]; then
  RED='\033[0;31m'
  GREEN='\033[0;32m'
  YELLOW='\033[1;33m'
  NC='\033[0m'
else
  RED=''
  GREEN=''
  YELLOW=''
  NC=''
fi

# Run lint gate. Returns 0 if pass, 1 if fail.
# Captures output to $GATE_LINT_OUTPUT
run_gate_lint() {
  echo -e "${YELLOW}Gate 1: Lint${NC}"
  GATE_LINT_OUTPUT=$(pnpm run lint 2>&1) && {
    echo -e "${GREEN}  ✓ Lint passed${NC}"
    return 0
  } || {
    echo -e "${RED}  ✗ Lint failed${NC}"
    return 1
  }
}

# Run duplication gate. Returns 0 if pass, 1 if fail.
# Captures output to $GATE_DUP_OUTPUT
run_gate_duplication() {
  echo -e "${YELLOW}Gate 2: Duplication${NC}"
  GATE_DUP_OUTPUT=$(pnpm run lint:duplication 2>&1) && {
    echo -e "${GREEN}  ✓ Duplication check passed${NC}"
    return 0
  } || {
    echo -e "${RED}  ✗ Duplication detected${NC}"
    return 1
  }
}

# Run test gate. Returns 0 if pass, 1 if fail.
# Captures output to $GATE_TEST_OUTPUT
run_gate_tests() {
  echo -e "${YELLOW}Gate 3: Tests${NC}"
  GATE_TEST_OUTPUT=$(pnpm run test 2>&1) && {
    echo -e "${GREEN}  ✓ Tests passed${NC}"
    return 0
  } || {
    echo -e "${RED}  ✗ Tests failed${NC}"
    return 1
  }
}

# Run all gates. Sets GATES_PASSED=true/false and GATES_REPORT with details.
run_all_gates() {
  local lint_ok=true
  local dup_ok=true
  local test_ok=true

  GATE_LINT_OUTPUT=""
  GATE_DUP_OUTPUT=""
  GATE_TEST_OUTPUT=""

  run_gate_lint || lint_ok=false
  run_gate_duplication || dup_ok=false
  run_gate_tests || test_ok=false

  # Build report
  GATES_REPORT="## Gate Results (Iteration $1)\n\n"

  if $lint_ok; then
    GATES_REPORT+="### Gate 1: Lint — PASS\n\n"
  else
    GATES_REPORT+="### Gate 1: Lint — FAIL\n\n\`\`\`\n${GATE_LINT_OUTPUT}\n\`\`\`\n\n"
    GATES_REPORT+="Fix: zero errors required. Complexity max 10, cognitive complexity max 15.\n\n"
  fi

  if $dup_ok; then
    GATES_REPORT+="### Gate 2: Duplication — PASS\n\n"
  else
    GATES_REPORT+="### Gate 2: Duplication — FAIL\n\n\`\`\`\n${GATE_DUP_OUTPUT}\n\`\`\`\n\n"
    GATES_REPORT+="Fix: extract duplicated code into shared utilities.\n\n"
  fi

  if $test_ok; then
    GATES_REPORT+="### Gate 3: Tests — PASS\n\n"
  else
    GATES_REPORT+="### Gate 3: Tests — FAIL\n\n\`\`\`\n${GATE_TEST_OUTPUT}\n\`\`\`\n\n"
    GATES_REPORT+="Fix: make all tests pass. Do not delete or skip tests.\n\n"
  fi

  if $lint_ok && $dup_ok && $test_ok; then
    GATES_PASSED=true
  else
    GATES_PASSED=false
  fi
}
