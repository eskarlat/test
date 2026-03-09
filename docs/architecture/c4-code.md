# C4 Level 4 — Code-Level Design

## Description
Key interfaces, data structures, and module boundaries at the code level.

---

## Core Data Structures

### Extension Manifest (`manifest.json`)
```typescript
interface ExtensionManifest {
  name: string;              // unique extension id, e.g. "jira-plugin"
  version: string;           // semver
  minSdkVersion?: string;    // minimum SDK version required (ADR-044). Required for marketplace extensions
  displayName: string;       // human-readable name
  description: string;
  author: string;

  backend?: {
    entrypoint: string;      // relative path to Express router factory, e.g. "backend/index.js"
    actions?: ActionDefinition[]; // discoverable actions for `query --help`
  };

  ui?: {
    pages: UIPage[];         // pages to register in sidebar
    bundle: string;          // relative path to pre-built JS bundle, e.g. "ui/index.js"
    styles?: string;         // optional CSS bundle
  };

  mcp?: MCPConfig;           // optional MCP server configuration

  migrations?: string;       // relative path to migrations dir, e.g. "migrations/"

  settings?: {
    schema: SettingDefinition[]; // configurable settings for this extension
  };

  permissions?: ExtensionPermissions; // declared permissions (shown at install)

  hooks?: ExtensionHookConfig; // Hook features this extension handles (ADR-037)
  skills?: SkillDefinition[];

  contextProvider?: ContextProviderManifest; // optional context recipe provider (ADR-036)

  dependencies?: string[];   // other extension names this depends on (future)
}

// Context provider manifest — declared in extension manifest.json
interface ContextProviderManifest {
  name: string;                        // Display name in Context Recipes UI
  description: string;                 // What context this provider injects
  icon?: string;                       // Lucide icon name for UI display
  defaultEnabled: boolean;             // Whether enabled by default in new recipes
  configSchema?: ProviderSettingDefinition[];
}

interface ProviderSettingDefinition {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "select";
  default: unknown;
  description?: string;
  options?: SelectOption[];            // For "select" type
}

interface ExtensionPermissions {
  database?: boolean;        // can create/read/write SQLite tables (project-scoped)
  network?: string[];        // URL patterns the extension can reach
  mcp?: boolean;             // can spawn/connect MCP servers
  hooks?: string[];          // which hook events it registers (e.g. ["sessionStart"])
  vault?: string[];          // Vault keys it needs access to
  filesystem?: boolean;      // can read/write files beyond its own directory
}

// Extension setting definition — drives auto-generated settings page in Console
interface SettingDefinition {
  key: string;               // setting key, e.g. "JIRA_BASE_URL"
  label: string;             // human-readable label
  type: "string" | "vault" | "number" | "boolean" | "select";
  required: boolean;
  description?: string;      // help text shown in settings page
  placeholder?: string;      // input placeholder
  default?: unknown;         // default value
  options?: SelectOption[];  // only for type "select"
}

interface SelectOption {
  label: string;
  value: string;
}

// One extension = one transport type
type MCPConfig = MCPStdioConfig | MCPSSEConfig;

interface MCPStdioConfig {
  transport: "stdio";
  command: string;           // e.g. "npx", "node", "python"
  args: string[];            // e.g. ["-y", "@modelcontextprotocol/server-github"]
  env?: Record<string, string>; // env vars, supports ${VAULT:key} references
}

interface MCPSSEConfig {
  transport: "sse";
  url: string;               // SSE endpoint URL, e.g. "https://figma-mcp.example.com/sse"
  headers?: Record<string, string>; // auth headers, supports ${VAULT:key} references
  reconnect?: boolean;       // auto-reconnect on disconnect (default true)
  reconnectIntervalMs?: number; // reconnect interval in ms (default 5000)
}

interface UIPage {
  id: string;                // unique page id within extension
  title: string;             // sidebar label
  path: string;              // route path segment, e.g. "issues"
  icon?: string;             // icon identifier
}

// Extension hook feature declaration (in manifest.json)
interface ExtensionHookConfig {
  features: HookFeature[];
}

interface HookFeature {
  event: HookEvent;
  feature: string;           // Feature name, becomes {ext-name}:{feature} in generated command
  description: string;       // Human-readable description
  timeoutSec?: number;       // Per-feature timeout (default: 5)
}

type HookEvent = "sessionStart" | "sessionEnd" | "userPromptSubmitted" |
                 "preToolUse" | "postToolUse" | "errorOccurred" |
                 "preCompact" | "subagentStart" | "subagentStop";

// Generated hook file schema (.github/hooks/renre-kit.json) — ADR-037
// Single merged file with core + extension features per event
interface GeneratedHookFile {
  version: number;           // schema version, currently 1
  hooks: Record<HookEvent, HookEntry[]>;
}

interface HookEntry {
  type: "command";
  bash: string;              // worker-service.cjs hook <agent> <feature>
  cwd?: string;              // working directory (default ".")
  timeoutSec?: number;       // execution timeout in seconds
  comment?: string;          // human-readable description
}

interface ActionDefinition {
  name: string;              // action path segment, e.g. "issues", "add"
  method: "GET" | "POST" | "PUT" | "DELETE";
  description: string;       // shown in `query <ext> --help`
}

interface SkillDefinition {
  name: string;              // skill directory name
  description: string;
}
```

