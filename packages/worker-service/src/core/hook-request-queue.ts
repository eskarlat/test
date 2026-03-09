import type { HookEvent } from "@renre-kit/extension-sdk";
import { dbManager } from "./db-manager.js";
import { hookFeatureRegistry } from "./hook-feature-registry.js";
import { logger } from "./logger.js";
import { getServerPort } from "./server-port.js";
import { trackToolUse, trackPrompt, getUsage, markSuggested } from "./context-monitor.js";
import { startSession, checkpoint, recordHookActivity, buildPromptSummary } from "./session-memory.js";
import { record as recordPrompt } from "./prompt-journal.js";
import { evaluate as evaluateTool } from "./tool-governance.js";
import { record as recordToolUsage } from "./tool-analytics.js";
import { record as recordError } from "./error-intelligence.js";
import { recordStart as recordSubagentStart, recordStop as recordSubagentStop } from "./subagent-tracking.js";

export interface HookEnqueueRequest {
  batchId: string;
  feature: string;
  event: HookEvent;
  projectId: string;
  agent: string;
  input: unknown;
}

export interface HookFeatureResult {
  feature: string;
  success: boolean;
  output: unknown;
  durationMs: number;
  error?: string;
}

export interface HookBatch {
  batchId: string;
  event: HookEvent;
  projectId: string;
  agent: string;
  startedAt: number;
  results: Map<string, HookFeatureResult>;
  complete: boolean;
}

const BATCH_TTL_MS = 60_000;
const POLL_INTERVAL_MS = 10;

const batches = new Map<string, HookBatch>();

// In-memory session tracking: "${projectId}:${agent}" → sessionId
const activeSessions = new Map<string, string>();

function getSessionKey(projectId: string, agent: string): string {
  return `${projectId}:${agent}`;
}

/**
 * Recover active session ID from the database when the in-memory map is empty
 * (e.g., after a server restart mid-session).
 */
function resolveSessionId(sessionKey: string): string | undefined {
  const cached = activeSessions.get(sessionKey);
  if (cached) return cached;

  // Parse projectId:agent from sessionKey
  const colonIdx = sessionKey.indexOf(":");
  if (colonIdx < 0) return undefined;
  const projectId = sessionKey.slice(0, colonIdx);
  const agent = sessionKey.slice(colonIdx + 1);

  try {
    const db = dbManager.getConnection();
    const row = db
      .prepare(
        `SELECT id FROM _sessions
         WHERE project_id = ? AND agent = ? AND status = 'active'
         ORDER BY started_at DESC LIMIT 1`,
      )
      .get(projectId, agent) as { id: string } | undefined;
    if (row) {
      activeSessions.set(sessionKey, row.id);
      return row.id;
    }
  } catch {
    // non-fatal
  }
  return undefined;
}

function cleanStaleBatches(): void {
  const now = Date.now();
  for (const [id, batch] of batches) {
    if (now - batch.startedAt > BATCH_TTL_MS) {
      batches.delete(id);
    }
  }
}

async function executeExtensionFeature(
  feature: string,
  projectId: string,
  input: unknown,
): Promise<HookFeatureResult> {
  const start = Date.now();
  // feature format: "extensionName:event"
  const colonIdx = feature.indexOf(":");
  if (colonIdx < 0) {
    return { feature, success: false, output: null, durationMs: 0, error: "Invalid extension feature ID" };
  }
  const extensionName = feature.slice(0, colonIdx);
  const action = feature.slice(colonIdx + 1);
  const port = getServerPort();
  const url = `http://127.0.0.1:${port}/api/${projectId}/${extensionName}/__hooks/${action}`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(5000),
    });
    const output = res.ok ? await res.json() as unknown : null;
    return { feature, success: res.ok, output, durationMs: Date.now() - start };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { feature, success: false, output: null, durationMs: Date.now() - start, error: msg };
  }
}

const LEARN_TIP = "**Tip:** Use `/learn` to save this session's patterns as reusable skills.";

function maybeLearnTip(sessionId: string, agent: string): unknown {
  const usage = getUsage(sessionId, agent);
  if (usage.shouldSuggestLearn) {
    markSuggested(sessionId);
    return { additionalContext: LEARN_TIP };
  }
  return {};
}

