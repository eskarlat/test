# Phase 16 — Console Intelligence UI

## Goal
Build Console UI pages for all hook intelligence features: session timeline, observations manager, tool governance dashboard, prompt journal, error intelligence dashboard, tool analytics, subagent viewer, and context recipe configuration.

## Reference
- ADR-027 through ADR-035 (Hook Intelligence ADRs)
- ADR-022: Console UI Tech Stack
- ADR-024: Console UI Pages
- ADR-038: FTS5 Full-Text Search
- ADR-039: Console Intelligence Pages

## Dependencies
- Phase 11 (Console UI shell — layout, routing, stores)
- Phase 15 (Hook Intelligence — all APIs)
- Phase 14 (SSE — live updates for dashboard data)

## Tasks

### 16.1 Session Timeline page
- [ ] Route: `/:projectId/sessions/:sessionId`
- [ ] Fetch unified timeline from `GET /api/{pid}/sessions/:id/timeline`
- [ ] Render events chronologically with type-specific icons and formatting
- [ ] Expandable events: prompts show full text, tools show args/output, errors show stack
- [ ] Subagent nesting: indented groups with tree connector lines
- [ ] Filters: by event type (prompts, tools, errors, subagents, hooks)
- [ ] Session summary header: agent, duration, stats (prompts/tools/errors)
- [ ] Session outcome footer: files modified, observations created
- [ ] Virtual scrolling for long sessions (100+ events)
- [ ] Link from session list and project home

### 16.2 Session list page
- [ ] Route: `/:projectId/sessions`
- [ ] List sessions with agent, duration, status, prompt/tool/error counts
- [ ] Click to open session timeline
- [ ] Filter by agent, date range, status
- [ ] Session context preview: expand to see what context was injected

### 16.2b Shared Intelligence UI Components (ADR-039)
- [ ] `PageHeader` component: `{ title, description, actions, breadcrumbs }`
- [ ] `StatsCard` component: `{ label, value, trend, icon, onClick }`
- [ ] `ExpandableList` component: expand/collapse, search, filters
- [ ] `EmptyState` component for pages with no data
- [ ] `Pagination` component for paginated lists
- [ ] Badge components: `BadgeDecision`, `BadgeIntent`, `BadgeAgent`, `BadgeConfidence`
- [ ] Utility components: `TimeAgo`, `BarChart`, `TrendChart`, `SearchHighlight`
- [ ] Files: `components/intelligence/shared/` directory

### 16.2c Unified Search Bar / Command Palette (ADR-039)
- [ ] `SearchPalette.tsx` — toolbar search bar with command palette dropdown
- [ ] Keyboard shortcut: `Cmd+K` (Mac) / `Ctrl+K` (Win) to focus
- [ ] 300ms debounce on input, arrow key navigation in results
- [ ] Categories: sessions, observations, prompts, errors, tool rules
- [ ] Top 3 results per category with quick preview
- [ ] Category click navigates to full results
- [ ] `SearchResults.tsx` — full search results page at `/:pid/search?q=`
- [ ] Table with filter checkboxes by type, categorized results with "View all" links
- [ ] Add route `/:pid/search` to routing config
- [ ] Files: `pages/search.tsx`, `components/intelligence/SearchPalette.tsx`, `components/intelligence/SearchResults.tsx`

### 16.3 Observations page
- [ ] Route: `/:projectId/observations`
- [ ] List active observations grouped by category
- [ ] Each observation: content, source, confidence badge, injection count, actions
- [ ] Actions: Edit, Archive, Delete, Confirm (for suggested)
- [ ] "Add Observation" dialog: content, category selector
- [ ] Search across observations
- [ ] Filter by category, confidence, source
- [ ] Suggested observations section with "Confirm" / "Dismiss" buttons
- [ ] Archived observations section: collapsed by default, click-to-expand (ADR-039)
- [ ] Bulk actions: archive all in category

### 16.4 Tool Governance page
- [ ] Route: `/tool-governance` (global) + `/:projectId/tool-governance` (project)
- [ ] Rule list sorted by priority with drag-to-reorder
- [ ] Each rule: decision badge (deny/ask/allow), tool type, pattern, hit count, last hit
- [ ] Add Rule dialog: name, tool type, pattern, pattern type (regex/contains/glob), decision, reason, priority, scope
- [ ] Pattern preview: test against sample inputs inline
- [ ] Edit/Delete/Toggle (enable/disable) actions
- [ ] Built-in rules section (system rules, can disable but not delete)
- [ ] Audit log tab: recent decisions with tool details, rule attribution, user overrides

