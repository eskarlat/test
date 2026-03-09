# Phase 15 — Hook Intelligence (Core)

## Goal
Implement the core hook intelligence features: session memory, observations, tool governance, prompt journal, error intelligence, tool analytics, subagent tracking, and context recipes. These are **core RenRe Kit features** (not extensions) that leverage all 8 Copilot hook events.

## Reference
- ADR-026: Copilot Hooks Integration
- ADR-027: Session Memory & Context Continuity
- ADR-028: Observations System
- ADR-029: Tool Governance
- ADR-030: Prompt Journal
- ADR-031: Agent Error Intelligence
- ADR-032: Tool Usage Analytics
- ADR-033: Session Timeline
- ADR-034: Subagent Tracking
- ADR-035: Context Recipes
- ADR-036: Extension Context Provider
- ADR-038: FTS5 Full-Text Search
- ADR-040: Default /learn Skill & Context Usage Monitor

## Dependencies
- Phase 8 (hooks & skills — hook execution route, worker-service.cjs)
- Phase 3 (worker service — SQLite, logging)
- Phase 4 (extension system — extension hook handler interface)

## Tasks

### 15.1 Database schema — intelligence tables (core migration 002)
- [ ] Core migration `002_hook_intelligence.up.sql` / `.down.sql` — uses the core migration system (ADR-043, Phase 3 task 3.4b). Tracked as `__core__` / `002` in `_migrations` table
- [ ] `_sessions` table: extend with summary, files_modified, decisions, tool/error/prompt counts, context_injected
- [ ] `_observations` table: content, source, category, confidence, active flag, `last_injected_at TEXT`, `injection_count INTEGER DEFAULT 0` (ADR-028)
- [ ] `_tool_rules` table: pattern, decision, tool_type, priority, scope (global/project), hit_count
- [ ] `_tool_audit` table: tool decisions log with rule/extension attribution
- [ ] `_prompts` table: prompt text, `prompt_preview TEXT` (first 200 chars — ADR-030), session link, intent_category, context_injected
- [ ] `_agent_errors` table: error details + fingerprint
- [ ] `_error_patterns` table: aggregated recurring errors with status (active/resolved/ignored)
- [ ] `_tool_usage` table: tool invocations with result, duration, file path
- [ ] `_subagent_events` table: subagent lifecycle with type, parent, duration, guidelines
- [ ] `_hook_activity` table: `(id, session_id, project_id, event TEXT, feature TEXT, duration_ms INTEGER, success BOOLEAN, error TEXT, created_at TEXT)` — ADR-033 timeline data source

### 15.2 Session Memory service
- [ ] `SessionMemoryService` class
- [ ] On `sessionEnd`: aggregate session data (prompts, tools, errors) → generate summary → persist
- [ ] On `sessionStart`: query last N sessions → format as context string
- [ ] On `preCompact`: create session checkpoint — snapshot current stats, generate compact summary
- [ ] On `preCompact`: read `custom_instructions` from input — tailor checkpoint and guidance to user focus
- [ ] On `preCompact`: assemble compaction guidance — static best practices + dynamic project context
- [ ] Compaction guidance sources: user focus (`custom_instructions`), observations, error patterns, tool rules, session progress
- [ ] Store `custom_instructions` in checkpoint record for sessionStart reference
- [ ] Return guidance via `systemMessage` in preCompact output
- [ ] `_session_checkpoints` table: id, session_id, project_id, trigger, summary, counts, files_modified
- [ ] On `sessionStart` with `source: "resume"`: inject checkpoint summaries above previous sessions
- [ ] Include checkpoint summaries in sessionStart context for resumed/recent sessions
- [ ] Compaction guidance configuration: enable/disable sources, max token budget
- [ ] Include files modified list (extracted from tool usage)
- [ ] Include key decisions (from extension hook responses)
- [ ] `GET /api/{pid}/sessions` — list sessions (paginated, filterable) — ADR-027
- [ ] `GET /api/{pid}/sessions/:id` — session detail with full summary
- [ ] `GET /api/{pid}/sessions/:id/checkpoints` — list checkpoints for a session
- [ ] `GET /api/{pid}/sessions/context-preview` — preview next sessionStart injection
- [ ] Sessions older than 7 days auto-archived (not injected into new sessions) — ADR-027