### Project Metadata (`~/.renre-kit/projects/{project-id}.json`)
```typescript
interface ProjectMetadata {
  id: string;                // UUID
  name: string;              // human-readable project name
  path: string;              // absolute path to project root
  version: string;           // renre-kit version used to init
  createdAt: string;         // ISO date
  lastActiveAt: string;      // ISO date — updated on start
}
```

### Project Config (`.renre-kit/project.json`)
```typescript
// Created by `renre-kit init` — identifies this project to the CLI and worker service
interface ProjectConfig {
  id: string;                // UUID — used for route namespacing, DB scoping, CLI resolution
  name: string;              // human-readable project name (defaults to folder name)
}
```

### Project Extensions Config (`.renre-kit/extensions.json`)
```typescript
interface ProjectExtensions {
  extensions: InstalledExtension[];
}

interface InstalledExtension {
  name: string;              // extension id
  version: string;           // installed version
  source: "marketplace" | "local";
  marketplace?: string;      // marketplace name (e.g. "official", "company-internal")
  installedAt: string;       // ISO date
  settings?: Record<string, unknown>; // per-project extension settings
}
```

### Session (`~/.renre-kit/sessions/{session-id}.json`)
```typescript
// Sessions are created by the sessionStart hook event
// Tracked globally — can be expanded with richer metadata later
interface Session {
  id: string;                // UUID
  projectId: string;         // which project this session belongs to
  startedAt: string;         // ISO date
  endedAt?: string;          // ISO date — set on sessionEnd hook
  agent?: string;            // AI agent identifier (e.g. "copilot", "claude-code")
  status: "active" | "ended";
}
```

### Global Config (`~/.renre-kit/config.json`)
```typescript
interface GlobalConfig {
  serverPort: number;        // default 42888 (fallback: 42889-42898 on conflict)
  logLevel: "error" | "warn" | "info" | "debug"; // default "info"
  marketplaces: MarketplaceConfig[];
}

interface MarketplaceConfig {
  name: string;              // short identifier, e.g. "official", "company-internal"
  url: string;               // GitHub repo URL containing .renre-kit/marketplace.json
  default: boolean;          // used when no marketplace prefix specified
}

// Runtime server state — written by worker service, read by CLI
interface ServerState {
  pid: number;               // actual process PID
  port: number;              // actual port (may differ from config if conflict)
  startedAt: string;         // ISO date
  activeProjects: ActiveProject[];
}

interface ActiveProject {
  id: string;
  name: string;
  path: string;
  extensions: string[];      // mounted extension names
  registeredAt: string;      // ISO date
}
```

### Marketplace Index (`.renre-kit/marketplace.json` in marketplace repo)
```typescript
interface MarketplaceIndex {
  marketplace: {
    name: string;            // marketplace identifier
    description: string;     // human-readable description
    url: string;             // repo URL
  };
  version: string;           // schema version
  extensions: MarketplaceEntry[];
}

interface MarketplaceEntry {
  name: string;
  version: string;
  description: string;
  repository: string;        // GitHub repo URL (may differ from marketplace repo)
  path?: string;             // subdirectory path for built-in extensions
  tags: string[];
}
```

### CLI Install Pattern
```
// Pattern: [marketplace/]extension[@version]
// Examples:
//   jira-plugin              → default marketplace, latest
//   jira-plugin@1.0.0        → default marketplace, pinned
//   company/jira-plugin      → "company" marketplace, latest
//   company/jira-plugin@1.0  → "company" marketplace, pinned
//   --local /path/to/ext     → local filesystem
```

---

## Key Module Interfaces

