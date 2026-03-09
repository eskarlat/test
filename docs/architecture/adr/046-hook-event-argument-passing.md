# ADR-046: Hook Event Argument Passing

## Status
Accepted (amends ADR-037)

## Context

### The Problem

The GitHub Copilot hook schema groups commands by event name:

```json
{
  "hooks": {
    "SessionStart": [
      { "type": "command", "command": "node ~/.renre-kit/scripts/worker-service.cjs hook agent context-inject" }
    ]
  }
}
```

When Claude Code (or any Copilot-compatible agent) triggers a hook, it runs the command but **does not pass the event name** to the command. The stdin JSON from the agent may or may not contain an `event` field — this is not guaranteed by the Copilot hook specification.

Our `worker-service.cjs` hook entry point receives the feature ID as a CLI argument (e.g., `context-inject`) but needs the **event name** (e.g., `sessionStart`) to send to the enqueue API. The server uses the event to look up all registered features for that event and process them as a batch.

### What Broke

Without the event, the script fell back to using the feature ID as the event name:

```javascript
const event = input.event || feature;  // "context-inject" is NOT an event
```

The server called `listByEvent("context-inject")` which returned zero features (the registry maps `context-inject` to event `sessionStart`). The batch had nothing to execute, `waitForResult` polled for 5 seconds, and timed out — resulting in `success: false`.

### Why a Static Map Doesn't Work

A hardcoded `FEATURE_TO_EVENT` map in `worker-service.cjs` works for the 9 core features but **breaks for extensions**. Extension features (e.g., `jira:session-init`, `github-mcp:session-init`) are dynamic — installed at runtime. The entry point script cannot know about them ahead of time.

### Options Considered

| Option | Description | Pros | Cons |
|--------|-------------|------|------|
| **A. Embed event in command args** | Add event as CLI arg at hook file generation time | Zero overhead, works for all features, no extra files or API calls | Existing hook files need regeneration |
| B. Server-side resolution | Remove event from enqueue request, let server resolve from registry | Script stays simple | Changes API contract, batch grouping breaks if feature isn't registered |
| C. Query server for mapping | Script calls `GET /api/hooks/features` before enqueue | Always up to date | Extra HTTP round-trip per hook invocation |
| D. Local mapping file | Write `~/.renre-kit/feature-event-map.json` alongside hooks | No network overhead | Extra file to keep in sync, stale data risk |

## Decision

**Option A: Embed the event name as a CLI argument in the generated hook command.**

The event name is already known at hook file generation time — it is literally the key in the hooks JSON object. Pass it as an additional argument to `worker-service.cjs`.

### Command Format Change

Before:
```
node ~/.renre-kit/scripts/worker-service.cjs hook agent <feature>
```

After:
```
node ~/.renre-kit/scripts/worker-service.cjs hook agent <event> <feature>
```

Where `<event>` is the internal camelCase event name (e.g., `sessionStart`, `preToolUse`). The event comes before the feature because it is the primary routing key.

### Generated Hook File Example

```json
{
  "hooks": {
    "SessionStart": [
      {
        "type": "command",
        "command": "node /Users/dev/.renre-kit/scripts/worker-service.cjs hook agent sessionStart context-inject"
      },
      {
        "type": "command",
        "command": "node /Users/dev/.renre-kit/scripts/worker-service.cjs hook agent sessionStart jira:session-init"
      }
    ],
    "PreToolUse": [
      {
        "type": "command",
        "command": "node /Users/dev/.renre-kit/scripts/worker-service.cjs hook agent preToolUse tool-governance"
      }
    ]
  }
}
```

### Script Event Resolution

```javascript
const eventArg = args[2]; // Event from CLI argument (primary routing key)
const feature = args[3];  // Feature ID

// Event normalization via EVENT_MAP (PascalCase → camelCase)
const event = EVENT_MAP[eventArg] || eventArg;
```

### Affected Components

| Component | Change |
|-----------|--------|
| `worker-service.cjs` | Accept 4th arg as event, use as primary event source |
| `cli/hook-file-generator.ts` | Append event name to generated commands |
| `worker-service/hook-file-generator.ts` | Append event name to generated commands |
| `worker-service/routes/marketplace.ts` | Append event name to generated commands |

### Hook File Regeneration

Existing hook files (generated before this change) will not have the event argument. The script handles this gracefully:

- If `args[3]` exists: use it (new format)
- If `args[3]` is missing: fall back to `input.event` from stdin, then feature name
- Running `renre-kit init` or installing/removing any extension regenerates the hook file with the new format

## Consequences

### Positive
- Works for both core and extension features with zero runtime overhead
- No extra network calls, no extra files to maintain
- Event is baked into the command at generation time — always correct
- Backwards compatible: missing 4th arg falls back gracefully

### Negative
- Existing hook files must be regenerated (happens automatically on next `init`, extension install/remove, or `POST /api/hooks/regenerate`)
- Event name appears in two places (JSON key and command arg) — minor redundancy, but the JSON key uses PascalCase while the arg uses camelCase

### Relation to ADR-037
This ADR amends ADR-037's command format. The hook file structure, feature routing, batch queue, and all other aspects of ADR-037 remain unchanged. Only the command string format changes to include the event argument.
