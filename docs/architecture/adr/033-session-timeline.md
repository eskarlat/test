# ADR-033: Session Timeline — Unified Event View

## Status
Accepted

## Context
During a coding session, many things happen: prompts submitted, tools used, errors encountered, subagents spawned. These events are captured by individual hook systems (ADR-027 through ADR-032), but there's no unified view showing the chronological story of a session. Developers need a timeline to understand what happened, debug agent behavior, and review session productivity.

## Decision

### Core Feature: Session Timeline
A unified chronological view combining all hook events for a session into a rich, interactive timeline in Console UI. Data comes from existing tables — no new storage needed, just a composite API and UI component.

### Data Sources

```mermaid
flowchart LR
    subgraph Existing Tables
        A[_sessions]
        B[_prompts]
        C[_tool_usage]
        D[_tool_audit]
        E[_agent_errors]
        F[_hook_activity]
        G[_subagent_events]
    end

    subgraph Timeline API
        H[GET /api/{pid}/sessions/:id/timeline]
    end

    subgraph Console UI
        I[SessionTimeline Component]
    end

    A --> H
    B --> H
    C --> H
    D --> H
    E --> H
    F --> H
    G --> H
    H --> I
```

### Timeline Event Types

| Icon | Type | Source | Description |
|------|------|--------|-------------|
| ● | `session-start` | _sessions | Session began |
| ● | `session-end` | _sessions | Session ended (with reason) |
| 💬 | `prompt` | _prompts | User submitted a prompt |
| 🔧 | `tool-use` | _tool_usage | Tool executed (with result) |
| ✗ | `tool-denied` | _tool_audit | Tool blocked by governance rule |
| ❌ | `error` | _agent_errors | Error occurred |
| 🔀 | `subagent-start` | _subagent_events | Subagent spawned |
| 🔀 | `subagent-end` | _subagent_events | Subagent completed |
| 📎 | `hook-executed` | _hook_activity | Extension hook ran |
| ⚠ | `warning` | _tool_usage (patterns) | Pattern warning (thrashing, loop) |
| 💡 | `context-injected` | _sessions | Context was injected (at session start) |
| 📋 | `checkpoint` | _session_checkpoints | Mid-session checkpoint (before compaction) |

### Timeline Assembly

The timeline API merges events from all tables, sorted by timestamp:

```typescript
interface TimelineEvent {
  id: string;
  timestamp: string;
  type: 'session-start' | 'session-end' | 'prompt' | 'tool-use' |
        'tool-denied' | 'error' | 'subagent-start' | 'subagent-end' |
        'hook-executed' | 'warning' | 'context-injected' | 'checkpoint';
  data: Record<string, unknown>;  // Type-specific payload
  icon: string;
  summary: string;                // One-line description
  expandable: boolean;            // Has detail view
}
```

### Console UI — Session Timeline

