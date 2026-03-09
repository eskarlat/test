import { dbManager } from "./db-manager.js";
import { logger } from "./logger.js";
import { eventBus } from "./event-bus.js";

export type IntentCategory = "bug-fix" | "feature" | "refactor" | "question" | "test" | "general";

export interface PromptRecord {
  id: string;
  sessionId: string | null;
  projectId: string;
  promptPreview: string;
  intentCategory: IntentCategory;
  contextInjected: boolean;
  agent: string | null;
  createdAt: string;
}

interface PromptRow {
  id: string;
  session_id: string | null;
  project_id: string;
  prompt_preview: string;
  intent_category: string;
  context_injected: number;
  agent: string | null;
  created_at: string;
}

function getDb() {
  return dbManager.getConnection();
}

function rowToRecord(row: PromptRow): PromptRecord {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectId: row.project_id,
    promptPreview: row.prompt_preview,
    intentCategory: row.intent_category as IntentCategory,
    contextInjected: row.context_injected === 1,
    agent: row.agent,
    createdAt: row.created_at,
  };
}

const INTENT_PATTERNS: Array<{ category: IntentCategory; patterns: RegExp[] }> = [
  {
    category: "bug-fix",
    patterns: [/\b(?:fix|error|bug|broken|crash|failing|wrong|incorrect)\b/i],
  },
  {
    category: "feature",
    patterns: [/\b(?:add|implement|create|build|new feature|develop)\b/i],
  },
  {
    category: "refactor",
    patterns: [/\b(?:refactor|clean up|improve|reorganize|restructure|simplify)\b/i],
  },
  {
    category: "question",
    patterns: [/^(?:what|how|why|explain|describe|tell me|can you|could you)/i],
  },
  {
    category: "test",
    patterns: [/\b(?:test|spec|coverage|unit test|integration test|e2e)\b/i],
  },
];

function detectIntentCategory(prompt: string): IntentCategory {
  for (const entry of INTENT_PATTERNS) {
    for (const pattern of entry.patterns) {
      if (pattern.test(prompt)) return entry.category;
    }
  }
  return "general";
}

export function record(
  projectId: string,
  sessionId: string | null,
  prompt: string,
  agent?: string,
): PromptRecord | null {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const preview = prompt.slice(0, 200);
  const intentCategory = detectIntentCategory(prompt);

  try {
    getDb()
      .prepare(
        `INSERT INTO _prompts
           (id, session_id, project_id, prompt_preview, intent_category, context_injected, agent, created_at)
         VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(id, sessionId, projectId, preview, intentCategory, agent ?? null, now);

    if (sessionId) {
      getDb()
        .prepare("UPDATE _sessions SET prompt_count = prompt_count + 1 WHERE id = ?")
        .run(sessionId);
    }

    const row = getDb()
      .prepare("SELECT * FROM _prompts WHERE id = ?")
      .get(id) as PromptRow | undefined;

    eventBus.publish("prompt:recorded", { projectId, promptId: id, intentCategory });
    return row ? rowToRecord(row) : null;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("prompt-journal", `Failed to record prompt: ${msg}`);
    return null;
  }
}

export function list(
  projectId: string,
  limit = 50,
  offset = 0,
): PromptRecord[] {
  try {
    return (
      getDb()
        .prepare(
          "SELECT * FROM _prompts WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .all(projectId, limit, offset) as PromptRow[]
    ).map(rowToRecord);
  } catch {
    return [];
  }
}

export function analytics(projectId: string): {
  total: number;
  byCategory: Record<string, number>;
  recentCount: number;
} {
  try {
    const rows = getDb()
      .prepare(
        "SELECT intent_category, COUNT(*) as cnt FROM _prompts WHERE project_id = ? GROUP BY intent_category",
      )
      .all(projectId) as Array<{ intent_category: string; cnt: number }>;

    const byCategory: Record<string, number> = {};
    let total = 0;
    for (const row of rows) {
      byCategory[row.intent_category] = row.cnt;
      total += row.cnt;
    }

    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const recentRow = getDb()
      .prepare("SELECT COUNT(*) as cnt FROM _prompts WHERE project_id = ? AND created_at > ?")
      .get(projectId, sevenDaysAgo) as { cnt: number };

    return { total, byCategory, recentCount: recentRow.cnt };
  } catch {
    return { total: 0, byCategory: {}, recentCount: 0 };
  }
}

export function search(projectId: string, q: string): PromptRecord[] {
  const sanitized = q.replace(/["*()]/g, " ").trim();
  if (!sanitized) return [];

  try {
    const rows = getDb()
      .prepare(
        `SELECT p.* FROM _prompts p
         JOIN _prompts_fts fts ON fts.rowid = p.rowid
         WHERE fts._prompts_fts MATCH ? AND p.project_id = ?
         ORDER BY rank
         LIMIT 20`,
      )
      .all(sanitized, projectId) as PromptRow[];
    return rows.map(rowToRecord);
  } catch {
    // Fallback to LIKE
    try {
      const rows = getDb()
        .prepare(
          "SELECT * FROM _prompts WHERE project_id = ? AND prompt_preview LIKE ? ORDER BY created_at DESC LIMIT 20",
        )
        .all(projectId, `%${sanitized}%`) as PromptRow[];
      return rows.map(rowToRecord);
    } catch {
      return [];
    }
  }
}

export function purgeOld(days = 30): number {
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  try {
    const result = getDb()
      .prepare("DELETE FROM _prompts WHERE created_at < ?")
      .run(cutoff);
    return result.changes;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("prompt-journal", `Failed to purge old prompts: ${msg}`);
    return 0;
  }
}

export function getStats(projectId: string): { count: number; byCategory: Record<string, number> } {
  const result = analytics(projectId);
  return { count: result.total, byCategory: result.byCategory };
}