### Extension Loader (Worker Service)
```typescript
// Each extension backend exports a router factory
type ExtensionRouterFactory = (context: ExtensionContext) => express.Router;

interface ExtensionContext {
  projectId: string;
  db: BetterSqlite3.Database;
  mcp?: MCPClient;           // MCP client if extension has mcp config
  logger: Logger;
  config: Record<string, unknown>;  // extension-specific config
}

// Extension Registry manages loaded extensions per project
interface ExtensionRegistry {
  mount(projectId: string, extensionName: string): Promise<void>;
  unmount(projectId: string, extensionName: string): void;
  unmountAll(projectId: string): void;
  getRouter(projectId: string, extensionName: string): express.Router | null;
  listMounted(projectId: string): string[];
}

// Vault — core feature, global secret store
// Secrets are global (not project-scoped) — set once, reuse across all projects
interface VaultResolver {
  // Resolve ${VAULT:key} references in a config object (used during extension mount)
  resolve(config: Record<string, unknown>): Record<string, unknown>;
  // Get a single secret value (internal use only — never exposed via HTTP)
  getSecret(key: string): string | null;
  // CRUD — called by Vault internal API routes
  setSecret(key: string, value: string): void;
  deleteSecret(key: string): void;
  listSecretKeys(): string[];  // keys only, never values
}

// Vault Internal API — routes used ONLY by Console UI (toolbar Vault page)
// These routes are NOT accessible to extensions — middleware blocks extension-context requests
// Secret values are NEVER returned in responses (only keys)
//
// Routes:
//   GET    /api/vault/keys           → list all secret keys (no values)
//   POST   /api/vault/secrets        → create/update a secret {key, value}
//   DELETE /api/vault/secrets/:key   → delete a secret
//
// The UI sends secret values via POST to store them; GET /keys only returns key names.
// There is no GET endpoint that returns secret values.

// Extension settings resolved at mount time (project-scoped config + global Vault)
interface ExtensionSettingsResolver {
  // Read extension settings from .renre-kit/extensions.json for a project
  getSettings(projectId: string, extensionName: string): Record<string, unknown>;
  // Save extension settings (called from Console extension settings page)
  saveSettings(projectId: string, extensionName: string, settings: Record<string, unknown>): void;
  // Resolve settings: replace ${VAULT:key} refs with Vault values, validate required fields
  resolveSettings(projectId: string, extensionName: string): Record<string, string>;
}
```

### DB Manager
```typescript
interface DBManager {
  getConnection(): BetterSqlite3.Database;
  runMigrations(extensionName: string, migrationsDir: string, projectId: string): void;
  rollbackMigrations(extensionName: string, migrationsDir: string, projectId: string): void;
  scopedQuery(projectId: string, sql: string, params?: unknown[]): unknown[];
}

// Migration tracking — stored in _migrations table
interface MigrationRecord {
  extension_name: string;
  version: string;           // e.g. "001"
  description: string;       // e.g. "create_issues_table"
  project_id: string;
  applied_at: string;        // ISO timestamp
}

// Migration files: {version}_{description}.up.sql / .down.sql
// Example: 001_create_issues_table.up.sql, 001_create_issues_table.down.sql
```

### Logger
```typescript
type LogLevel = "error" | "warn" | "info" | "debug";

interface Logger {
  error(source: string, message: string, meta?: Record<string, unknown>): void;
  warn(source: string, message: string, meta?: Record<string, unknown>): void;
  info(source: string, message: string, meta?: Record<string, unknown>): void;
  debug(source: string, message: string, meta?: Record<string, unknown>): void;
}

// General logs: ~/.renre-kit/logs/{YYYY-MM-DD}.txt (plain text)
// Error logs:   ~/.renre-kit/logs/error-{YYYY-MM-DD}.json (JSONL)
// Format: [ISO timestamp] [LEVEL] [source] message
// Secret values are NEVER logged — only key names

interface ErrorLogEntry {
  timestamp: string;
  source: string;              // e.g. "ext:jira-plugin", "console-ui", "mcp:github-mcp"
  projectId: string;
  type: "backend" | "ui" | "mcp" | "migration" | "hook";
  error: string;
  stack?: string;
  context?: Record<string, unknown>;
}
```

### CLI Query Proxy
```typescript
// renre-kit query <extension> <action> [--json] [-d <data>]
// Maps to: HTTP <METHOD> localhost:42888/api/{project-id}/<extension>/<action>

interface QueryOptions {
  extension: string;
  action: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  data?: string;             // JSON body for POST/PUT
  json: boolean;             // output format flag
}
```

