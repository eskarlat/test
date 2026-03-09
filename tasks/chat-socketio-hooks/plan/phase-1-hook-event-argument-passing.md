# Phase 1 — Hook Event Argument Passing

## Goal

Embed the hook event name as an explicit CLI argument in generated hook commands so the worker-service.cjs entry point can route hook requests correctly without relying on stdin `event` field or static maps. Fixes the `listByEvent()` zero-match bug described in ADR-046.

## Reference

- ADR-046: Hook Event Argument Passing (amends ADR-037)
- ADR-037: Merged Hooks Feature Routing Queue

## Dependencies

None — standalone change affecting hook file generation and the entry point script.

## Tasks

### 1.1 Update `worker-service.cjs` Entry Point

- [ ] Change argument parsing to accept 4-arg format: `hook agent <event> <feature>`
  - `args[2]` = event name (camelCase, e.g., `sessionStart`)
  - `args[3]` = feature ID (e.g., `context-inject`)
- [ ] Implement backwards compatibility: if `args[3]` is undefined, fall back to old 3-arg format
  - If 3-arg: `args[2]` = feature, event resolved from `input.event` (stdin) or feature name
- [ ] Define `EVENT_MAP` constant in worker-service.cjs (JavaScript, top-level) for PascalCase → camelCase normalization:
  ```javascript
  const EVENT_MAP = {
    SessionStart: "sessionStart",
    SessionEnd: "sessionEnd",
    UserPromptSubmit: "userPromptSubmitted",
    PreToolUse: "preToolUse",
    PostToolUse: "postToolUse",
    ErrorOccurred: "errorOccurred",
    PreCompact: "preCompact",
    SubagentStart: "subagentStart",
    SubagentStop: "subagentStop",
  };
  ```
  **Note**: Verify PascalCase keys against the actual Copilot hook schema (ADR-026/ADR-037). The key `UserPromptSubmit` may need to be `UserPromptSubmitted` — confirm from the hook registry before implementing.
- [ ] Normalize event via `EVENT_MAP` for both CLI arg and fallback paths
- [ ] Update the enqueue payload to use the resolved event from CLI arg as primary source:
  ```javascript
  const eventArg = args.length >= 4 ? args[2] : null;
  const feature = args.length >= 4 ? args[3] : args[2];
  const event = EVENT_MAP[eventArg] || eventArg || input.event || feature;
  ```
- [ ] Add a debug log line (stderr, not stdout — stdout is reserved for hook response JSON) showing the resolved event source: `Event resolved from: cli-arg | stdin | fallback`

### 1.2 Update CLI Hook File Generator

File: `packages/cli/src/services/hook-file-generator.ts`

- [ ] Modify hook command generation to include event name before feature ID
- [ ] Event name is the camelCase version of the hook JSON key (e.g., `SessionStart` → `sessionStart`)
- [ ] Define a `HOOK_EVENT_MAP` constant mapping PascalCase keys to camelCase events:
  ```typescript
  const HOOK_EVENT_MAP: Record<string, string> = {
    SessionStart: "sessionStart",
    SessionEnd: "sessionEnd",
    UserPromptSubmit: "userPromptSubmitted",
    PreToolUse: "preToolUse",
    PostToolUse: "postToolUse",
    ErrorOccurred: "errorOccurred",
    PreCompact: "preCompact",
    SubagentStart: "subagentStart",
    SubagentStop: "subagentStop",
  };
  ```
- [ ] Generated command format changes from:
  ```
  node /path/to/worker-service.cjs hook agent <feature>
  ```
  to:
  ```
  node /path/to/worker-service.cjs hook agent <event> <feature>
  ```
- [ ] Verify existing tests still pass (if any) and add test for new command format

### 1.3 Update Worker Service Hook File Generator

File: `packages/worker-service/src/services/hook-file-generator.ts`

- [ ] Apply same changes as 1.2 — this is the server-side generator used during extension install/uninstall and `POST /api/hooks/regenerate`
- [ ] Both generators must produce identical output for the same inputs
- [ ] Event name derived from the hook key in the merged hook structure

### 1.4 Update Marketplace Route Hook Generation

File: `packages/worker-service/src/routes/marketplace.ts`

- [ ] If this route generates hook commands directly (not via the shared generator), update to include event argument
- [ ] If it delegates to the hook-file-generator service, verify the service call passes event context through
- [ ] Ensure extension install/uninstall triggers hook file regeneration with the new format
- [ ] Verify `POST /api/hooks/regenerate` endpoint also generates new format (it delegates to the same generator)

### 1.5 Stale Hook File Detection

- [ ] In `worker-service.cjs`, when the 3-arg fallback path is used, log a warning to stderr:
  `"Hook file uses old format (missing event arg). Run 'renre-kit init' to regenerate."`
- [ ] This warning fires once per invocation when the script falls back to stdin or feature name — gives users a clear migration path
- [ ] Extension features (e.g., `jira:session-init`) get their event from the generated hook command (same as core features) — no special handling needed because event is baked in at generation time

### 1.6 Unit Tests

- [ ] Add test for `worker-service.cjs` event resolution logic:
  - 4-arg format: `args = ["hook", "agent", "sessionStart", "context-inject"]` → event = `sessionStart`, feature = `context-inject`
  - 3-arg fallback with stdin event: `args = ["hook", "agent", "context-inject"]`, stdin `{ event: "sessionStart" }` → event = `sessionStart`
  - 3-arg fallback without stdin event: `args = ["hook", "agent", "context-inject"]`, stdin `{}` → event = `context-inject` (last resort)
  - PascalCase normalization: `args = ["hook", "agent", "SessionStart", "context-inject"]` → event = `sessionStart`
- [ ] Add test for CLI hook-file-generator:
  - Given feature `context-inject` under event key `SessionStart`, generated command includes `sessionStart context-inject`
  - Given extension feature `jira:session-init` under event key `SessionStart`, generated command includes `sessionStart jira:session-init`
- [ ] Add test for worker-service hook-file-generator (same cases)

### 1.7 Verification

```bash
# Build all packages
pnpm run build

# Verify the generated hook file format
# After running init on a test project, inspect the hook file:
cat .github/hooks/renre-kit.json | jq '.hooks.SessionStart[0].command'
# Expected: "node /path/to/worker-service.cjs hook agent sessionStart context-inject"

# Verify backwards compatibility: old-format commands still work
echo '{"event":"sessionStart"}' | node ~/.renre-kit/scripts/worker-service.cjs hook agent context-inject
# Should still work (3-arg fallback path)

# Lint
pnpm run lint
pnpm run lint:duplication
```

## Files Modified

```
packages/worker-service/src/scripts/worker-service.cjs    — Accept 4th arg as event
packages/cli/src/services/hook-file-generator.ts           — Append event to generated commands
packages/worker-service/src/services/hook-file-generator.ts — Append event to generated commands
packages/worker-service/src/routes/marketplace.ts          — Ensure event in generated commands
```