async function handleContextInject(
  sessionKey: string,
  projectId: string,
  agent: string,
  input: unknown,
): Promise<unknown> {
  const inputObj = input as Record<string, unknown> | null ?? {};
  const source = typeof inputObj["source"] === "string" ? inputObj["source"] : undefined;
  const result = await Promise.resolve(startSession(projectId, agent, source));
  activeSessions.set(sessionKey, result.sessionId);
  return { additionalContext: result.additionalContext };
}

async function handleSessionCapture(
  sessionKey: string,
  input: unknown,
): Promise<unknown> {
  const sessionId = resolveSessionId(sessionKey);
  if (sessionId) {
    const inputObj = input as Record<string, unknown> | null ?? {};
    const explicit = typeof inputObj["summary"] === "string" ? inputObj["summary"] : undefined;
    // Don't end the session — the Stop hook fires after each agent response turn,
    // not at the end of the conversation. Ending here would orphan subsequent prompts.
    // Auto-generate summary from session data if agent didn't provide one.
    const summary = explicit ?? buildPromptSummary(sessionId);
    if (summary) {
      try {
        const db = dbManager.getConnection();
        db.prepare("UPDATE _sessions SET summary = ? WHERE id = ?").run(summary, sessionId);
      } catch {
        // non-fatal
      }
    }
    // Keep session active — don't delete from activeSessions
  }
  return {};
}

async function handlePromptJournal(
  sessionKey: string,
  projectId: string,
  agent: string,
  input: unknown,
): Promise<unknown> {
  const sessionId = resolveSessionId(sessionKey);
  const inputObj = input as Record<string, unknown> | null ?? {};
  const prompt = typeof inputObj["prompt"] === "string" ? inputObj["prompt"] : JSON.stringify(input);
  if (sessionId) {
    await Promise.resolve(recordPrompt(projectId, sessionId, prompt, agent));
    trackPrompt(sessionId, prompt);
  }
  return maybeLearnTip(sessionId ?? "", agent);
}

async function handleToolGovernance(
  sessionKey: string,
  projectId: string,
  input: unknown,
): Promise<unknown> {
  const sessionId = resolveSessionId(sessionKey);
  const inputObj = input as Record<string, unknown> | null ?? {};
  // Claude Code sends snake_case; fall back to camelCase for other agents
  const toolName =
    typeof inputObj["tool_name"] === "string" ? inputObj["tool_name"] :
    typeof inputObj["toolName"] === "string" ? inputObj["toolName"] : "unknown";
  const toolInput = JSON.stringify(inputObj["tool_input"] ?? inputObj["toolInput"] ?? {});
  const gov = await Promise.resolve(evaluateTool(projectId, sessionId ?? null, toolName, toolInput));
  if (gov.decision !== "allow") {
    return { permissionDecision: gov.decision, permissionDecisionReason: gov.reason ?? "" };
  }
  return {};
}

async function handleToolAnalytics(
  sessionKey: string,
  projectId: string,
  agent: string,
  input: unknown,
): Promise<unknown> {
  const sessionId = resolveSessionId(sessionKey);
  const inputObj = input as Record<string, unknown> | null ?? {};
  // Claude Code sends snake_case; fall back to camelCase for other agents
  const toolName =
    typeof inputObj["tool_name"] === "string" ? inputObj["tool_name"] :
    typeof inputObj["toolName"] === "string" ? inputObj["toolName"] : "unknown";
  const argsJson = JSON.stringify(inputObj["tool_input"] ?? inputObj["toolInput"] ?? {});
  const resultJson = JSON.stringify(inputObj["tool_response"] ?? inputObj["toolOutput"] ?? {});
  const durationMs = typeof inputObj["durationMs"] === "number" ? inputObj["durationMs"] : undefined;
  const success = typeof inputObj["success"] === "boolean" ? inputObj["success"] : true;
  if (sessionId) {
    await Promise.resolve(recordToolUsage(projectId, sessionId, toolName, argsJson, resultJson, durationMs, success));
    trackToolUse(sessionId, argsJson, resultJson);
  }
  return maybeLearnTip(sessionId ?? "", agent);
}

