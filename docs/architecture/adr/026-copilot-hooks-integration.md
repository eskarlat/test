# ADR-026: GitHub Copilot Hooks — Complete Integration via Worker Service

## Status
Accepted (supersedes hook event list in ADR-006)

## Context
ADR-006 established that RenRe Kit follows the GitHub Copilot hook schema and routes all hook commands through `worker-service.cjs`. However, it only documented 3 events (`sessionStart`, `sessionEnd`, `userPromptSubmitted`). GitHub Copilot and VS Code agent mode now support **8 hook events** with rich JSON input/output contracts. We need to document the full event catalog and how each integrates with the worker service.

### How Copilot Hooks Work

GitHub Copilot hooks are JSON configuration files stored in `.github/hooks/*.json`. When an AI agent (Copilot, Claude Code, etc.) fires a lifecycle event, it:

1. Reads all `.json` files in `.github/hooks/`
2. Finds hooks matching the event name
3. Executes each hook's shell command **synchronously** (blocks agent execution)
4. Pipes event context as **JSON via stdin**
5. Reads hook response from **stdout** (for hooks that support output)
6. Interprets exit codes: `0` = success, `2` = blocking error, other = non-blocking warning

Hooks are deterministic and code-driven — unlike instructions/prompts, they **cannot be bypassed** through prompt injection. This makes them ideal for security policies, audit trails, and context injection.

## Decision

### Complete Hook Event Catalog

RenRe Kit supports all 9 hook events. Each event routes through `worker-service.cjs` which forwards to the running worker service at `POST /api/hooks/enqueue`.

---

#### 1. `sessionStart`

**When**: New agent session begins or existing session resumes.

**Use in RenRe Kit**: Create session record, initialize extension state, inject project context.

**Input (stdin)**:
```json
{
  "timestamp": 1704614400000,
  "cwd": "/path/to/project",
  "source": "new|resume|startup",
  "initialPrompt": "Fix the login bug",
  "sessionId": "session-abc-123",
  "hookEventName": "SessionStart"
}
```

**Output (stdout)**: Optional — can inject additional context.
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Project uses React 19 with TypeScript strict mode. 3 extensions active."
  }
}
```

**Worker service action**:
- Create session in `~/.renre-kit/sessions/{id}.json`
- Record `{ id, projectId, startedAt, agent, status: "active" }`
- Execute each extension's `sessionStart` handler
- Return aggregated context from all extensions

---

#### 2. `sessionEnd` / `Stop`

**When**: Agent session completes, is terminated, or user exits.

**Use in RenRe Kit**: Finalize session, cleanup temporary resources, generate session report.

**Input (stdin)**:
```json
{
  "timestamp": 1704618000000,
  "cwd": "/path/to/project",
  "reason": "complete|error|abort|timeout|user_exit",
  "sessionId": "session-abc-123",
  "hookEventName": "Stop"
}
```

**Output (stdout)**: Can block session end (request more work).
```json
{
  "hookSpecificOutput": {
    "hookEventName": "Stop",
    "decision": "block",
    "reason": "Tests haven't been run yet. Please run the test suite before ending."
  }
}
```

**Worker service action**:
- Update session: `{ endedAt, status: "ended", reason }`
- Execute each extension's `sessionEnd` handler
- Aggregate results — if any extension blocks, return block decision

---

#### 3. `userPromptSubmitted` / `UserPromptSubmit`

**When**: User submits a prompt to the AI agent.

**Use in RenRe Kit**: Audit logging, inject extension-specific context, usage analytics.

**Input (stdin)**:
```json
{
  "timestamp": 1704614500000,
  "cwd": "/path/to/project",
  "prompt": "Add error handling to the API endpoints",
  "sessionId": "session-abc-123",
  "hookEventName": "UserPromptSubmit"
}
```

**Output (stdout)**: Can inject additional context for the agent.
```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Extension jira-plugin: Related Jira issues: PROJ-123, PROJ-456"
  }
}
```

**Worker service action**:
- Log prompt for audit trail (if extension opts in)
- Execute each extension's `userPromptSubmitted` handler
- Extensions can query their data and return relevant context
- Return aggregated context from all extensions

---

#### 4. `preToolUse` / `PreToolUse`

**When**: Before the agent executes any tool (bash, edit, view, create file).

**Use in RenRe Kit**: Security policies, command validation, approval workflows.

**Input (stdin)**:
```json
{
  "timestamp": 1704614600000,
  "cwd": "/path/to/project",
  "toolName": "bash",
  "toolArgs": "{\"command\":\"rm -rf dist\",\"description\":\"Clean build directory\"}",
  "tool_use_id": "tool-789",
  "sessionId": "session-abc-123",
  "hookEventName": "PreToolUse"
}
```

**Tool names**: `bash`, `edit`, `view`, `create`, `editFiles`, `runTerminalCommand`, etc.

**Output (stdout)**: Can approve, deny, or modify tool execution.
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "allow|deny|ask",
    "permissionDecisionReason": "Destructive rm -rf commands require manual approval",
    "updatedInput": {},
    "additionalContext": "Extension security-guard: This command modifies production files"
  }
}
```

