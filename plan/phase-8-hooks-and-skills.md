# Phase 8 — Hooks & Skills

## Goal
Implement hook execution via `worker-service.cjs`, merged hook file generation, feature routing, hook request queue, skill file management, hook activity tracking, and context usage monitoring.

## Reference
- ADR-006: Hook & Skill Schema
- ADR-026: GitHub Copilot Hooks — Complete Integration via Worker Service
- ADR-037: Merged Hook File, Feature Routing & Hook Request Queue
- ADR-040: Default /learn Skill & Context Usage Monitor
- C4 Code: ExtensionHookConfig, HookFeature, GeneratedHookFile, HookEntry

## Dependencies
- Phase 4 (extension system)
- Phase 7 (marketplace — copies hooks/skills on install)

## Tasks

### 8.1 Hook Feature Registry
- [ ] `HookFeatureRegistry` class: tracks all registered features (core + extension)
- [ ] `registerCore(feature, event, handler, timeoutMs)` — register core features at startup
- [ ] `registerExtension(extensionName, hookFeature)` — register extension feature on mount
- [ ] `unregisterExtension(extensionName)` — remove all features for extension on unmount
- [ ] `resolve(feature)` — lookup handler by feature ID (`context-inject` or `jira:session-init`)
- [ ] `listByEvent(event)` — list all features for an event (for file generation and queue)
- [ ] Feature naming: core features have no prefix, extension features use `{ext-name}:{action}`