### 16.5 Prompt Journal page
- [ ] Route: `/:projectId/prompts`
- [ ] Analytics cards: total prompts, by intent (bar chart), by agent (pie), top keywords
- [ ] Prompt history list: timestamp, agent, intent badge, prompt preview
- [ ] Expandable: full prompt text, context that was injected
- [ ] Delete individual prompts (ADR-030)
- [ ] Search: full-text across prompts
- [ ] Filter: by intent category, agent, date range

### 16.6 Error Intelligence page
- [ ] Route: `/:projectId/errors`
- [ ] Error trends chart: errors per day (bar chart, 7/30 day view)
- [ ] Pattern list: message, occurrence count, session count, last seen, status badge
- [ ] Status actions: Resolve (with note + checkbox "Create observation from resolution note" — ADR-039), Ignore, Unignore
- [ ] Pattern detail: expandable to show all individual occurrences with timestamps
- [ ] Resolved patterns section with resolution notes
- [ ] Link between error pattern and auto-created observation

### 16.7 Tool Analytics page
- [ ] Route: `/:projectId/tools`
- [ ] Session selector: view analytics for specific session or project-wide
- [ ] Summary cards: total tools, success rate, avg per prompt
- [ ] Tool type breakdown: bar chart (bash/edit/view/create with success/fail)
- [ ] Warnings section: detected patterns (thrashing, loops, churn)
- [ ] File hotspots: most edited files with edit/view counts
- [ ] Command frequency: most run commands with success/failure rates
- [ ] Cross-session trends: efficiency over time

### 16.8 Subagent Viewer
- [ ] Integrated into Session Timeline (16.1) as nested tree groups
- [ ] Subagent analytics section on Tool Analytics page
- [ ] Subagent type breakdown: Explore, Plan, general-purpose with avg duration
- [ ] Tree view: visual subagent hierarchy for complex sessions
- [ ] Guidelines display: show what was injected on subagent start

### 16.9 Context Recipes page
- [ ] Route: `/:projectId/context-recipes`
- [ ] Provider list with drag-to-reorder
- [ ] Each provider: checkbox (enable/disable), name, estimated tokens, "Configure" button
- [ ] Per-provider config panel: provider-specific settings (max sessions, max items, time range, etc.)
- [ ] Token budget input with visual budget bar
- [ ] Extension providers listed alongside core providers
- [ ] "Preview Context" button: calls preview API, shows formatted markdown output
- [ ] "Reset to Defaults" button
- [ ] Save button with success confirmation

### 16.9b Context Usage Indicator (ADR-040)
- [ ] Context usage bar in session timeline header: `████████████████░░░░░░░░ 66%` (ADR-040 Section 5)
- [ ] Data from `GET /api/{pid}/sessions/:id/context-usage`

### 16.9c Hook Features Console View (ADR-037)
- [ ] Per-event execution order with core/extension feature listing
- [ ] Per-feature timing, last run, success/fail status
- [ ] Disable button for extension features
- [ ] Queue statistics (batch timing, parallel savings)
- [ ] Located under Settings or as sub-page

### 16.9d SSE Integration for Intelligence Pages (ADR-039)
- [ ] Wire SSE events to intelligence Zustand stores
- [ ] Events: `session:started`, `session:ended`, `observation:created`, `observation:updated`, `error:recorded`, `prompt:recorded`, `tool:used`, `tool:denied`, `hook:executed`
- [ ] Live update behaviors: fade-in animation for new items, counter badge updates, toast notifications for important events
- [ ] Each store implements `onEvent(event)` method from `IntelligenceStore<T>` interface

### 16.10 Navigation integration
- [ ] Sidebar: collapsible "Intelligence" group (ADR-039), defaults to expanded when session data exists
- [ ] Intelligence group items: Sessions, Observations, Prompts, Errors, Tool Analytics, Context Recipes
- [ ] Tool Governance: top-level sidebar item (NOT inside Intelligence group — ADR-039)
- [ ] Project Home dashboard: 6 intelligence cards (ADR-039): Sessions, Observations, Errors, Prompts, Tool Rules, Tool Usage — each uses `/stats` endpoints from Phase 15
- [ ] Link from dashboard cards to detail pages