**Permission decisions**:
| Decision | Effect |
|----------|--------|
| `allow` | Tool executes normally |
| `deny` | Tool is blocked, reason shown to agent |
| `ask` | User prompted for manual approval |

**Worker service action**:
- Execute each extension's `preToolUse` handler with tool context
- If **any** extension returns `deny` → aggregate as deny (most restrictive wins)
- Log tool usage attempt for audit
- Return aggregated decision

---

#### 5. `postToolUse` / `PostToolUse`

**When**: After a tool completes execution (success or failure).

**Use in RenRe Kit**: Run formatters, trigger follow-up actions, track tool usage metrics.

**Input (stdin)**:
```json
{
  "timestamp": 1704614700000,
  "cwd": "/path/to/project",
  "toolName": "bash",
  "toolArgs": "{\"command\":\"npm test\"}",
  "tool_use_id": "tool-789",
  "toolResult": {
    "resultType": "success|failure|denied",
    "textResultForLlm": "All 42 tests passed"
  },
  "sessionId": "session-abc-123",
  "hookEventName": "PostToolUse"
}
```

**Output (stdout)**: Can inject additional context.
```json
{
  "hookSpecificOutput": {
    "hookEventName": "PostToolUse",
    "additionalContext": "Extension coverage-tracker: Code coverage dropped from 85% to 82%"
  }
}
```

**Worker service action**:
- Execute each extension's `postToolUse` handler
- Extensions can analyze tool results and provide feedback
- Log tool result for audit and metrics
- Return aggregated context

---

#### 6. `errorOccurred`

**When**: An error occurs during agent execution.

**Use in RenRe Kit**: Error tracking, notifications, pattern detection.

**Input (stdin)**:
```json
{
  "timestamp": 1704614800000,
  "cwd": "/path/to/project",
  "error": {
    "message": "ENOENT: no such file or directory",
    "name": "Error",
    "stack": "Error: ENOENT..."
  },
  "sessionId": "session-abc-123",
  "hookEventName": "errorOccurred"
}
```

**Output (stdout)**: Ignored.

**Worker service action**:
- Log error with full context
- Execute each extension's `errorOccurred` handler
- Extensions can send notifications (Slack, email) or track error patterns

---

#### 7. `subagentStart` / `SubagentStart`

**When**: A subagent (nested agent) is spawned by the main agent.

**Use in RenRe Kit**: Track nested agent activity, inject guidelines.

**Input (stdin)**:
```json
{
  "timestamp": 1704614900000,
  "cwd": "/path/to/project",
  "agent_id": "subagent-456",
  "agent_type": "Plan|Explore|general-purpose",
  "sessionId": "session-abc-123",
  "hookEventName": "SubagentStart"
}
```