### 15.3 Observations service
- [ ] `ObservationsService` class
- [ ] CRUD operations: create, read, update, delete, archive, confirm
- [ ] Accept observations from extension hook responses (`observations` field)
- [ ] Accept observations from user via Console UI
- [ ] Auto-detect patterns: repeated tool use patterns, error patterns → suggested observations
- [ ] "Remember" pattern detection in `userPromptSubmitted` prompts
- [ ] Deduplication by content similarity before insert
- [ ] Injection priority — all 5 factors (ADR-028): (1) recently injected, (2) high confidence, (3) recently created/updated, (4) category relevance matching to initial prompt, (5) injection count
- [ ] Update `last_injected_at` and increment `injection_count` on each sessionStart injection
- [ ] Observations not injected for 30 days auto-archive — ADR-028
- [ ] API routes: `GET/POST/PUT/DELETE /api/{pid}/observations`

### 15.4 Tool Governance engine
- [ ] `ToolGovernanceService` class
- [ ] Load rules from `_tool_rules` (global + project-scoped)
- [ ] Evaluate on `preToolUse`: match tool_type + pattern against tool input
- [ ] Two-phase evaluation (ADR-029): (1) core rules evaluated in priority order — first match determines core decision, (2) extension rules aggregated — all extensions consulted. Final: aggregate all decisions with `deny > ask > allow` precedence
- [ ] Aggregate with extension `preToolUse` responses
- [ ] Built-in default rules (see ADR-029): rm -rf, force push, DROP TABLE, etc.
- [ ] Audit every decision to `_tool_audit`
- [ ] Rule hit counter tracking
- [ ] Pattern test endpoint: `POST /api/tool-rules/test`
- [ ] `POST /api/tool-rules/:id/toggle` — enable/disable rule (ADR-029)
- [ ] API routes: `GET/POST/PUT/DELETE /api/tool-rules`, `GET /api/{pid}/tool-audit`

### 15.5 Prompt Journal service
- [ ] `PromptJournalService` class
- [ ] On `userPromptSubmitted`: store prompt, detect intent category (keyword-based)
- [ ] Increment session prompt counter
- [ ] Forward to extensions for context injection
- [ ] Aggregate extension context responses
- [ ] Analytics: counts by intent category, agent, date
- [ ] Keyword extraction for "top keywords" display
- [ ] Full-text search across prompts
- [ ] Auto-purge prompts older than 30 days (configurable) — ADR-030
- [ ] API routes: `GET /api/{pid}/prompts`, `GET /api/{pid}/prompts/analytics`

### 15.6 Error Intelligence service
- [ ] `ErrorIntelligenceService` class
- [ ] On `errorOccurred`: compute fingerprint, store error, update pattern
- [ ] Fingerprinting: strip paths, line numbers, variable values → SHA-256 hash
- [ ] Pattern management: first_seen, last_seen, occurrence_count, session_count
- [ ] Auto-observation when pattern reaches 3+ occurrences
- [ ] Pattern status workflow: active → resolved (with note) | ignored
- [ ] Re-activate resolved patterns if error recurs
- [ ] On `sessionStart`: include active patterns with 3+ occurrences as warnings
- [ ] Trend data: error counts by day
- [ ] Auto-purge raw errors after 30 days (patterns persist) — ADR-031
- [ ] `GET /api/{pid}/errors` — list raw errors (paginated) — ADR-031
- [ ] `GET /api/{pid}/errors/trends` — error count by day for chart — ADR-031
- [ ] API routes: `GET /api/{pid}/errors/patterns`, `POST .../resolve`, `POST .../ignore`

### 15.7 Tool Usage Analytics service
- [ ] `ToolAnalyticsService` class
- [ ] On `postToolUse`: store tool invocation data
- [ ] Extract file path from tool args where applicable
- [ ] Pattern detection: file thrashing (5+ edits same file), command loops (3+ same failure), high churn
- [ ] Auto-observations for detected patterns
- [ ] Per-session analytics: tool counts by type, success rate, file hotspots
- [ ] Cross-session analytics: most touched files, efficiency trends
- [ ] Auto-purge raw tool usage after 30 days (aggregates persist) — ADR-032
- [ ] `GET /api/{pid}/tools/usage` — raw tool usage list (paginated, filterable) — ADR-032
- [ ] `GET /api/{pid}/tools/analytics/session/:sid` — per-session analytics — ADR-032
- [ ] In-memory batch inserts for high-volume sessions (ADR-032 performance mitigation)
- [ ] Pattern detection thresholds configurable in project settings — ADR-032
- [ ] API routes: `GET /api/{pid}/tools/analytics`, `GET .../files`, `GET .../warnings`

