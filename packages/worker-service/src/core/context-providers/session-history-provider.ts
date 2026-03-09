import { dbManager } from "../db-manager.js";
import type { ContextProvider, ContextResult } from "../context-recipe-engine.js";
import { buildResult } from "./build-result.js";

interface SessionRow {
  id: string;
  started_at: string;
  agent: string;
  summary: string | null;
  prompt_count: number;
  tool_count: number;
}

export const sessionHistoryProvider: ContextProvider = {
  id: "session-history",
  name: "Session History",
  description: "Recent agent sessions with summaries, prompt counts, and tool usage for continuity across conversations.",
  async getContext(projectId: string, _config: Record<string, unknown>, tokenBudget: number): Promise<ContextResult> {
    const maxChars = tokenBudget * 4;
    try {
      const rows = dbManager
        .getConnection()
        .prepare(
          `SELECT id, started_at, agent, summary, prompt_count, tool_count
           FROM _sessions
           WHERE project_id = ? AND archived = 0 AND status = 'ended' AND summary IS NOT NULL
           ORDER BY started_at DESC
           LIMIT 5`,
        )
        .all(projectId) as SessionRow[];

      if (rows.length === 0) {
        return { content: "", estimatedTokens: 0, itemCount: 0, truncated: false };
      }

      const lines = rows.map((r) => {
        const date = r.started_at.slice(0, 10);
        return `- Session on ${date} [${r.agent}]: ${r.summary} (${r.prompt_count} prompts, ${r.tool_count} tools)`;
      });

      const content = `## Recent Sessions\n${lines.join("\n")}\n`;
      return buildResult(content, maxChars, rows.length);
    } catch {
      return { content: "", estimatedTokens: 0, itemCount: 0, truncated: false };
    }
  },
};
