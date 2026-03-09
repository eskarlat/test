import { dbManager } from "../db-manager.js";
import type { ContextProvider, ContextResult } from "../context-recipe-engine.js";
import { buildResult } from "./build-result.js";

interface ObsRow {
  id: string;
  content: string;
  category: string;
}

export const observationsProvider: ContextProvider = {
  id: "observations",
  name: "Observations",
  description: "Learned facts and patterns about the project, ranked by confidence. Helps agents avoid repeating mistakes.",
  async getContext(projectId: string, _config: Record<string, unknown>, tokenBudget: number): Promise<ContextResult> {
    const maxChars = tokenBudget * 4;
    try {
      const rows = dbManager
        .getConnection()
        .prepare(
          `SELECT id, content, category FROM _observations
           WHERE project_id = ? AND active = 1
           ORDER BY confidence DESC, injection_count ASC, created_at DESC
           LIMIT 20`,
        )
        .all(projectId) as ObsRow[];

      if (rows.length === 0) {
        return { content: "", estimatedTokens: 0, itemCount: 0, truncated: false };
      }

      const lines = rows.map((r) => `- [${r.category}] ${r.content}`);
      const content = `## Observations\n${lines.join("\n")}\n`;
      return buildResult(content, maxChars, rows.length);
    } catch {
      return { content: "", estimatedTokens: 0, itemCount: 0, truncated: false };
    }
  },
};
