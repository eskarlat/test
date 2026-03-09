import type { HookEvent } from "@renre-kit/extension-sdk";
import type { HookFeatureResult } from "./hook-request-queue.js";

export type PermissionDecision = "allow" | "deny" | "ask";

export interface AggregatedHookResponse {
  decision?: PermissionDecision;
  additionalContext?: string;
  systemMessage?: string;
  continue?: boolean;
  observations?: unknown[];
}

export function aggregateResults(
  event: HookEvent,
  results: HookFeatureResult[],
): AggregatedHookResponse {
  const successful = results.filter((r) => r.success);

  if (event === "preToolUse") {
    return aggregatePermissions(successful);
  }

  if (event === "preCompact") {
    return aggregateCompact(successful);
  }

  if (isContextEvent(event)) {
    return aggregateContext(successful);
  }

  return {};
}

function isContextEvent(event: HookEvent): boolean {
  return event === "sessionStart" || event === "userPromptSubmitted" || event === "subagentStart";
}

function aggregatePermissions(results: HookFeatureResult[]): AggregatedHookResponse {
  let decision: PermissionDecision = "allow";
  for (const r of results) {
    const d = (r.output as Record<string, unknown>)?.decision as PermissionDecision | undefined;
    if (d === "deny") return { decision: "deny" };
    if (d === "ask") decision = "ask";
  }
  return { decision };
}

function aggregateCompact(results: HookFeatureResult[]): AggregatedHookResponse {
  const messages = results
    .map((r) => (r.output as Record<string, unknown>)?.systemMessage as string | undefined)
    .filter(Boolean);
  return {
    continue: true,
    systemMessage: messages.join("\n\n"),
  };
}

function aggregateContext(results: HookFeatureResult[]): AggregatedHookResponse {
  const contexts = results
    .map((r) => (r.output as Record<string, unknown>)?.additionalContext as string | undefined)
    .filter(Boolean);
  const observations = results.flatMap(
    (r) => ((r.output as Record<string, unknown>)?.observations as unknown[]) ?? [],
  );
  return {
    additionalContext: contexts.join("\n\n"),
    observations: observations.length > 0 ? observations : undefined,
  };
}