### 8.2 Merged hook file generation
- [ ] Generate single `.github/hooks/renre-kit.json` (not per-extension files)
- [ ] Include `"version": 1` field in generated hook JSON (ADR-006 schema)
- [ ] Include `comment` field per hook entry (e.g. `"comment": "renre-kit core: session memory + context recipes"`)
- [ ] Validate generated JSON is well-formed before writing to disk (ADR-037 mitigation)
- [ ] Core features always included (9 events × 1 core feature each)
- [ ] Extension features added from `manifest.hooks.features` array
- [ ] Support `env` property in hook entries — environment variables object to inject into hook command (ADR-006)
- [ ] Command format: `node "${RENRE_KIT_ROOT}/scripts/worker-service.cjs" hook <agent> <feature>`
- [ ] `${RENRE_KIT_ROOT}` resolved to `~/.renre-kit/` absolute path at generation time
- [ ] Ordering per event: core features first, then extension features in installation order
- [ ] Regenerate on: `renre-kit init` (core features only — ADR-037), extension install, extension remove, extension upgrade
- [ ] On extension remove: regenerate (removes that extension's features from arrays)
- [ ] `POST /api/hooks/regenerate` — force regenerate hook file

### 8.3 `worker-service.cjs` hook entry point
- [ ] Create `~/.renre-kit/scripts/worker-service.cjs` (copied during CLI install/init)
- [ ] Parse args: `hook <agent> <feature>` where feature is `context-inject`, `jira:session-init`, etc.
- [ ] Read JSON from stdin (event context from AI agent)
- [ ] Read worker port from `~/.renre-kit/server.json`
- [ ] Resolve project ID from cwd (match against registered projects)
- [ ] Compute batch ID: `SHA-256(event + timestamp + cwd)` from stdin JSON
- [ ] POST to worker: `POST /api/hooks/enqueue` with `{ batchId, feature, event, projectId, agent, input }`
- [ ] Write feature-specific JSON response to stdout (for AI agent consumption)
- [ ] Timeout handling: respect `timeoutSec` from hook config
- [ ] Exit codes: `0` success, `1` failure, `2` blocking error (for preToolUse deny)
- [ ] Map agent-specific event names to canonical names (ADR-026): e.g. `Stop` → `sessionEnd`, `PreToolUse` → `preToolUse` (Copilot PascalCase, Claude Code camelCase)
- [ ] Graceful degradation: if worker not running, exit `0` silently

### 8.4 Hook Request Queue
- [ ] `HookRequestQueue` class in worker service
- [ ] `enqueue(req)` — main entry point, returns feature-specific result
- [ ] **Batch creation**: first request for a batch ID creates the batch and starts parallel processing of ALL features for that event
- [ ] **Parallel processing**: all registered features for the event execute concurrently via `Promise.allSettled`
- [ ] **Cache hit**: subsequent requests with same batch ID get pre-computed results immediately
- [ ] **Wait for result**: if feature not yet complete, poll until ready (10ms intervals)
- [ ] **Batch TTL**: clean up batches older than 60 seconds
- [ ] **Error isolation**: one feature failure doesn't affect others in the batch
- [ ] **Queue fallback**: if queue processing fails, fallback to direct sequential feature execution (no caching, slower but works) — ADR-037 mitigation
- [ ] `POST /api/hooks/enqueue` — enqueue route

### 8.5 Feature routing
- [ ] Core features route to intelligence services (stub implementations here, real logic in Phase 15 — Hook Intelligence):
  - `context-inject` → ContextRecipeEngine
  - `session-capture` → SessionMemoryService
  - `prompt-journal` → PromptJournalService
  - `tool-governance` → ToolGovernanceService
  - `tool-analytics` → ToolAnalyticsService
  - `error-intelligence` → ErrorIntelligenceService
  - `session-checkpoint` → SessionMemoryService (preCompact)
  - `subagent-track` → SubagentTrackingService
  - `subagent-complete` → SubagentTrackingService
- [ ] Extension features route to: `POST /api/{pid}/{ext-name}/__hooks/{action}`
- [ ] Parse `namespace:action` — namespace = extension name, action = route path
- [ ] No namespace = core feature
- [ ] 404 if extension not mounted or feature not registered
- [ ] `preCompact` hook has unique response format: `{ "continue": true, "systemMessage": "..." }`. Compaction guidance combines static best practices + dynamic project context (observations, error patterns, tool rules, session progress)

### 8.6 Response aggregation
- [ ] For `preToolUse` features: most restrictive decision wins (deny > ask > allow)
- [ ] For `sessionEnd`/`subagentStop`: any block → aggregate block decision
- [ ] For context-providing hooks (`sessionStart`, `userPromptSubmitted`, `subagentStart`): concatenate `additionalContext` from all features
- [ ] Collect `observations` from extension responses (for observations system)

### 8.7 Hook activity tracking
- [ ] In-memory ring buffer of last 100 hook executions per project
- [ ] Track per-feature: feature ID, event, duration, success/fail, batch timing
- [ ] `GET /api/{pid}/hooks/activity` — return recent executions
- [ ] `GET /api/{pid}/hooks/batches` — return recent batch history with timing stats
- [ ] `GET /api/hooks/features` — list all registered features (core + extension)
- [ ] Each entry: `{ timestamp, event, feature, extensionName, success, durationMs, error? }`

### 8.8 Session management (via sessionStart hook)
- [ ] On `context-inject` feature: create session in SQLite `_sessions` table
- [ ] Session: `{ id, projectId, startedAt, agent, status: "active" }`
- [ ] On `session-capture` feature: update session `{ endedAt, status: "ended", summary }`
- [ ] `GET /api/{pid}/sessions` — list active sessions for project

### 8.9 Skill file management
- [ ] On extension install: read `skills` from manifest
- [ ] Copy skill directories to `.github/skills/{skill-name}/SKILL.md`
- [ ] Parse SKILL.md frontmatter with `gray-matter` for metadata
- [ ] Validate frontmatter fields (ADR-040): `name`, `description`, `author`, `version`, `model` directive (e.g. `model: sonnet`)
- [ ] On extension remove: delete skill directories

### 8.10 Default `/learn` skill
- [ ] Install `.github/skills/learn/SKILL.md` during `renre-kit init`
- [ ] Core skill — not from any extension manifest
- [ ] Skip overwrite if user has modified it (checksum comparison against default)
- [ ] Project slug derivation from git remote URL for skill name prefix (`{slug}-{name}`) — ADR-040
- [ ] Skill content: online learning system with all four phases: Evaluate, Check Existing, Create, Quality Gates

### 8.11 Context Usage Monitor (ADR-040 Section 2)
- [ ] `ContextMonitor` class: running token counter per session
- [ ] On `postToolUse`: estimate tokens using `chars / 4` heuristic for tool args + result
- [ ] On `userPromptSubmitted`: add `prompt.length / 4` to counter
- [ ] Per-agent context window sizes: copilot 128K, claude-code 200K, cursor 128K (configurable)
- [ ] At 60-70% threshold (`suggestThreshold: 0.65`), trigger one-time `/learn` suggestion via `additionalContext` in `postToolUse` response
- [ ] Flag to prevent repeated suggestions in same session
- [ ] Project settings: `suggestThreshold` (default 0.65), `contextMonitor.enabled` (default true)
- [ ] `GET /api/{pid}/sessions/:id/context-usage` — token estimate for session

### Notes
> Console UI hook features view (per-event execution order, per-feature timing, success/fail, disable button, queue stats — ADR-037) is deferred to Phase 16.
> Console UI context usage bar in session header (ADR-040 Section 5) is deferred to Phase 16.
> `/learn` suggestion appears in session timeline (ADR-033 integration).

## Verification
```bash
# Install extensions with hooks
renre-kit marketplace add jira-plugin
renre-kit marketplace add github-mcp

# Verify SINGLE merged hook file created
cat .github/hooks/renre-kit.json
# → Single file with core + extension features per event
# → sessionStart array: [context-inject, jira:session-init, github-mcp:session-init]
# → preToolUse array: [tool-governance, jira:tool-check]

# No per-extension files should exist
ls .github/hooks/
# → renre-kit.json (only one file)

# Verify skill file created
cat .github/skills/example-skill/SKILL.md
# → Should contain skill content

# Test hook execution — core feature
echo '{"timestamp":1704614400000,"cwd":"/path","source":"new"}' | \
  node ~/.renre-kit/scripts/worker-service.cjs hook copilot context-inject
# → stdout: { "additionalContext": "## Session Context..." }

# Test hook execution — extension feature
echo '{"timestamp":1704614400000,"cwd":"/path","source":"new"}' | \
  node ~/.renre-kit/scripts/worker-service.cjs hook copilot jira:session-init
# → stdout: { "additionalContext": "### Jira — Open Issues..." }

# Both should use same batch (same timestamp + cwd) — second returns cached result

# Check registered features
curl http://localhost:42888/api/hooks/features
# → [{ "feature": "context-inject", "type": "core", "event": "sessionStart" },
#    { "feature": "jira:session-init", "type": "extension", "event": "sessionStart" }, ...]

# Check hook activity
curl http://localhost:42888/api/{pid}/hooks/activity
# → [{ "event": "sessionStart", "feature": "context-inject", "durationMs": 45 }, ...]

# Check batch stats
curl http://localhost:42888/api/{pid}/hooks/batches
# → [{ "batchId": "abc", "event": "sessionStart", "features": 3, "totalMs": 95 }]

# Remove extension — hook file regenerated without its features
renre-kit marketplace remove jira-plugin --yes
cat .github/hooks/renre-kit.json
# → jira:* features removed from all event arrays
```

## Files Created
```
packages/worker-service/src/
  core/hook-feature-registry.ts
  core/hook-request-queue.ts
  core/hook-response-aggregator.ts
  core/session-manager.ts
  routes/hooks.ts
  routes/sessions.ts
  scripts/worker-service.cjs

packages/cli/src/services/
  hook-file-generator.ts
  skill-manager.ts

packages/worker-service/src/
  core/context-monitor.ts
```
