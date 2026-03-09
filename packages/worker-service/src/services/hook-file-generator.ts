import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { globalPaths } from "../core/paths.js";
import type { HookFeature } from "../core/hook-feature-registry.js";

/**
 * Hook entry matching GitHub Copilot's hook schema.
 */
interface HookEntry {
  type: "command";
  command: string;
}

// Mapping from internal camelCase event names to Copilot PascalCase event names
const EVENT_TO_COPILOT: Record<string, string> = {
  sessionStart: "SessionStart",
  sessionEnd: "Stop",
  userPromptSubmitted: "UserPromptSubmit",
  preToolUse: "PreToolUse",
  postToolUse: "PostToolUse",
  errorOccurred: "ErrorOccurred",
  preCompact: "PreCompact",
  subagentStart: "SubagentStart",
  subagentStop: "SubagentStop",
};

export function generateHookFile(projectPath: string, features: HookFeature[]): void {
  const hooksDir = join(projectPath, ".github", "hooks");
  mkdirSync(hooksDir, { recursive: true });

  const hooksFile = join(hooksDir, "renre-kit.json");
  const renreKitRoot = globalPaths().globalDir;
  const scriptPath = join(renreKitRoot, "scripts", "worker-service.cjs");

  const byEvent = new Map<string, HookEntry[]>();
  for (const feature of features) {
    const list = byEvent.get(feature.event) ?? [];
    list.push({
      type: "command",
      command: `node ${scriptPath} hook agent ${feature.event} ${feature.id}`,
    });
    byEvent.set(feature.event, list);
  }

  const hooks: Record<string, HookEntry[]> = {};
  for (const [event, entries] of byEvent) {
    const copilotEvent = EVENT_TO_COPILOT[event] ?? event;
    hooks[copilotEvent] = entries;
  }

  const output = { hooks };
  const json = JSON.stringify(output, null, 2) + "\n";
  JSON.parse(json); // validate
  writeFileSync(hooksFile, json, "utf8");
}
