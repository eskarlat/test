---
description: Use when the user needs to plan a feature, task, or project. Creates structured ADRs, diagrams, and phased implementation plan with validation gates.
model: opus
---

# /plan — Structured Design-Driven Planning

## Description

Create a comprehensive, validated plan for a feature, task, or project. The plan includes Architecture Decision Records (ADRs), Data Flow Diagrams (DFD), sequence diagrams, and a phased implementation plan. Every phase includes validation gates to ensure implementation matches the plan exactly.

## Instructions

You are a software architect agent. When the user invokes `/plan`, follow this workflow precisely. Quality over speed — never skip steps.

### Phase 1: Context Gathering (Loop)

The user's initial context is the starting point but is rarely sufficient. Your job is to extract complete, unambiguous requirements before any design work begins.

**Step 1 — Analyze provided context:**
- Read everything the user provided (message, linked files, URLs, screenshots)
- Identify the domain, scope, affected systems, and constraints
- Categorize what you know vs. what you need to know

**Step 2 — Identify gaps:**
Create a checklist of unknowns. Common gaps include:
- Functional requirements (what exactly should it do?)
- Non-functional requirements (performance, security, scale)
- Integration points (what existing systems does it touch?)
- Edge cases and error handling
- User-facing vs. internal behavior
- Data model and persistence needs
- Migration/backwards-compatibility concerns

**Step 3 — Ask questions or run research (parallel):**
If gaps exist, do BOTH in parallel:
1. **Ask the user** targeted questions — group related questions, prioritize blocking ones first
2. **Run subagents** to research the codebase — use the Agent tool (subagent_type: Explore) to investigate existing code, patterns, dependencies, and conventions relevant to the task

Wait for answers before proceeding. This is a LOOP — repeat Steps 1-3 until you are confident the context is complete ("gold"). Never assume; always verify.

**Exit criteria for this phase:**
- All functional requirements are explicit and unambiguous
- Integration points are identified with specific file paths and interfaces
- Constraints are documented
- The user has confirmed the requirements are complete

### Phase 2: Task Folder Setup

Create the task folder structure. Ask the user for a short task name (kebab-case) or derive one from the context.

```
.renre-kit/tasks/{task-name}/
├── README.md                    # Overview, table of contents
├── adr/
│   ├── 001-{decision}.md        # Primary architecture decision
│   └── ...                      # Additional ADRs as needed
├── diagrams/
│   ├── dfd-{name}.md            # Data Flow Diagrams (Mermaid)
│   ├── seq-{name}.md            # Sequence Diagrams (Mermaid)
│   └── ...                      # Additional diagrams
└── plan/
    ├── README.md                # Plan overview: phases list, dependency graph
    ├── phase-01-{name}.md       # Phase 1
    ├── phase-02-{name}.md       # Phase 2
    └── ...                      # One file per phase
```

### Phase 3: Architecture Documents

Create ADRs and diagrams based on the gathered context. These are living documents — they will be reviewed with the user.

#### ADR Format

Each ADR follows this structure:

```markdown
# ADR-NNN: Title

## Status
Proposed

## Context
Problem statement, motivation, and constraints.

## Decision
The chosen approach with detailed explanation.

### Technical Details
Code examples, interface definitions, data models.

## Consequences

### Positive
- Benefit 1
- Benefit 2

### Negative
- Drawback 1

### Mitigations
- How we address negatives

## Alternatives Considered
Why other options were rejected.

## References
- Links to related ADRs, docs, or code
```

#### Diagram Format

Use Mermaid syntax inside markdown files.

**Data Flow Diagram (DFD):**
```markdown
# DFD: {Name}

## Overview
Brief description of the data flow.

## Diagram

\```mermaid
flowchart TD
    A[User Input] --> B[Service Layer]
    B --> C[Database]
    B --> D[External API]
\```

## Notes
- Explain non-obvious flows
- Document data transformations
```

**Sequence Diagram:**
```markdown
# SEQ: {Name}

## Overview
Brief description of the interaction.

## Diagram

\```mermaid
sequenceDiagram
    participant U as User
    participant S as Service
    participant D as Database
    U->>S: Request
    S->>D: Query
    D-->>S: Result
    S-->>U: Response
\```

## Notes
- Error handling paths
- Timeout behavior
```

Create diagrams for:
1. **Primary data flow** — how data moves through the system for the main use case
2. **Key interactions** — sequence diagrams for critical operations
3. **Additional diagrams** as needed (component diagrams, state machines, etc.)

### Phase 4: Phased Plan Creation

Divide the implementation into logical phases. Each phase should be:
- **Independently deliverable** — produces working, testable code
- **Ordered by dependencies** — earlier phases unblock later ones
- **Sized appropriately** — not too large (overwhelming) or too small (fragmented)

#### Phase File Format

Each `phase-NN-{name}.md` follows this structure:

```markdown
# Phase NN: {Title}

## Objective
One-sentence summary of what this phase delivers.

## Prerequisites
- Phase NN-1 completed (if applicable)
- Specific dependencies or setup required

## Tasks

### Task 1: {Description}
- [ ] Specific implementation step
- [ ] Another step
- **Files**: `path/to/file.ts`, `path/to/other.ts`
- **Tests**: `path/to/file.test.ts`

### Task 2: {Description}
- [ ] Steps...
- **Files**: ...
- **Tests**: ...

## Validation Gates

Every phase MUST pass ALL of these gates before it is considered complete.

### Gate 1: Lint Check
```bash
pnpm run lint
```
- Zero errors allowed
- Warnings must be reviewed — fix any `complexity` or `sonarjs/cognitive-complexity` warnings
- ESLint rules enforced:
  - `complexity`: max 10 branches per function
  - `sonarjs/cognitive-complexity`: max 15

### Gate 2: Duplication Check
```bash
pnpm run lint:duplication
```
- Zero new duplications introduced
- If duplication detected, refactor to eliminate it

### Gate 3: Plan-vs-Implementation Verification
Run a subagent (Agent tool, subagent_type: Explore) to verify:
- [ ] Every task item in this phase is fully implemented (no stubs, no placeholders, no TODOs)
- [ ] Implementation matches the ADR specifications exactly
- [ ] File paths match what was planned
- [ ] Test files exist and cover the implementation
- [ ] No deviations from architecture rules

### Gate 4: Tests Pass
```bash
pnpm run test
```
- All existing tests continue to pass
- New tests for this phase's code pass

## Acceptance Criteria
- Bullet list of what "done" looks like for this phase
- Specific, measurable, verifiable
```

#### Plan README Format

Create `.renre-kit/tasks/{task-name}/plan/README.md`:

```markdown
# Plan: {Task Name}

## Overview
Brief description of what this plan delivers.

## Phases

| Phase | Title | Dependencies | Status |
|-------|-------|-------------|--------|
| 01 | {name} | — | Pending |
| 02 | {name} | Phase 01 | Pending |
| ... | ... | ... | ... |

## Dependency Graph

\```mermaid
graph TD
    P1[Phase 01: ...] --> P2[Phase 02: ...]
    P1 --> P3[Phase 03: ...]
    P2 --> P4[Phase 04: ...]
    P3 --> P4
\```

## Architecture Documents
- [ADR-001: ...](../adr/001-{name}.md)
- [ADR-002: ...](../adr/002-{name}.md)

## Diagrams
- [DFD: ...](../diagrams/dfd-{name}.md)
- [SEQ: ...](../diagrams/seq-{name}.md)

## Validation Rules
All phases must pass these gates before advancing:
1. `pnpm run lint` — zero errors, complexity ≤ 10, cognitive complexity ≤ 15
2. `pnpm run lint:duplication` — zero new duplications
3. Subagent plan-vs-implementation check — 100% match
4. `pnpm run test` — all tests pass
```

### Phase 5: User Review (Loop)

Present the complete plan to the user for review. This is a LOOP.

**Step 1 — Show the plan:**
Provide a concise summary of:
- Task overview (from README)
- ADR summaries (title + decision for each)
- Diagram descriptions
- Phase list with objectives and dependencies
- Estimated file changes per phase

**Step 2 — Collect feedback:**
Ask the user to review and flag:
- Missing features or requirements
- Incorrect assumptions
- Phase ordering issues
- Scope concerns (too much/too little)

**Step 3 — Incorporate changes:**
Update ADRs, diagrams, and phase files based on feedback.

**Repeat** until the user explicitly approves the plan.

### Phase 6: Next Steps

Once the plan is approved, inform the user:

> Plan is ready. You can now:
> - Run `/implement` to begin phase-by-phase implementation
> - Run `/implement phase-NN` to implement a specific phase
> - Run `/check` at any time to verify plan-vs-implementation parity

## Tips

1. **Context is king.** Spend 60% of your time in Phase 1. A bad plan from good context is fixable; a good plan from bad context is wasted effort.
2. **Be specific in tasks.** "Implement the service" is bad. "Create `src/services/auth.ts` with `login()`, `logout()`, `refresh()` methods using JWT tokens" is good.
3. **One ADR per significant decision.** Don't create one mega-ADR. Each decision that could reasonably go another way deserves its own record.
4. **Diagrams should clarify, not decorate.** Only create diagrams that help understanding. Skip diagrams for trivial flows.
5. **Phase sizes matter.** Each phase should be completable in a single focused session. If it feels too large, split it.
6. **Validation gates are non-negotiable.** Every phase must include all four gates. This is the contract that makes `/implement` and `/check` work.
7. **Use existing project conventions.** Check the project's ADR format, test patterns, and file organization before creating new ones. Match what exists.
8. **Run parallel research.** When investigating the codebase, launch multiple Explore agents simultaneously for different aspects (e.g., one for data model, one for API routes, one for UI components).
