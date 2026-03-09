import { dbManager } from "../db-manager.js";
import type { ContextProvider, ContextResult } from "../context-recipe-engine.js";
import { buildResult } from "./build-result.js";

interface PatternRow {
  message_template: string;
  occurrence_count: number;
}

export const errorPatternsProvider: ContextProvider = {
  id: "error-patterns",
  name: "Error Patterns",
  description: "Recurring error patterns (3+ occurrences) to warn agents about known issues before they encounter them.",
  async getContext(projectId: string, _config: Record<string, unknown>, tokenBudget: number): Promise<ContextResult> {
    const maxChars = tokenBudget * 4;
    try {
      const rows = dbManager
        .getConnection()
        .prepare(
          `SELECT message_template, occurrence_count FROM _error_patterns
           WHERE project_id = ? AND status = 'active' AND occurrence_count >= 3
           ORDER BY occurrence_count DESC
           LIMIT 10`,
        )
        .all(projectId) as PatternRow[];

      if (rows.length === 0) {
        return { content: "", estimatedTokens: 0, itemCount: 0, truncated: false };
      }

      const lines = rows.map(
        (r) => `- **${r.message_template}** (${r.occurrence_count} occurrences)`,
      );
      const content = `## Known Error Patterns\n${lines.join("\n")}\n`;
      return buildResult(content, maxChars, rows.length);
    } catch {
      return { content: "", estimatedTokens: 0, itemCount: 0, truncated: false };
    }
  },
};