async function handleErrorIntelligence(
  sessionKey: string,
  projectId: string,
  input: unknown,
): Promise<unknown> {
  const sessionId = resolveSessionId(sessionKey);
  const inputObj = input as Record<string, unknown> | null ?? {};
  // Error may be flat (Claude Code: error_message) or nested (Copilot: error.message)
  const errorObj =
    typeof inputObj["error"] === "object" && inputObj["error"] !== null
      ? (inputObj["error"] as Record<string, unknown>)
      : null;
  const message =
    typeof inputObj["error_message"] === "string" ? inputObj["error_message"] :
    typeof inputObj["message"] === "string" ? inputObj["message"] :
    typeof errorObj?.["message"] === "string" ? errorObj["message"] : JSON.stringify(input);
  const errorType =
    typeof inputObj["error_type"] === "string" ? inputObj["error_type"] :
    typeof inputObj["errorType"] === "string" ? inputObj["errorType"] :
    typeof errorObj?.["name"] === "string" ? errorObj["name"] : "unknown";
  const stack =
    typeof inputObj["stack"] === "string" ? inputObj["stack"] :
    typeof errorObj?.["stack"] === "string" ? errorObj["stack"] : undefined;
  const toolName =
    typeof inputObj["tool_name"] === "string" ? inputObj["tool_name"] :
    typeof inputObj["toolName"] === "string" ? inputObj["toolName"] : undefined;
  if (sessionId) {
    await Promise.resolve(recordError(projectId, sessionId, errorType, message, stack, toolName));
  }
  return {};
}

async function handleSessionCheckpoint(
  sessionKey: string,
  projectId: string,
  input: unknown,
): Promise<unknown> {
  const sessionId = resolveSessionId(sessionKey);
  const inputObj = input as Record<string, unknown> | null ?? {};
  const customInstructions = typeof inputObj["custom_instructions"] === "string"
    ? inputObj["custom_instructions"]
    : undefined;
  if (sessionId) {
    // Update summary on compaction — good checkpoint moment
    const summary = buildPromptSummary(sessionId);
    if (summary) {
      try {
        const db = dbManager.getConnection();
        db.prepare("UPDATE _sessions SET summary = ? WHERE id = ?").run(summary, sessionId);
      } catch { /* non-fatal */ }
    }
  }
  const systemMessage = sessionId
    ? await Promise.resolve(checkpoint(sessionId, projectId, customInstructions))
    : "";
  return { continue: true, systemMessage };
}

async function handleSubagentTrack(
  sessionKey: string,
  projectId: string,
  input: unknown,
): Promise<unknown> {
  const sessionId = resolveSessionId(sessionKey);
  const inputObj = input as Record<string, unknown> | null ?? {};
  // Claude Code sends snake_case; fall back to camelCase for other agents
  const agentType =
    typeof inputObj["agent_type"] === "string" ? inputObj["agent_type"] :
    typeof inputObj["agentType"] === "string" ? inputObj["agentType"] : "unknown";
  const parentId =
    typeof inputObj["parent_agent_id"] === "string" ? inputObj["parent_agent_id"] :
    typeof inputObj["parentAgentId"] === "string" ? inputObj["parentAgentId"] : undefined;
  const result = await Promise.resolve(
    recordSubagentStart(projectId, sessionId ?? null, agentType, parentId, JSON.stringify(input)),
  );
  return { guidelines: result.guidelines };
}

async function handleSubagentComplete(
  sessionKey: string,
  projectId: string,
  input: unknown,
): Promise<unknown> {
  const sessionId = resolveSessionId(sessionKey);
  const inputObj = input as Record<string, unknown> | null ?? {};
  // Claude Code sends snake_case; fall back to camelCase for other agents
  const agentType =
    typeof inputObj["agent_type"] === "string" ? inputObj["agent_type"] :
    typeof inputObj["agentType"] === "string" ? inputObj["agentType"] : "unknown";
  const startId =
    typeof inputObj["start_event_id"] === "string" ? inputObj["start_event_id"] :
    typeof inputObj["startEventId"] === "string" ? inputObj["startEventId"] : undefined;
  await Promise.resolve(recordSubagentStop(projectId, sessionId ?? null, agentType, startId));
  return {};
}