### Intelligence & Hook Infrastructure

#### Hook Feature Registry
```typescript
// Central registry that merges core + extension hook features
// Core features registered at boot; extension features added/removed at mount/unmount
interface HookFeatureRegistry {
  registerCore(feature: string, event: HookEvent, handler: Function, timeoutMs: number): void;
  registerExtension(extensionName: string, hookFeature: HookFeature): void;
  unregisterExtension(extensionName: string): void;
  resolve(feature: string): RegisteredFeature | null;
  listByEvent(event: HookEvent): RegisteredFeature[];
}
```

#### Hook Request Queue
```typescript
// Serializes hook requests per project to prevent DB contention
interface HookRequestQueue {
  enqueue(req: HookRequest): Promise<HookResponse>;
}

interface HookRequest {
  batchId: string;
  feature: string;
  event: HookEvent;
  projectId: string;
  agent: string;
  input: Record<string, unknown>;
}
```

#### Event Bus
```typescript
// In-process event bus — emits SSE events to connected Console UI clients
interface EventBus {
  emit(event: SSEEventType, data: Record<string, unknown>): void;
  subscribe(handler: (event: SSEEvent) => void): () => void;
}

type SSEEventType =
  | "project:registered" | "project:unregistered"
  | "extension:mounted" | "extension:unmounted" | "extension:installed"
  | "extension:removed" | "extension:upgraded" | "extension:remounted" | "extension:error"
  | "mcp:connected" | "mcp:disconnected"
  | "vault:updated" | "updates:available"
  | "session:started" | "session:ended"
  | "observation:created" | "observation:updated"
  | "error:recorded" | "prompt:recorded"
  | "tool:used" | "tool:denied" | "hook:executed";

// Console UI connection state (ADR-045)
interface ConnectionStore {
  status: "connected" | "reconnecting" | "disconnected";
  lastConnectedAt: string | null;       // ISO timestamp
  reconnectAttempts: number;
  setStatus: (status: ConnectionStore["status"]) => void;
  incrementReconnectAttempts: () => void;
  resetReconnectAttempts: () => void;
}
```

#### Intelligence Services
```typescript
// Session memory — captures session summaries and injects learned context
interface SessionMemoryService {
  capture(sessionId: string, data: SessionEndData): Promise<void>;
  getContextForInjection(projectId: string): Promise<string>;
  createCheckpoint(sessionId: string, trigger: string): Promise<void>;
}

// Observations — project-level facts surfaced by agents, managed in Console UI
interface ObservationsService {
  create(obs: NewObservation): Promise<Observation>;
  list(projectId: string, filters?: ObservationFilters): Promise<Observation[]>;
  getForInjection(projectId: string): Promise<Observation[]>;
  archive(id: string): Promise<void>;
  confirm(id: string): Promise<void>;
}

// Tool governance — evaluate tool usage against allow/deny rules (ADR-039)
interface ToolGovernanceService {
  evaluate(tool: ToolUseInput): Promise<GovernanceDecision>;
  getRules(scope?: "global" | "project"): Promise<ToolRule[]>;
  auditDecision(decision: GovernanceDecision): Promise<void>;
}

// Prompt journal — records prompts for analytics and pattern detection
interface PromptJournalService {
  record(prompt: PromptInput): Promise<void>;
  getAnalytics(projectId: string): Promise<PromptAnalytics>;
}

// Error intelligence — tracks agent errors and surfaces recurring patterns
interface ErrorIntelligenceService {
  record(error: AgentError): Promise<void>;
  getPatterns(projectId: string): Promise<ErrorPattern[]>;
  resolvePattern(id: string, note: string): Promise<void>;
}

// Tool analytics — records tool usage and flags suspicious patterns
interface ToolAnalyticsService {
  record(usage: ToolUsageInput): Promise<void>;
  getSessionAnalytics(sessionId: string): Promise<ToolAnalytics>;
  getWarnings(projectId: string): Promise<ToolWarning[]>;
}

// Subagent tracking — records subagent spawn/stop for tree visualization
interface SubagentTrackingService {
  recordStart(event: SubagentStartEvent): Promise<string>;
  recordStop(event: SubagentStopEvent): Promise<void>;
  getTree(sessionId: string): Promise<SubagentTree>;
}

// Context recipe engine — assembles context from multiple providers (ADR-036)
interface ContextRecipeEngine {
  assemble(projectId: string, sessionInput: SessionInput): Promise<AssembledContext>;
  getProviders(projectId: string): Promise<ContextProvider[]>;
  preview(projectId: string): Promise<AssembledContext>;
}

// Full-text search across intelligence tables
interface FTSSearchService {
  search(projectId: string, query: string, tables?: string[]): Promise<SearchResult[]>;
  rebuild(table: string): Promise<void>;
}

// Database backup manager (ADR-042)
interface BackupManager {
  createBackup(reason: string): Promise<string>;
  listBackups(): Promise<BackupInfo[]>;
  restoreBackup(path: string): Promise<void>;
  pruneBackups(): Promise<number>;
}

// Context window monitor — tracks token usage per session
interface ContextMonitor {
  trackTokenUsage(sessionId: string, chars: number): void;
  getUsage(sessionId: string): ContextUsageInfo;
  shouldSuggestLearn(sessionId: string, agent: string): boolean;
}
```

