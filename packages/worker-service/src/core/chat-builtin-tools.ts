import type { Tool } from "@github/copilot-sdk";
import { getRegistry as getProjectRegistry } from "../routes/projects.js";
import { listActiveSessions } from "./session-manager.js";
import * as observations from "./observations-service.js";
import * as toolGovernance from "./tool-governance.js";
import * as promptJournal from "./prompt-journal.js";
import * as errorIntelligence from "./error-intelligence.js";
import * as toolAnalytics from "./tool-analytics.js";
import { getRecipe, getRegisteredProviders } from "./context-recipe-engine.js";
import * as ftsSearch from "./fts-search-service.js";
import * as subagentTracking from "./subagent-tracking.js";
import { listMounted } from "./extension-registry.js";

type SearchResult = ftsSearch.SearchResult;

const TABLE_SEARCHERS: Record<string, (pid: string, q: string, lim: number) => SearchResult[]> = {
  prompts: ftsSearch.searchPrompts,
  observations: ftsSearch.searchObservations,
  errors: ftsSearch.searchErrors,
  sessions: ftsSearch.searchSessions,
};

function searchByTables(projectId: string, query: string, tables: string[], limit: number): SearchResult[] {
  const perTableLimit = Math.ceil(limit / tables.length);
  const results: SearchResult[] = [];
  for (const table of tables) {
    const searcher = TABLE_SEARCHERS[table];
    if (searcher) results.push(...searcher(projectId, query, perTableLimit));
  }
  return results.slice(0, limit);
}

/**
 * Registers the 11 built-in tools that are available in every Copilot SDK
 * chat session. Each tool queries existing RenRe Kit services and returns
 * structured data. Handlers catch all errors and return descriptive error
 * messages rather than throwing.
 */
