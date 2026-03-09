import { dbManager } from "../db-manager.js";
import type { ContextProvider, ContextResult } from "../context-recipe-engine.js";
import { buildResult } from "./build-result.js";

interface RuleRow {
  pattern: string;
  reason: string | null;
}

export const toolRulesProvider: ContextProvider = {
  id: "tool-rules",
  name: "Tool Governance Rules",
  description: "Active deny rules for tool usage. Tells agents which tools or patterns are blocked and why.",
  async getContext(projectId: string, _config: Record<string, unknown>, tokenBudget: number): Promise<ContextResult> {
    const maxChars = tokenBudget * 4;
    try {
      const rows = dbManager
        .getConnection()
        .prepare(
          `SELECT pattern, reason FROM _tool_rules
           WHERE enabled = 1 AND decision = 'deny'
             AND (scope = 'global' OR (scope = 'project' AND project_id = ?))
           ORDER BY priority DESC
           LIMIT 15`,
        )
        .all(projectId) as RuleRow[];

      if (rows.length === 0) {
        return { content: "", estimatedTokens: 0, itemCount: 0, truncated: false };
      }

      const lines = rows.map((r) => {
        const suffix = r.reason ? ` — ${r.reason}` : "";
        return `- DENY: ${r.pattern}${suffix}`;
      });
      const content = `## Tool Governance Rules\n${lines.join("\n")}\n`;
      return buildResult(content, maxChars, rows.length);
    } catch {
      return { content: "", estimatedTokens: 0, itemCount: 0, truncated: false };
    }
  },
};