**Output (stdout)**: Can inject guidelines for the subagent.
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStart",
    "additionalContext": "Extension code-standards: Follow project coding standards in CONTRIBUTING.md"
  }
}
```

**Worker service action**:
- Log subagent spawn
- Execute each extension's `subagentStart` handler
- Return aggregated guidelines/context

---

#### 8. `preCompact` / `PreCompact`

**When**: Before the AI agent compacts (summarizes) its conversation context to free up token space. Fired when the context window is nearly full (`auto`) or when the user manually triggers compaction (`manual`).

**Use in RenRe Kit**: Capture a mid-session checkpoint — snapshot current session state before context is lost to compaction. This enables session continuity even within a single long session.

**Input (stdin)**:
```json
{
  "timestamp": 1704615100000,
  "cwd": "/path/to/project",
  "trigger": "auto|manual",
  "custom_instructions": "Focus on the authentication changes",
  "sessionId": "session-abc-123",
  "transcript_path": "/path/to/transcript.jsonl",
  "hookEventName": "PreCompact"
}
```

| Field | Description |
|-------|-------------|
| `trigger` | `"auto"` when context window is full, `"manual"` when user triggers |
| `custom_instructions` | Optional user instructions for manual compaction focus (e.g., "Focus on auth changes") |
| `transcript_path` | Path to the session transcript file (may be empty) |

**How RenRe Kit uses `custom_instructions`**: When the user provides compaction focus instructions, RenRe Kit incorporates them into the checkpoint summary and compaction guidance. For example, if the user says "Focus on the authentication changes", the checkpoint will prioritize auth-related files and decisions, and the guidance will instruct the agent to preserve auth context above other work.

**Output (stdout)**: Common fields + `systemMessage` for compaction guidance.
```json
{
  "continue": true,
  "systemMessage": "## Compaction Guidance (from RenRe Kit)\n\nWhen compacting this conversation, preserve the following:\n\n### Must Preserve\n- File paths and their current state\n- Key decisions made and their rationale\n- Active task/goal and current progress\n- Error patterns encountered and resolutions\n- Test results (passing/failing)\n\n### Project-Specific Notes\n- Observations: \"Project uses pnpm\", \"Auth tokens expire after 1h\"\n- Active error patterns: ECONNREFUSED on port 5432 (seen 5×)\n- Current progress: fixed auth.ts, 3 tests updated"
}
```

**Worker service action**:
- Create a **session checkpoint** in `_session_checkpoints` table (ADR-027)
- Snapshot current session stats: prompts so far, tools used, files modified, errors
- Generate a compact summary of work done since last checkpoint (or session start)
- **Assemble compaction guidance** — static best practices + dynamic project context (observations, error patterns, tool governance rules, current progress)
- Record compaction event in session timeline (ADR-033)
- Execute each extension's `preCompact` handler (extensions can save their own state)
- Extensions can use `transcript_path` to analyze conversation if available
- Return `systemMessage` with assembled guidance so the agent preserves important context during compaction

---

#### 9. `subagentStop` / `SubagentStop`

**When**: A subagent completes and before results are returned to the parent agent.

**Use in RenRe Kit**: Validate subagent results, aggregate data, cleanup.

**Input (stdin)**:
```json
{
  "timestamp": 1704615000000,
  "cwd": "/path/to/project",
  "agent_id": "subagent-456",
  "agent_type": "Plan",
  "stop_hook_active": false,
  "sessionId": "session-abc-123",
  "hookEventName": "SubagentStop"
}
```

**Output (stdout)**: Can block subagent completion.
```json
{
  "hookSpecificOutput": {
    "hookEventName": "SubagentStop",
    "decision": "block",
    "reason": "Subagent plan does not include test coverage"
  }
}
```

**Worker service action**:
- Log subagent completion
- Execute each extension's `subagentStop` handler
- Return aggregated decision

---

### Hook Event Summary

| # | Hook Event (PascalCase) | Internal Event | Output (`hookSpecificOutput`) | Can Block? |
|---|------------------------|----------------|-------------------------------|------------|
| 1 | `SessionStart` | `sessionStart` | additionalContext | No |
| 2 | `Stop` | `sessionEnd` | decision (block/allow) | Yes |
| 3 | `UserPromptSubmit` | `userPromptSubmitted` | additionalContext | No |
| 4 | `PreToolUse` | `preToolUse` | permissionDecision (allow/deny/ask) | **Yes** |
| 5 | `PostToolUse` | `postToolUse` | additionalContext | No |
| 6 | `ErrorOccurred` | `errorOccurred` | — | No |
| 7 | `SubagentStart` | `subagentStart` | additionalContext | No |
| 8 | `PreCompact` | `preCompact` | common fields only (top-level) | No |
| 9 | `SubagentStop` | `subagentStop` | decision (block/allow) | Yes |

---

### How worker-service.cjs Bridges Hooks to Worker Service

```
┌─────────────────┐    stdin (JSON)     ┌─────────────────────┐
│                  │ ──────────────────→ │                     │
│   AI Agent       │                     │  worker-service.cjs │
│  (Copilot/Claude)│ ←────────────────── │                     │
│                  │   stdout (JSON)     │                     │
└─────────────────┘                     └──────────┬──────────┘
                                                   │
                                          HTTP POST│
                                                   │
                                        ┌──────────▼──────────┐
                                        │                     │
                                        │   Worker Service    │
                                        │  POST /api/hooks/   │
                                        │       execute       │
                                        │                     │
                                        │  ┌───────────────┐  │
                                        │  │ Extension A    │  │
                                        │  │ hook handler   │  │
                                        │  └───────┬───────┘  │
                                        │          ▼          │
                                        │  ┌───────────────┐  │
                                        │  │ Extension B    │  │
                                        │  │ hook handler   │  │
                                        │  └───────┬───────┘  │
                                        │          ▼          │
                                        │  Aggregated result  │
                                        └─────────────────────┘