---

## Core Database Tables

Intelligence tables created by core migration `002_hook_intelligence` (ADR-043).
Core migrations are tracked in `_migrations` with `extension_name = '__core__'`
and `project_id = '__global__'`. All tables use the shared `data.db` and are
scoped by `project_id`.

### `_sessions`
```sql
CREATE TABLE _sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  agent TEXT,
  status TEXT DEFAULT 'active',
  summary TEXT,
  files_modified TEXT,          -- JSON array
  decisions TEXT,               -- JSON array
  tool_count INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0,
  prompt_count INTEGER DEFAULT 0,
  context_injected TEXT
);
```

### Other Intelligence Tables
```sql
-- Session checkpoints (preCompact, manual triggers)
CREATE TABLE _session_checkpoints (id, session_id, trigger, summary, created_at);

-- Project-level observations surfaced by agents
CREATE TABLE _observations (id, project_id, session_id, category, content, status, confidence, created_at, confirmed_at);

-- Tool allow/deny rules (global or project-scoped)
CREATE TABLE _tool_rules (id, project_id, tool_pattern, action, reason, scope, created_at);

-- Tool governance audit log
CREATE TABLE _tool_audit (id, project_id, session_id, tool_name, decision, rule_id, input_summary, created_at);

-- Prompt journal entries
CREATE TABLE _prompts (id, project_id, session_id, agent, content_hash, char_count, category, created_at);

-- Agent errors captured by errorOccurred hook
CREATE TABLE _agent_errors (id, project_id, session_id, tool_name, error_message, error_type, created_at);

-- Recurring error patterns (derived from _agent_errors)
CREATE TABLE _error_patterns (id, project_id, pattern, occurrences, first_seen, last_seen, status, resolution_note);

-- Tool usage records (postToolUse hook)
CREATE TABLE _tool_usage (id, project_id, session_id, tool_name, duration_ms, success, created_at);

-- Subagent lifecycle events
CREATE TABLE _subagent_events (id, project_id, session_id, parent_session_id, agent, event_type, started_at, stopped_at);

-- Hook execution log (all hook invocations)
CREATE TABLE _hook_activity (id, project_id, session_id, event, feature, duration_ms, success, error, created_at);
```

---

## Directory Structures

### Global (`~/.renre-kit/`)
```
~/.renre-kit/
  config.json                  # global CLI config (port, logLevel, marketplaceUrl)
  data.db                     # shared SQLite DB (Vault + extension data + _migrations)
  server.pid                  # PID file for running server
  server.json                 # active projects list + actual port
  scripts/
    worker-service.cjs         # Hook entry point (ADR-026)
  backups/                       # Database backups (ADR-042)
    data-{timestamp}-pre-{operation}.db
  projects/
    {project-id}.json          # project metadata (name, path, timestamps)
  extensions/
    {extension-name}/
      {version}/               # version-pinned cache (e.g. 1.0.0/)
        manifest.json
        backend/
        ui/
        migrations/
          001_create_table.up.sql
          001_create_table.down.sql
  sessions/
    {session-id}.json          # session metadata (created by sessionStart hook)
  logs/
    {YYYY-MM-DD}.txt           # daily general log files (plain text)
    error-{YYYY-MM-DD}.json    # daily error log files (JSONL, structured)
  marketplace-cache.json       # cached marketplace index
```

### Per-Project (project root)
```
{project-root}/
  .renre-kit/
    project.json               # project ID + name (CLI resolution source)
    extensions.json            # installed extensions list + per-project settings
  .github/
    hooks/
      {extension-name}.json    # Copilot hook schema (worker-service.cjs commands)
    skills/
      {skill-name}/
        SKILL.md               # Skill definition
```
