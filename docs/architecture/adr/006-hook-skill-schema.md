# ADR-006: GitHub Copilot Hook & Skill Schema

## Status
Accepted (partially superseded)

> **Note:** Hook execution order has been updated by ADR-037 — hooks now execute in parallel via `Promise.allSettled` within batches, not sequentially as originally specified. The `preCompact` event (9th event) was added by ADR-026.

## Context
Extensions inject behavior into AI agent workflows via hooks (triggered on events) and skills (contextual capabilities). We need to decide the schema format for both.

Options considered:
1. **Custom schema** — design our own hook/skill format
2. **GitHub Copilot compatible** — follow GitHub's existing schemas
3. **Multi-agent support** — abstract format that maps to multiple AI agents

## Decision
**Follow GitHub Copilot's hook and skill schemas.** Hooks are placed in `.github/hooks/` and skills in `.github/skills/`. This ensures compatibility with GitHub Copilot out of the box and provides a well-documented standard.

### Hook Schema (`.github/hooks/renre-kit.json`)
**Single merged file** (ADR-037). All hooks — core RenRe Kit features and extension features — live in one file. Each event has an array of commands with unique **feature** identifiers routed through the worker service.

**Hook commands route through the worker service** via `worker-service.cjs hook <agent> <feature>`. Core features have no prefix. Extension features use `{ext-name}:{action}` convention.

```json
{
  "version": 1,
  "hooks": {
    "sessionStart": [
      {
        "type": "command",
        "bash": "node \"${RENRE_KIT_ROOT}/scripts/worker-service.cjs\" hook copilot context-inject",
        "cwd": ".",
        "timeoutSec": 10,
        "comment": "renre-kit core: session memory + context recipes"
      },
      {
        "type": "command",
        "bash": "node \"${RENRE_KIT_ROOT}/scripts/worker-service.cjs\" hook copilot jira:session-init",
        "cwd": ".",
        "timeoutSec": 5,
        "comment": "jira-plugin: inject open issues"
      }
    ],
    "preToolUse": [
      {
        "type": "command",
        "bash": "node \"${RENRE_KIT_ROOT}/scripts/worker-service.cjs\" hook copilot tool-governance",
        "cwd": ".",
        "timeoutSec": 3,
        "comment": "renre-kit core: tool governance rules"
      }
    ]
  }
}
```

### Hook Command Format
```
node "${RENRE_KIT_ROOT}/scripts/worker-service.cjs" hook <agent> <feature>
```
- `${RENRE_KIT_ROOT}` — resolved to `~/.renre-kit/` at install time
- `<agent>` — AI agent type (e.g., `copilot`, `claude-code`)
- `<feature>` — feature ID: core features have no prefix (`context-inject`, `tool-governance`), extension features use `{ext-name}:{action}` (`jira:session-init`)

The worker-service.cjs script enqueues the request to the worker's **Hook Request Queue** (ADR-037). The queue batches requests from the same event, processes all features in parallel, and returns cached results to subsequent callers.

### Hook Properties
| Property | Type | Description |
|----------|------|-------------|
| `version` | number | Schema version (currently `1`) |
| `hooks` | object | Map of event name to array of hook definitions |
| `type` | string | Hook type (`"command"`) |
| `bash` | string | Shell command or script path to execute |
| `cwd` | string | Working directory for the command |
| `env` | object | Environment variables to inject |
| `timeoutSec` | number | Execution timeout in seconds |

### Supported Events

See **ADR-026** for comprehensive documentation of all 8 events with input/output schemas.

| Event | Trigger | Can Block? |
|-------|---------|------------|
| `sessionStart` | AI agent session begins or resumes | No |
| `sessionEnd` / `Stop` | AI agent session completes or terminates | Yes |
| `userPromptSubmitted` | User submits a prompt to AI agent | No |
| `preToolUse` | Before agent executes any tool (bash, edit, view, create) | **Yes** (deny/allow/ask) |
| `postToolUse` | After tool completes execution | No |
| `errorOccurred` | Error during agent execution | No |
| `subagentStart` | Nested subagent spawned | No |
| `subagentStop` | Subagent completes before returning results | Yes |

### Hook Execution Order
When multiple extensions register hooks for the same event:
1. Hooks execute **sequentially** in extension installation order (as listed in `.renre-kit/extensions.json`)
2. Each hook is **isolated** — one hook failure does not block subsequent hooks
3. Failed hooks log an error but do not prevent the event from completing
4. Timeout enforcement is per-hook (`timeoutSec`) — a slow hook does not consume other hooks' time budget

### Skill Schema (`.github/skills/{skill-name}/SKILL.md`)
Standard markdown-based skill definition:
```markdown
# Skill Name

## Description
What this skill does.

## Instructions
How the AI agent should use this skill.
```

## Consequences

### Positive
- Zero learning curve for GitHub Copilot users
- Extensions automatically work with Copilot without extra configuration
- Well-documented schema maintained by GitHub
- Hooks use CLI commands — agent-agnostic execution

### Negative
- Tied to GitHub's schema evolution — breaking changes possible
- May not cover all RenRe Kit use cases (limited event types)
- Other AI agents (Claude Code, Cursor) may need adapters

### Mitigations
- RenRe Kit CLI is the hook command target — abstracts the worker service
- Future: adapter layer to generate hooks for other AI agent formats
- Pin to a specific schema version in extension manifest
