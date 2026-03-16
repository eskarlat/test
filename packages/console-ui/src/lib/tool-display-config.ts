/**
 * Per-tool display configuration for standard mode (ADR-052 §1.5).
 * Defines which arguments to surface and how to summarize results.
 */

import type { ToolResult } from "../types/chat";

function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen - 3) + "...";
}

function countLines(s: string): number {
  if (!s) return 0;
  return s.split("\n").length;
}

export interface ToolDisplayConfig {
  /** Argument keys to show in standard mode (order matters, max 2) */
  keyArgs: string[];
  /** One-line result summary */
  resultSummary: (result: ToolResult) => string;
}

const TOOL_DISPLAY_CONFIGS: Record<string, ToolDisplayConfig> = {
  Read: {
    keyArgs: ["file_path"],
    resultSummary: (r) => `${countLines(r.content)} lines read`,
  },
  read_file: {
    keyArgs: ["file_path"],
    resultSummary: (r) => `${countLines(r.content)} lines read`,
  },
  Edit: {
    keyArgs: ["file_path"],
    resultSummary: (r) => (r.content.includes("✓") ? "Edit applied" : truncate(r.content, 60)),
  },
  edit_file: {
    keyArgs: ["file_path"],
    resultSummary: (r) => (r.content.includes("✓") ? "Edit applied" : truncate(r.content, 60)),
  },
  Write: {
    keyArgs: ["file_path"],
    resultSummary: () => "File written",
  },
  write_file: {
    keyArgs: ["file_path"],
    resultSummary: () => "File written",
  },
  Bash: {
    keyArgs: ["command"],
    resultSummary: (r) => truncate(r.content, 80),
  },
  Grep: {
    keyArgs: ["pattern", "path"],
    resultSummary: (r) => `${countLines(r.content)} matches`,
  },
  Glob: {
    keyArgs: ["pattern"],
    resultSummary: (r) => `${countLines(r.content)} files found`,
  },
  WebFetch: {
    keyArgs: ["url"],
    resultSummary: (r) => truncate(r.content, 60),
  },
  WebSearch: {
    keyArgs: ["query"],
    resultSummary: (r) => truncate(r.content, 60),
  },
  Agent: {
    keyArgs: ["description"],
    resultSummary: (r) => truncate(r.content, 60),
  },
};

const FALLBACK_CONFIG: ToolDisplayConfig = {
  keyArgs: [],
  resultSummary: (r) => {
    const firstLine = r.content.split("\n")[0] ?? "";
    return truncate(firstLine, 80);
  },
};

// ---------------------------------------------------------------------------
// Extension display config registration (ADR-052 §1.6)
// ---------------------------------------------------------------------------

const extensionDisplayConfigs = new Map<string, ToolDisplayConfig>();

/**
 * Register display config for an extension tool at mount time.
 * `keyArgs` specifies which argument keys to surface in standard mode.
 * `resultSummaryMode` — "short" uses first line of result content.
 */
export function registerExtensionToolDisplayConfig(
  toolName: string,
  config: { keyArgs?: string[]; resultSummary?: string },
): void {
  extensionDisplayConfigs.set(toolName, {
    keyArgs: config.keyArgs ?? [],
    resultSummary: config.resultSummary === "short"
      ? (r) => { const first = r.content.split("\n")[0] ?? ""; return truncate(first, 80); }
      : FALLBACK_CONFIG.resultSummary,
  });
}

/**
 * Clear all registered extension display configs (useful for testing or extension unload).
 */
export function clearExtensionToolDisplayConfigs(): void {
  extensionDisplayConfigs.clear();
}

/**
 * Get the display config for a tool. Resolution order:
 * built-in → extension manifest → fallback (ADR-052 §1.6).
 */
export function getToolDisplayConfig(toolName: string): ToolDisplayConfig {
  return TOOL_DISPLAY_CONFIGS[toolName]
    ?? extensionDisplayConfigs.get(toolName)
    ?? FALLBACK_CONFIG;
}