### 15.8 Subagent Tracking service
- [ ] `SubagentTrackingService` class
- [ ] On `subagentStart`: record event, inject guidelines (tool rules + relevant observations)
- [ ] On `subagentStop`: record event, compute duration, handle block decisions
- [ ] Tree construction from parent_agent_id for nested subagents
- [ ] Forward to extensions for guidelines injection / stop validation
- [ ] Analytics: counts by type, avg duration
- [ ] API routes: `GET /api/{pid}/subagents`, `GET .../tree/:sessionId`, `GET .../analytics`

### 15.8b Session Timeline API (ADR-033)
- [ ] `GET /api/{pid}/sessions/:id/timeline` — cursor-based pagination with type filtering (`?types=prompt,tool-use&cursor=x&limit=50`)
- [ ] `GET /api/{pid}/sessions/:id/summary` — session summary stats
- [ ] Timeline aggregates data from: `_prompts`, `_tool_usage`, `_tool_audit`, `_agent_errors`, `_subagent_events`, `_hook_activity`
- [ ] Event type `hook-executed` sourced from `_hook_activity` table

### 15.8c Auto-Purge Scheduler
- [ ] Scheduled cleanup service — runs daily (or on server start)
- [ ] Archive sessions older than 7 days (don't delete)
- [ ] Archive observations not injected for 30 days
- [ ] Purge prompts older than 30 days
- [ ] Purge raw errors older than 30 days (patterns persist)
- [ ] Purge raw tool usage older than 30 days (aggregates persist)
- [ ] Configurable retention periods in project settings

### 15.8d Stats endpoints for dashboard (ADR-039)
- [ ] `GET /api/{pid}/observations/stats` — count, categories breakdown
- [ ] `GET /api/{pid}/errors/patterns/stats` — active pattern count, trend
- [ ] `GET /api/tool-rules/stats?pid={pid}` — rule count, recent denials
- [ ] `GET /api/{pid}/prompts/stats` — count, intent breakdown
- [ ] `GET /api/{pid}/tools/stats` — total uses, warning count
- [ ] `GET /api/{pid}/sessions/stats` — count, avg duration

### 15.9 Context Recipes engine
- [ ] `ContextRecipeEngine` class
- [ ] `ContextProvider` interface: id, name, getContext(projectId, config, tokenBudget) → `ContextResponse { content, estimatedTokens, itemCount, truncated, metadata? }` (ADR-036)
- [ ] Built-in providers: session-history, observations, git-history, error-patterns, tool-rules
- [ ] Extension provider discovery: read `contextProvider` from extension manifest (ADR-036)
- [ ] Register extension providers in `_context_providers` table on extension mount
- [ ] Call extension `POST /__context` route with `{ config, tokenBudget, sessionInput }`
- [ ] Recipe config: stored in project settings, ordered provider list with per-provider config
- [ ] Token budget management: providers execute in order, each gets remaining budget
- [ ] Token estimation: ~4 chars per token heuristic
- [ ] Preview endpoint: assemble context without injecting
- [ ] Sensible defaults: all providers enabled with conservative limits
- [ ] Ordering with sessionStart hook (ADR-036): recipe engine calls `/__context` first (structured, budget-aware), then hook executor calls `/__hooks/sessionStart` (side effects). Hook `additionalContext` appended after recipe output (outside token budget)
- [ ] `POST /api/{pid}/context-recipe/reset` — reset to defaults (ADR-035)
- [ ] API routes: `GET/PUT /api/{pid}/context-recipe`, `POST .../preview`, `GET .../providers`

### 15.10 Context Usage Monitor integration
- [ ] Wire Phase 8's `ContextMonitor` class into intelligence services — the core class is created in Phase 8 (task 8.11), this phase integrates it with session memory and timeline data
- [ ] Persist context usage snapshots in `_sessions` table for historical analytics
- [ ] Surface context usage trends in `GET /api/{pid}/sessions/:id` response

### 15.11 FTS5 full-text search indexes (core migration 005)
- [ ] Core migration `005_create_fts_indexes.up.sql` / `.down.sql` — uses core migration system (ADR-043). Tracked as `__core__` / `005` in `_migrations` table
- [ ] FTS5 virtual tables: `_prompts_fts`, `_observations_fts`, `_agent_errors_fts`, `_sessions_fts`
- [ ] External content tables (`content=_prompts`, etc.) — no data duplication
- [ ] Tokenizer: `porter unicode61` (stemming + Unicode support)
- [ ] Sync triggers: AFTER INSERT, AFTER UPDATE, BEFORE DELETE for each table
- [ ] `FTSSearchService` class: search per-table and unified cross-table search
- [ ] Query sanitization: strip unsafe FTS5 syntax from user input
- [ ] BM25 ranking for relevance-sorted results
- [ ] Snippet extraction with `snippet()` for highlighted previews
- [ ] Rebuild command for index maintenance
- [ ] `GET /api/{pid}/search?q=&tables=` — unified search endpoint
- [ ] Update individual routes to use FTS: prompts, observations, errors, sessions

### 15.11b SSE event emission (ADR-023, ADR-039)
- [ ] All intelligence services emit events via `eventBus.emit()` (Phase 14 EventBus) for real-time Console UI updates:
  - SessionMemoryService: `session:started`, `session:ended`
  - ObservationsService: `observation:created`, `observation:updated`
  - ErrorIntelligenceService: `error:recorded`
  - PromptJournalService: `prompt:recorded`
  - ToolAnalyticsService: `tool:used`
  - ToolGovernanceService: `tool:denied`
  - Hook activity: `hook:executed`
- [ ] Event payload includes minimal data for UI updates (id, type, timestamp) — UI fetches full details on demand

### 15.12 Hook execution integration
- [ ] Update hook executor (Phase 8) to call intelligence services for each event:
  - `sessionStart` → ContextRecipeEngine.assemble() → return as additionalContext
  - `sessionEnd` → SessionMemoryService.capture() + collect extension observations
  - `userPromptSubmitted` → PromptJournalService.record() + extension context
  - `preToolUse` → ToolGovernanceService.evaluate() + extension decisions → aggregate
  - `postToolUse` → ToolAnalyticsService.record() + extension handlers
  - `errorOccurred` → ErrorIntelligenceService.record() + extension handlers
  - `preCompact` → SessionMemoryService.checkpoint() + extension state save
  - `subagentStart` → SubagentTrackingService.recordStart() + inject guidelines
  - `subagentStop` → SubagentTrackingService.recordStop() + extension validation
- [ ] Services execute before extension handlers (core first, then extensions)
- [ ] Extension hook responses parsed for observations, context, decisions

## Verification
```bash
# Start server with a registered project
renre-kit start

# Simulate sessionStart — should inject context
echo '{"timestamp":1704614400000,"cwd":"/path/to/project","source":"new"}' | \
  node ~/.renre-kit/scripts/worker-service.cjs hook copilot session-start
# → stdout includes additionalContext with observations, session history, etc.

# Create an observation via API
curl -X POST http://localhost:42888/api/{pid}/observations \
  -H "Content-Type: application/json" \
  -d '{"content":"Project uses pnpm not npm","category":"tooling"}'

# Add a tool governance rule
curl -X POST http://localhost:42888/api/tool-rules \
  -H "Content-Type: application/json" \
  -d '{"pattern":"rm -rf /","decision":"deny","reason":"Dangerous","tool_type":"bash"}'

# Simulate preToolUse — should deny
echo '{"timestamp":1704614600000,"cwd":"/path","toolName":"bash","toolArgs":"{\"command\":\"rm -rf /\"}"}' | \
  node ~/.renre-kit/scripts/worker-service.cjs hook copilot pre-tool-use
# → stdout: { "permissionDecision": "deny", "permissionDecisionReason": "..." }

# Check prompt journal
curl http://localhost:42888/api/{pid}/prompts/analytics
# → { "total": 5, "byCategory": { "bug-fix": 2, "feature": 3 } }

# Check error patterns
curl http://localhost:42888/api/{pid}/errors/patterns
# → [{ "fingerprint": "...", "occurrence_count": 3, "status": "active" }]

# Preview context recipe
curl -X POST http://localhost:42888/api/{pid}/context-recipe/preview
# → { "content": "## Session Context...", "estimatedTokens": 1400 }
```

## Files Created
```
packages/worker-service/src/
  core/
    session-memory.ts
    observations-service.ts
    tool-governance.ts
    prompt-journal.ts
    error-intelligence.ts
    tool-analytics.ts
    subagent-tracking.ts
    context-recipe-engine.ts
    context-providers/
      session-history-provider.ts
      observations-provider.ts
      git-history-provider.ts
      error-patterns-provider.ts
      tool-rules-provider.ts
      extension-provider.ts
  routes/
    observations.ts
    tool-rules.ts
    prompts.ts
    errors.ts
    tool-analytics.ts
    subagents.ts
    context-recipe.ts
  core/
    fts-search-service.ts
  routes/
    search.ts
  migrations/core/
    002_hook_intelligence.up.sql       # Core migration (ADR-043)
    002_hook_intelligence.down.sql
    005_create_fts_indexes.up.sql      # Core migration (ADR-043)
    005_create_fts_indexes.down.sql
  core/
    auto-purge-scheduler.ts
  routes/
    session-timeline.ts
```