export function registerBuiltinTools(projectId: string): Tool[] {
  return [
    // 1. get_project — Get current project info
    {
      name: "get_project",
      description:
        "Get information about the current project including name, path, and installed extensions",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      handler: async () => {
        try {
          const registry = getProjectRegistry();
          const project = registry.get(projectId);
          if (!project) {
            return { error: `Project ${projectId} not found in registry` };
          }
          return {
            id: project.id,
            name: project.name,
            path: project.path,
            extensionCount: project.extensionCount,
            registeredAt: project.registeredAt,
            lastActiveAt: project.lastActiveAt,
            mountedExtensions: project.mountedExtensions.map((ext) => ({
              name: ext.name,
              version: ext.version,
              status: ext.status,
            })),
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `Failed to get project info: ${msg}` };
        }
      },
    },

    // 2. get_sessions — List recent sessions
    {
      name: "get_sessions",
      description:
        "List recent AI agent sessions for this project with status, agent name, and summary",
      parameters: {
        type: "object",
        properties: {
          limit: {
            type: "number",
            description: "Maximum number of sessions to return (default 20)",
          },
        },
        additionalProperties: false,
      },
      handler: async (args: { limit?: number }) => {
        try {
          const limit = args.limit ?? 20;
          const sessions = listActiveSessions(projectId);
          return {
            sessions: sessions.slice(0, limit),
            count: Math.min(sessions.length, limit),
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `Failed to list sessions: ${msg}` };
        }
      },
    },

    // 3. get_observations — Get project observations
    {
      name: "get_observations",
      description:
        "Get project observations — patterns, notes, and reminders captured by extensions and AI sessions",
      parameters: {
        type: "object",
        properties: {
          activeOnly: {
            type: "boolean",
            description:
              "If true (default), return only active observations; if false, return all",
          },
        },
        additionalProperties: false,
      },
      handler: async (args: { activeOnly?: boolean }) => {
        try {
          const activeOnly = args.activeOnly ?? true;
          const items = observations.list(projectId, activeOnly);
          return {
            observations: items,
            count: items.length,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `Failed to get observations: ${msg}` };
        }
      },
    },

    // 4. get_tool_rules — Get active tool governance rules
    {
      name: "get_tool_rules",
      description:
        "Get active tool governance rules that control which tools are allowed, denied, or require approval",
      parameters: {
        type: "object",
        properties: {
          scope: {
            type: "string",
            description:
              'Filter by rule scope: "global" or "project". If omitted, returns both.',
            enum: ["global", "project"],
          },
        },
        additionalProperties: false,
      },
      handler: async (args: { scope?: "global" | "project" }) => {
        try {
          const rules = toolGovernance.listRules(args.scope, projectId);
          return {
            rules,
            count: rules.length,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `Failed to get tool rules: ${msg}` };
        }
      },
    },

    // 5. get_prompts — Search prompt journal
    {
      name: "get_prompts",
      description:
        "Search the prompt journal for past user prompts. Supports full-text search or returns recent prompts.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "Full-text search query (optional)",
          },
          limit: {
            type: "number",
            description: "Maximum number of prompts to return (default 20)",
          },
        },
        additionalProperties: false,
      },
      handler: async (args: { query?: string; limit?: number }) => {
        try {
          const limit = args.limit ?? 20;
          if (args.query) {
            const results = promptJournal.search(projectId, args.query);
            return {
              prompts: results.slice(0, limit),
              count: Math.min(results.length, limit),
            };
          }
          const results = promptJournal.list(projectId, limit);
          return {
            prompts: results,
            count: results.length,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `Failed to get prompts: ${msg}` };
        }
      },
    },

    // 6. get_errors — Get error patterns
    {
      name: "get_errors",
      description:
        "Get error patterns detected across sessions. Shows recurring errors with fingerprinting and occurrence counts.",
      parameters: {
        type: "object",
        properties: {
          activeOnly: {
            type: "boolean",
            description:
              "If true (default), return only active warnings (recurring, unresolved); if false, return all patterns",
          },
        },
        additionalProperties: false,
      },
      handler: async (args: { activeOnly?: boolean }) => {
        try {
          const activeOnly = args.activeOnly ?? true;
          const patterns = activeOnly
            ? errorIntelligence.getActiveWarnings(projectId)
            : errorIntelligence.listPatterns(projectId);
          return {
            patterns,
            count: patterns.length,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `Failed to get error patterns: ${msg}` };
        }
      },
    },

    // 7. get_tool_analytics — Get tool usage analytics
    {
      name: "get_tool_analytics",
      description:
        "Get tool usage analytics showing which tools are used most, success rates, and performance",
      parameters: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description:
              "If provided, return analytics scoped to a specific session; otherwise project-wide",
          },
        },
        additionalProperties: false,
      },
      handler: async (args: { sessionId?: string }) => {
        try {
          if (args.sessionId) {
            return toolAnalytics.getSessionAnalytics(projectId, args.sessionId);
          }
          return toolAnalytics.getAnalytics(projectId);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `Failed to get tool analytics: ${msg}` };
        }
      },
    },

    // 8. get_context_recipes — List context recipes
    {
      name: "get_context_recipes",
      description:
        "List context recipes that control what project context is injected into AI sessions",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      handler: async () => {
        try {
          const recipe = getRecipe(projectId);
          const providers = getRegisteredProviders().map((p) => ({
            id: p.id,
            name: p.name,
            description: p.description,
          }));
          return {
            recipe,
            registeredProviders: providers,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `Failed to get context recipes: ${msg}` };
        }
      },
    },

    // 9. search — Full-text search across all data
    {
      name: "search",
      description:
        "Full-text search across all project data including prompts, observations, errors, and sessions",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The search query string",
          },
          tables: {
            type: "array",
            items: {
              type: "string",
              enum: ["prompts", "observations", "errors", "sessions"],
            },
            description:
              "Limit search to specific tables (optional). If omitted, searches all tables.",
          },
          limit: {
            type: "number",
            description: "Maximum number of results to return (default 20)",
          },
        },
        required: ["query"],
        additionalProperties: false,
      },
      handler: async (args: { query: string; tables?: string[]; limit?: number }) => {
        try {
          if (!args.query || !args.query.trim()) {
            return { results: [], count: 0 };
          }
          const limit = args.limit ?? 20;
          const query = args.query.trim();

          const results = (args.tables && args.tables.length > 0)
            ? searchByTables(projectId, query, args.tables, limit)
            : ftsSearch.searchAll(projectId, query, limit);
          return { results, count: results.length };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `Full-text search failed: ${msg}` };
        }
      },
    },

    // 10. get_subagents — Get subagent history
    {
      name: "get_subagents",
      description:
        "Get subagent history showing spawned sub-agents, their types, durations, and parent relationships",
      parameters: {
        type: "object",
        properties: {
          sessionId: {
            type: "string",
            description:
              "If provided, return the subagent tree for a specific session; otherwise list recent events",
          },
          limit: {
            type: "number",
            description:
              "Maximum number of subagent events to return when not filtering by session (default 20)",
          },
        },
        additionalProperties: false,
      },
      handler: async (args: { sessionId?: string; limit?: number }) => {
        try {
          if (args.sessionId) {
            const tree = subagentTracking.getTree(projectId, args.sessionId);
            return {
              sessionId: args.sessionId,
              tree,
              count: tree.length,
            };
          }
          const limit = args.limit ?? 20;
          const events = subagentTracking.list(projectId, limit);
          return {
            events,
            count: events.length,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `Failed to get subagent history: ${msg}` };
        }
      },
    },

    // 11. get_extension_status — Get extension health status
    {
      name: "get_extension_status",
      description:
        "Get the health status of all installed extensions including mount state, route counts, and error information",
      parameters: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      handler: async () => {
        try {
          const extensions = listMounted(projectId);
          return {
            extensions,
            count: extensions.length,
            healthyCount: extensions.filter((e) => e.status === "mounted").length,
            failedCount: extensions.filter((e) => e.status === "failed").length,
            suspendedCount: extensions.filter((e) => e.status === "suspended").length,
          };
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return { error: `Failed to get extension status: ${msg}` };
        }
      },
    },
  ];
}

/**
 * Backward-compatible alias used by copilot-bridge.ts.
 */
export const getBuiltinTools = registerBuiltinTools;