async function executeCoreFeature(
  feature: string,
  projectId: string,
  agent: string,
  input: unknown,
  event: HookEvent,
): Promise<HookFeatureResult> {
  const start = Date.now();
  const sessionKey = getSessionKey(projectId, agent);
  let output: unknown;
  let featureError: string | undefined;

  try {
    switch (feature) {
      case "context-inject":
        output = await handleContextInject(sessionKey, projectId, agent, input);
        break;
      case "session-capture":
        output = await handleSessionCapture(sessionKey, input);
        break;
      case "prompt-journal":
        output = await handlePromptJournal(sessionKey, projectId, agent, input);
        break;
      case "tool-governance":
        output = await handleToolGovernance(sessionKey, projectId, input);
        break;
      case "tool-analytics":
        output = await handleToolAnalytics(sessionKey, projectId, agent, input);
        break;
      case "error-intelligence":
        output = await handleErrorIntelligence(sessionKey, projectId, input);
        break;
      case "session-checkpoint":
        output = await handleSessionCheckpoint(sessionKey, projectId, input);
        break;
      case "subagent-track":
        output = await handleSubagentTrack(sessionKey, projectId, input);
        break;
      case "subagent-complete":
        output = await handleSubagentComplete(sessionKey, projectId, input);
        break;
      default:
        output = {};
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    featureError = msg;
    output = {};
    logger.warn("hooks", `Core feature ${feature} error: ${msg}`);
  }

  const durationMs = Date.now() - start;
  const sessionId = resolveSessionId(sessionKey) ?? null;

  recordHookActivity(sessionId, projectId, event, feature, durationMs, !featureError, featureError, output);

  return { feature, success: !featureError, output, durationMs, error: featureError };
}

async function executeFeature(
  feature: string,
  projectId: string,
  agent: string,
  input: unknown,
  event: HookEvent,
): Promise<HookFeatureResult> {
  try {
    const featureDef = hookFeatureRegistry.resolve(feature);
    if (!featureDef) {
      return { feature, success: false, output: null, durationMs: 0, error: `Feature "${feature}" not registered` };
    }
    if (featureDef.type === "extension") {
      return executeExtensionFeature(feature, projectId, input);
    }
    return executeCoreFeature(feature, projectId, agent, input, event);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { feature, success: false, output: null, durationMs: 0, error: msg };
  }
}

async function processBatch(batch: HookBatch, features: string[], input: unknown): Promise<void> {
  try {
    const results = await Promise.allSettled(
      features.map((f) => executeFeature(f, batch.projectId, batch.agent, input, batch.event)),
    );
    for (const result of results) {
      if (result.status === "fulfilled") {
        batch.results.set(result.value.feature, result.value);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("hooks", `Batch ${batch.batchId} processing error: ${msg}`);
  } finally {
    batch.complete = true;
  }
}

async function waitForResult(batchId: string, feature: string, timeoutMs: number): Promise<HookFeatureResult> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const batch = batches.get(batchId);
    if (!batch) break;
    const result = batch.results.get(feature);
    if (result) return result;
    await new Promise<void>((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { feature, success: false, output: null, durationMs: timeoutMs, error: "Timeout waiting for result" };
}

export async function enqueueHook(req: HookEnqueueRequest): Promise<HookFeatureResult> {
  cleanStaleBatches();

  const featureDef = hookFeatureRegistry.resolve(req.feature);
  const timeoutMs = featureDef?.timeoutMs ?? 5000;

  let batch = batches.get(req.batchId);

  if (!batch) {
    batch = {
      batchId: req.batchId,
      event: req.event,
      projectId: req.projectId,
      agent: req.agent,
      startedAt: Date.now(),
      results: new Map(),
      complete: false,
    };
    batches.set(req.batchId, batch);

    const allFeatures = hookFeatureRegistry.listByEvent(req.event).map((f) => f.id);
    processBatch(batch, allFeatures, req.input).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("hooks", `Batch ${req.batchId} failed: ${msg}`);
    });
  }

  const cached = batch.results.get(req.feature);
  if (cached) return cached;

  return waitForResult(req.batchId, req.feature, timeoutMs);
}

export function getBatches(): HookBatch[] {
  return Array.from(batches.values());
}