```

#### worker-service.cjs Lifecycle

```bash
# AI agent executes this command (from .github/hooks/renre-kit.json):
node /Users/dev/.renre-kit/scripts/worker-service.cjs hook agent preToolUse tool-governance
```

**Step-by-step**:

1. **Parse args**: `hook <agent> <event> <feature>` (ADR-046)
   - `agent` = `copilot` | `claude-code` | `cursor` | etc.
   - `event` = `sessionStart` | `sessionEnd` | `userPromptSubmitted` | `preToolUse` | `postToolUse` | `errorOccurred` | `preCompact` | `subagentStart` | `subagentStop`
   - `feature` = core feature or `extensionName:featureName`

2. **Read stdin**: Parse JSON input from the AI agent (event context)

3. **Read server info**: Load `~/.renre-kit/server.json` to get worker port

4. **Resolve project**: Determine project ID from `cwd` (match against registered projects)

5. **POST to worker**: Send request to running worker service
   ```
   POST http://localhost:42888/api/hooks/enqueue
   Content-Type: application/json

   {
     "batchId": "a1b2c3d4e5f67890",
     "feature": "tool-governance",
     "event": "preToolUse",
     "projectId": "proj-abc",
     "agent": "agent",
     "input": { ... stdin JSON ... }
   }
   ```

6. **Worker executes hooks**: Iterates extensions in installation order, calls each extension's handler for this event

7. **Format response**: Wrap feature output in VS Code Agent hooks envelope:
   - Common fields (`continue`, `stopReason`, `systemMessage`) stay at top level
   - All other fields wrapped in `hookSpecificOutput` with `hookEventName`

8. **Return response**: Write formatted JSON to stdout for the AI agent to consume

9. **Exit**: Code `0` on success, `1` on failure, `2` on blocking error

#### Timeout Handling

- `worker-service.cjs` respects `timeoutSec` from hook config
- If worker service doesn't respond within timeout: exit with code 1, log warning
- If worker service is not running: exit with code 0 silently (hooks should not break agent workflow when RenRe Kit is down)

---

### Generated Hook File Example

> **Note**: ADR-037 supersedes per-extension file generation. RenRe Kit generates a **single merged file** `.github/hooks/renre-kit.json` with core + extension features per event. The example below shows the merged format.

When extensions are installed, RenRe Kit regenerates `.github/hooks/renre-kit.json`:

```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "node /Users/dev/.renre-kit/scripts/worker-service.cjs hook agent sessionStart context-inject"
      }
    ],
    "Stop": [
      {
        "type": "command",
        "command": "node /Users/dev/.renre-kit/scripts/worker-service.cjs hook agent sessionEnd session-capture"
      }
    ],
    "UserPromptSubmit": [
      {
        "type": "command",
        "command": "node /Users/dev/.renre-kit/scripts/worker-service.cjs hook agent userPromptSubmitted prompt-journal"
      }
    ],
    "PreToolUse": [
      {
        "type": "command",
        "command": "node /Users/dev/.renre-kit/scripts/worker-service.cjs hook agent preToolUse tool-governance"
      }
    ],
    "PostToolUse": [
      {
        "type": "command",
        "command": "node /Users/dev/.renre-kit/scripts/worker-service.cjs hook agent postToolUse tool-analytics"
      }
    ],
    "ErrorOccurred": [
      {
        "type": "command",
        "command": "node /Users/dev/.renre-kit/scripts/worker-service.cjs hook agent errorOccurred error-intelligence"
      }
    ],
    "PreCompact": [
      {
        "type": "command",
        "command": "node /Users/dev/.renre-kit/scripts/worker-service.cjs hook agent preCompact session-checkpoint"
      }
    ],
    "SubagentStart": [
      {
        "type": "command",
        "command": "node /Users/dev/.renre-kit/scripts/worker-service.cjs hook agent subagentStart subagent-track"
      }
    ],
    "SubagentStop": [
      {
        "type": "command",
        "command": "node /Users/dev/.renre-kit/scripts/worker-service.cjs hook agent subagentStop subagent-complete"
      }
    ]
  }
}
```

**Note**: Only events declared in the extension's manifest `hooks` array are included in the generated file. Extensions opt in to specific events — not all 8 are required.

### Extension Manifest — Hook Feature Declaration

Extensions declare hook **features** in `manifest.json` (ADR-037). Each feature maps to a specific event and handler route:

```json
{
  "name": "jira-plugin",
  "hooks": {
    "features": [
      {
        "event": "sessionStart",
        "feature": "session-init",
        "description": "Create session tracking and inject open issues",
        "timeoutSec": 5
      },
      {
        "event": "preToolUse",
        "feature": "tool-check",
        "description": "Validate database operations",
        "timeoutSec": 3
      }
    ]
  }
}
```

Only listed features get generated into the merged `.github/hooks/renre-kit.json` file as `{ext-name}:{feature}` commands.

### Extension Backend — Hook Feature Handlers

Extensions implement hook features as `/__hooks/{feature}` routes. The feature name in the route matches the `feature` field from the manifest:

```typescript
const factory: ExtensionRouterFactory = (ctx) => {
  const router = Router();

  // Standard routes
  router.get("/issues", (req, res) => { /* ... */ });

  // Hook feature: session-init (called via jira:session-init)
  router.post("/__hooks/session-init", (req, res) => {
    const { input } = req.body; // stdin JSON from AI agent
    ctx.db!.prepare(
      "INSERT INTO jira_sessions (project_id, session_id, started_at) VALUES (?, ?, ?)"
    ).run(ctx.projectId, input.sessionId, new Date().toISOString());

    res.json({
      additionalContext: "Jira: 3 open issues assigned to you (PROJ-101, PROJ-102, PROJ-103)"
    });
  });

  // Hook feature: tool-check (called via jira:tool-check)
  router.post("/__hooks/tool-check", (req, res) => {
    const { input } = req.body;
    if (input.toolName === "bash" && input.toolArgs?.includes("DROP TABLE")) {
      res.json({
        permissionDecision: "deny",
        permissionDecisionReason: "Direct database modifications are not allowed"
      });
      return;
    }
    res.json({ permissionDecision: "allow" });
  });

  return router;
};
```

## Consequences

### Positive
- Full coverage of all 9 Copilot hook events — no gaps
- `preToolUse` enables powerful security policies (deny dangerous commands)
- `postToolUse` enables quality gates (run linters after edits)
- `preCompact` enables mid-session checkpoints — preserves context across compaction
- `subagentStart/Stop` gives visibility into nested agent activity
- Worker service centralization means extensions don't ship shell scripts
- Same hook files work with Copilot, Claude Code (via `.claude/settings.json`), and future agents
- Graceful degradation — hooks silently succeed when worker is not running

### Negative
- 9 hooks per extension means up to 9 HTTP calls per event with many extensions
- `preToolUse` is called frequently (every tool use) — must be fast
- Stdin/stdout JSON serialization adds latency vs in-process hooks
- Different agents may use slightly different event names (need mapping)

### Mitigations
- Hook execution is sequential but fast — HTTP to localhost is sub-millisecond
- Extensions only declare events they need — most won't use all 9
- `preToolUse` handlers should be lightweight (simple rule checks, no DB queries)
- `worker-service.cjs` maps agent-specific event names to canonical names
- Timeout enforcement prevents slow hooks from blocking agent workflow
- Connection failure handling: exit 0 silently when worker is down

## References
- [GitHub Docs: Hooks Configuration](https://docs.github.com/en/copilot/reference/hooks-configuration)
- [GitHub Docs: About Hooks](https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-hooks)
- [GitHub Docs: Using Hooks with Copilot Agents](https://docs.github.com/en/copilot/how-tos/use-copilot-agents/coding-agent/use-hooks)
- [VS Code: Agent Hooks](https://code.visualstudio.com/docs/copilot/customization/hooks)
- [awesome-copilot: Hooks Reference](https://github.com/github/awesome-copilot/blob/main/docs/README.hooks.md)
- ADR-006: Hook & Skill Schema (basic schema)
- ADR-008: Phase 8 — Hooks & Skills (implementation plan)