```
┌─ Session Timeline ─────────────────────────────────────────┐
│                                                             │
│  Session: session-abc │ Agent: Copilot │ Duration: 45 min   │
│  Status: ended (complete) │ 8 prompts │ 34 tools │ 2 errors│
│                                                             │
│  Filter: [All ▼]  │  Show: ☑ prompts ☑ tools ☑ errors      │
│                     ☑ subagents ☑ hooks ☐ views-only        │
│                                                             │
│  14:00 ● Session started                                    │
│         │  Agent: Copilot │ Source: new                      │
│         │                                                   │
│  14:00 💡 Context injected                                  │
│         │  3 previous sessions, 5 observations,             │
│         │  2 git commits, 1 recurring error warning         │
│         │  [Expand to see full context →]                   │
│         │                                                   │
│  14:01 💬 "Fix the login bug in auth.ts"                    │
│         │  Intent: bug-fix                                  │
│         │  Extension context: Jira PROJ-123 injected        │
│         │                                                   │
│  14:02 🔧 view src/auth.ts                            ✓     │
│  14:02 🔧 view src/auth.test.ts                       ✓     │
│         │                                                   │
│  14:03 🔧 edit src/auth.ts (lines 45-60)              ✓     │
│         │  [View diff →]                                    │
│         │                                                   │
│  14:04 🔧 bash: pnpm test                             ✗     │
│         │  Exit code 1: 2 tests failed                      │
│         │  [View output →]                                  │
│         │                                                   │
│  14:04 ❌ Error: Test assertion failed                       │
│         │  expected 200, received 401                        │
│         │  Pattern: seen 2 times before                     │
│         │  [View error details →]                           │
│         │                                                   │
│  14:05 💬 "The test for validateToken is failing"           │
│         │  Intent: debug                                    │
│         │                                                   │
│  14:06 🔀 Subagent spawned: Explore                        │
│  14:06 │  🔧 view src/auth.ts                         ✓     │
│  14:06 │  🔧 view src/types/auth.ts                   ✓     │
│  14:06 🔀 Subagent completed (4s)                          │
│         │                                                   │
│  14:07 🔧 edit src/auth.ts (lines 48-52)              ✓     │
│         │  ⚠ auth.ts edited 2nd time this session           │
│         │  [View diff →]                                    │
│         │                                                   │
│  14:07 🔧 edit src/auth.test.ts (lines 20-30)         ✓     │
│         │                                                   │
│  14:08 🔧 bash: pnpm test                             ✓     │
│         │  All 42 tests passed                              │
│         │                                                   │
│  14:08 📎 Hook: postToolUse (jira-plugin)  45ms  ✓          │
│         │  Updated PROJ-123 status                          │
│         │                                                   │
│  14:09 🔧 bash: git push origin main                  ?     │
│         │  Governance: "Confirm before pushing" → Approved   │
│         │  ✓ Pushed to remote                               │
│         │                                                   │
│  14:10 ● Session ended (complete)                           │
│         │  Summary: Fixed login bug, 2 files changed        │
│         │  Observation saved: "validateToken needs null..."  │
│         │                                                   │
│  ──────────────────────────────────────────────────────     │
│  Session Outcome:                                           │
│  Files modified: src/auth.ts, src/auth.test.ts              │
│  Tools: 34 total (29 ✓, 3 ✗, 2 denied)                     │
│  Errors: 2 (1 resolved in session)                          │
│  Observations created: 1                                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Subagent Nesting

Subagent events are indented and grouped within the timeline:

```mermaid
flowchart TB
    subgraph Main Agent Session
        A[14:05 💬 Prompt: "investigate auth flow"]
        B[14:06 🔀 Subagent: Explore]
        subgraph Subagent: Explore
            C[14:06 🔧 view auth.ts]
            D[14:06 🔧 view types.ts]
            E[14:06 🔧 grep "validateToken"]
        end
        F[14:06 🔀 Subagent completed]
        G[14:07 🔧 edit auth.ts]
    end

    A --> B
    B --> C
    C --> D
    D --> E
    E --> F
    F --> G
```

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `GET /api/{pid}/sessions/:id/timeline` | GET | Unified timeline events (paginated, cursor-based) |
| `GET /api/{pid}/sessions/:id/timeline?types=prompt,tool-use` | GET | Filtered by event type |
| `GET /api/{pid}/sessions/:id/summary` | GET | Session summary stats |

### Timeline Response Format

```json
{
  "session": {
    "id": "session-abc",
    "agent": "copilot",
    "startedAt": "2026-03-07T14:00:00Z",
    "endedAt": "2026-03-07T14:10:00Z",
    "status": "ended",
    "stats": {
      "promptCount": 8,
      "toolCount": 34,
      "errorCount": 2,
      "subagentCount": 1,
      "filesModified": ["src/auth.ts", "src/auth.test.ts"]
    }
  },
  "events": [
    {
      "id": "evt-001",
      "timestamp": "2026-03-07T14:00:00Z",
      "type": "session-start",
      "summary": "Session started",
      "expandable": true,
      "data": { "source": "new", "contextInjected": true }
    },
    {
      "id": "evt-002",
      "timestamp": "2026-03-07T14:01:00Z",
      "type": "prompt",
      "summary": "Fix the login bug in auth.ts",
      "expandable": true,
      "data": { "intent": "bug-fix", "contextProvided": ["jira-plugin: PROJ-123"] }
    }
  ],
  "cursor": "evt-034"
}
```

## Consequences

### Positive
- Single place to understand everything that happened in a session
- Subagent nesting makes complex agent behavior visible
- Filters allow focusing on specific event types
- Pattern warnings inline show exactly when issues occurred
- Session outcome summary provides quick retrospective
- No new storage — aggregates existing data

### Negative
- Composite query joins multiple tables — could be slow for long sessions
- UI rendering many events needs virtualization
- Timeline is read-only (no time-travel/replay yet)

### Mitigations
- Cursor-based pagination: load events in chunks of 50
- Virtual scrolling for long timelines (react-virtual)
- Database indices on session_id + timestamp already exist
- Filters reduce rendered event count