### 16.11 Zustand stores for intelligence
- [ ] Standardized `IntelligenceStore<T>` interface: `fetch`, `fetchMore`, `setFilter`, `setSearch`, `reset`, `onEvent` (SSE handler) — ADR-039
- [ ] `session-store.ts` — sessions, active session, timeline data
- [ ] `observation-store.ts` — observations CRUD, categories
- [ ] `tool-rules-store.ts` — rules CRUD, audit log
- [ ] `error-store.ts` — error patterns, trends
- [ ] `tool-analytics-store.ts` — tool usage data, warnings
- [ ] `context-recipe-store.ts` — recipe config, preview
- [ ] `prompt-store.ts` — prompt history, analytics (ADR-039)
- [ ] `search-store.ts` — search query, results, filters (ADR-039)

## Verification
```bash
# Start server, open Console
renre-kit start
open http://localhost:42888

# Navigate to project → Sessions
# → Should see session list with stats
# → Click session → Timeline with chronological events

# Navigate to Observations
# → List of observations with categories
# → Add new observation, confirm suggested ones

# Navigate to Tool Governance
# → Default rules visible (rm -rf, force push, etc.)
# → Add custom rule, test pattern preview
# → Audit log shows recent decisions

# Navigate to Prompt Journal
# → Analytics charts (intent, agent breakdown)
# → Searchable prompt history

# Navigate to Error Intelligence
# → Error trend chart
# → Pattern list with resolve/ignore actions

# Navigate to Context Recipes
# → Provider list with enable/disable and reorder
# → Configure per-provider settings
# → Preview assembled context
```

## Files Created
```
packages/console-ui/src/
  routes/
    [projectId]/
      sessions/
        index.tsx             # Session list
        [sessionId].tsx       # Session timeline
      observations.tsx        # Observations manager
      tool-governance.tsx     # Tool rules + audit
      prompts.tsx             # Prompt journal
      errors.tsx              # Error intelligence
      tools.tsx               # Tool analytics
      context-recipes.tsx     # Context recipe config
    tool-governance.tsx       # Global tool rules
  components/
    intelligence/
      shared/
        PageHeader.tsx
        StatsCard.tsx
        ExpandableList.tsx
        EmptyState.tsx
        Pagination.tsx
        Badges.tsx
        TimeAgo.tsx
        BarChart.tsx
        TrendChart.tsx
        SearchHighlight.tsx
      SearchPalette.tsx
      SearchResults.tsx
      SessionTimeline.tsx
      TimelineEvent.tsx
      SessionRow.tsx                # Session list row (ADR-039)
      SubagentTree.tsx
      ObservationList.tsx
      ObservationForm.tsx
      SuggestedBanner.tsx           # Suggested observations banner (ADR-039)
      ToolRuleList.tsx
      ToolRuleForm.tsx
      PatternPreview.tsx
      AuditLog.tsx
      PromptAnalytics.tsx
      PromptHistory.tsx
      PromptDetail.tsx              # Expandable prompt detail (ADR-039)
      ErrorTrends.tsx
      ErrorPatternList.tsx
      PatternDetail.tsx             # Error pattern detail (ADR-039)
      ResolveDialog.tsx             # Error resolution dialog (ADR-039)
      ToolSummary.tsx
      ToolWarnings.tsx
      FileHotspots.tsx
      CommandFrequency.tsx          # Most run commands (ADR-039)
      ContextRecipeEditor.tsx
      ProviderConfig.tsx
      ContextPreview.tsx
      TokenBudgetBar.tsx            # Visual token budget bar (ADR-039)
      ResultGroup.tsx               # Search result group (ADR-039)
      StatsRow.tsx                  # Row of StatsCards (ADR-039)
  routes/
    [projectId]/
      search.tsx
  stores/
    session-store.ts
    observation-store.ts
    tool-rules-store.ts
    error-store.ts
    tool-analytics-store.ts
    context-recipe-store.ts
    prompt-store.ts
    search-store.ts
```
