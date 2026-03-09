import { dbManager } from "./db-manager.js";
import { logger } from "./logger.js";
import { eventBus } from "./event-bus.js";
import { listRules } from "./tool-governance.js";
import { getForInjection, markInjected } from "./observations-service.js";

export interface SubagentEvent {
  id: string;
  sessionId: string | null;
  projectId: string;
  eventType: "start" | "stop";
  agentType: string | null;
  parentAgentId: string | null;
  durationMs: number | null;
  guidelines: string | null;
  blockDecision: string | null;
  createdAt: string;
}

interface SubagentEventRow {
  id: string;
  session_id: string | null;
  project_id: string;
  event_type: string;
  agent_type: string | null;
  parent_agent_id: string | null;
  duration_ms: number | null;
  guidelines: string | null;
  block_decision: string | null;
  created_at: string;
}

export interface SubagentStartResult {
  eventId: string;
  guidelines: string;
}

function getDb() {
  return dbManager.getConnection();
}

function rowToEvent(row: SubagentEventRow): SubagentEvent {
  return {
    id: row.id,
    sessionId: row.session_id,
    projectId: row.project_id,
    eventType: row.event_type as "start" | "stop",
    agentType: row.agent_type,
    parentAgentId: row.parent_agent_id,
    durationMs: row.duration_ms,
    guidelines: row.guidelines,
    blockDecision: row.block_decision,
    createdAt: row.created_at,
  };
}

function buildGuidelines(projectId: string): string {
  const parts: string[] = ["## Subagent Guidelines"];

  const denyRules = listRules("project", projectId).filter(
    (r) => r.decision === "deny" && r.enabled,
  );
  if (denyRules.length > 0) {
    parts.push("\n### Tool Restrictions");
    for (const rule of denyRules.slice(0, 10)) {
      const suffix = rule.reason ? ` — ${rule.reason}` : "";
      parts.push(`- DENY: ${rule.pattern}${suffix}`);
    }
  }

  const observations = getForInjection(projectId, 5);
  if (observations.length > 0) {
    parts.push("\n### Project Observations");
    for (const obs of observations) {
      parts.push(`- [${obs.category}] ${obs.content}`);
    }
    markInjected(observations.map((o) => o.id));
  }

  return parts.join("\n");
}

export function recordStart(
  projectId: string,
  sessionId: string | null,
  agentType: string,
  parentAgentId?: string,
  _input?: string,
): SubagentStartResult {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const guidelines = buildGuidelines(projectId);

  try {
    getDb()
      .prepare(
        `INSERT INTO _subagent_events
           (id, session_id, project_id, event_type, agent_type, parent_agent_id,
            guidelines, created_at)
         VALUES (?, ?, ?, 'start', ?, ?, ?, ?)`,
      )
      .run(id, sessionId, projectId, agentType, parentAgentId ?? null, guidelines, now);

    eventBus.publish("subagent:started", { projectId, sessionId, agentType, eventId: id });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("subagent-tracking", `Failed to record subagent start: ${msg}`);
  }

  return { eventId: id, guidelines };
}

export function recordStop(
  projectId: string,
  sessionId: string | null,
  agentType: string,
  startId?: string,
  _output?: string,
  blockDecision?: string,
): void {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  let durationMs: number | null = null;

  if (startId) {
    try {
      const startRow = getDb()
        .prepare("SELECT created_at FROM _subagent_events WHERE id = ?")
        .get(startId) as { created_at: string } | undefined;
      if (startRow) {
        durationMs = Date.now() - new Date(startRow.created_at).getTime();
      }
    } catch {
      // non-fatal
    }
  }

  try {
    getDb()
      .prepare(
        `INSERT INTO _subagent_events
           (id, session_id, project_id, event_type, agent_type, parent_agent_id,
            duration_ms, block_decision, created_at)
         VALUES (?, ?, ?, 'stop', ?, NULL, ?, ?, ?)`,
      )
      .run(id, sessionId, projectId, agentType, durationMs, blockDecision ?? null, now);

    eventBus.publish("subagent:stopped", { projectId, sessionId, agentType, eventId: id, durationMs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("subagent-tracking", `Failed to record subagent stop: ${msg}`);
  }
}

export function list(projectId: string, limit = 50): SubagentEvent[] {
  try {
    return (
      getDb()
        .prepare(
          "SELECT * FROM _subagent_events WHERE project_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(projectId, limit) as SubagentEventRow[]
    ).map(rowToEvent);
  } catch {
    return [];
  }
}

interface TreeNode extends SubagentEvent {
  children: TreeNode[];
}

export function getTree(projectId: string, sessionId: string): TreeNode[] {
  try {
    const rows = (
      getDb()
        .prepare(
          "SELECT * FROM _subagent_events WHERE project_id = ? AND session_id = ? AND event_type = 'start' ORDER BY created_at ASC",
        )
        .all(projectId, sessionId) as SubagentEventRow[]
    ).map(rowToEvent);

    const nodeMap = new Map<string, TreeNode>();
    for (const event of rows) {
      nodeMap.set(event.id, { ...event, children: [] });
    }

    const roots: TreeNode[] = [];
    for (const node of nodeMap.values()) {
      if (node.parentAgentId && nodeMap.has(node.parentAgentId)) {
        const parent = nodeMap.get(node.parentAgentId);
        if (parent) parent.children.push(node);
      } else {
        roots.push(node);
      }
    }
    return roots;
  } catch {
    return [];
  }
}

export function analytics(projectId: string): {
  byType: Record<string, number>;
  avgDuration: number;
  total: number;
} {
  try {
    const byTypeRows = getDb()
      .prepare(
        `SELECT agent_type, COUNT(*) as cnt FROM _subagent_events
         WHERE project_id = ? AND event_type = 'start' AND agent_type IS NOT NULL
         GROUP BY agent_type`,
      )
      .all(projectId) as Array<{ agent_type: string; cnt: number }>;

    const byType: Record<string, number> = {};
    let total = 0;
    for (const r of byTypeRows) {
      byType[r.agent_type] = r.cnt;
      total += r.cnt;
    }

    const durationRow = getDb()
      .prepare(
        "SELECT AVG(duration_ms) as avg FROM _subagent_events WHERE project_id = ? AND event_type = 'stop' AND duration_ms IS NOT NULL",
      )
      .get(projectId) as { avg: number | null };

    return { byType, avgDuration: durationRow.avg ?? 0, total };
  } catch {
    return { byType: {}, avgDuration: 0, total: 0 };
  }
}
