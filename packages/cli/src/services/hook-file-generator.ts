import { writeFileSync, mkdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { globalPaths } from "../utils/paths.js";

/**
 * Hook entry matching GitHub Copilot's hook schema.
 * See: https://docs.github.com/en/copilot/customizing-copilot/adding-hooks
 */
export interface HookEntry {
  type: "command";
  command: string;
}

/**
 * Generated hook file structure matching GitHub Copilot's expected format:
 * { hooks: { EventName: [{ type, command }] } }
 */
export interface GeneratedHookFile {
  hooks: Record<string, HookEntry[]>;
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

const CORE_FEATURES: Array<{ id: string; event: string }> = [
  { id: "context-inject",     event: "sessionStart" },
  { id: "session-capture",    event: "sessionEnd" },
  { id: "prompt-journal",     event: "userPromptSubmitted" },
  { id: "tool-governance",    event: "preToolUse" },
  { id: "tool-analytics",     event: "postToolUse" },
  { id: "error-intelligence", event: "errorOccurred" },
  { id: "session-checkpoint", event: "preCompact" },
  { id: "subagent-track",     event: "subagentStart" },
  { id: "subagent-complete",  event: "subagentStop" },
];

function buildCommand(scriptPath: string, event: string, featureId: string): string {
  return `node ${scriptPath} hook agent ${event} ${featureId}`;
}

export function generateCoreHookFile(projectDir: string): void {
  const { globalDir } = globalPaths();
  const scriptPath = join(globalDir, "scripts", "worker-service.cjs");
  const hooksDir = join(projectDir, ".github", "hooks");
  mkdirSync(hooksDir, { recursive: true });

  const byEvent = new Map<string, HookEntry[]>();
  for (const { id, event } of CORE_FEATURES) {
    const entry: HookEntry = { type: "command", command: buildCommand(scriptPath, event, id) };
    const list = byEvent.get(event) ?? [];
    list.push(entry);
    byEvent.set(event, list);
  }

  writeHookFile(join(hooksDir, "renre-kit.json"), byEvent);
}

export function addExtensionHooks(
  projectDir: string,
  extensionName: string,
  events: string[],
  action: string,
): void {
  const hooksFile = join(projectDir, ".github", "hooks", "renre-kit.json");
  const existing = readHookFile(hooksFile);
  const { globalDir } = globalPaths();
  const scriptPath = join(globalDir, "scripts", "worker-service.cjs");

  for (const event of events) {
    const eventHooks = existing.get(event) ?? [];
    const featureId = `${extensionName}:${action}`;
    const cmd = buildCommand(scriptPath, event, featureId);
    if (!eventHooks.some((h) => h.command === cmd)) {
      eventHooks.push({ type: "command", command: cmd });
    }
    existing.set(event, eventHooks);
  }

  writeHookFile(hooksFile, existing);
}

export function removeExtensionHooks(projectDir: string, extensionName: string): void {
  const hooksFile = join(projectDir, ".github", "hooks", "renre-kit.json");
  const existing = readHookFile(hooksFile);

  for (const [event, hooks] of existing) {
    existing.set(event, hooks.filter((h) => !h.command.includes(` ${extensionName}:`)));
  }

  writeHookFile(hooksFile, existing);
}

// Copilot PascalCase → our internal camelCase
const COPILOT_TO_EVENT: Record<string, string> = {};
for (const [internal, copilot] of Object.entries(EVENT_TO_COPILOT)) {
  COPILOT_TO_EVENT[copilot] = internal;
}

function readHookFile(filePath: string): Map<string, HookEntry[]> {
  const map = new Map<string, HookEntry[]>();
  if (!existsSync(filePath)) return map;
  try {
    const data = JSON.parse(readFileSync(filePath, "utf8")) as GeneratedHookFile;
    if (data.hooks && typeof data.hooks === "object" && !Array.isArray(data.hooks)) {
      // New Copilot-compatible format: { hooks: { EventName: [...] } }
      for (const [copilotEvent, entries] of Object.entries(data.hooks)) {
        const internalEvent = COPILOT_TO_EVENT[copilotEvent] ?? copilotEvent;
        map.set(internalEvent, entries);
      }
    }
  } catch {
    /* return empty map */
  }
  return map;
}

function writeHookFile(filePath: string, byEvent: Map<string, HookEntry[]>): void {
  const hooks: Record<string, HookEntry[]> = {};
  for (const [event, hookEntries] of byEvent) {
    const copilotEvent = EVENT_TO_COPILOT[event] ?? event;
    hooks[copilotEvent] = hookEntries;
  }
  const output: GeneratedHookFile = { hooks };
  const json = JSON.stringify(output, null, 2) + "\n";
  JSON.parse(json); // validate
  writeFileSync(filePath, json, "utf8");
}
