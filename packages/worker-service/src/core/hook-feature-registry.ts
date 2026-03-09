import type { HookEvent } from "@renre-kit/extension-sdk";

export interface HookFeature {
  id: string;
  event: HookEvent;
  type: "core" | "extension";
  extensionName?: string;
  timeoutMs: number;
}

export class HookFeatureRegistry {
  private features: HookFeature[] = [];

  registerCore(id: string, event: HookEvent, timeoutMs = 5000): void {
    this.features = this.features.filter((f) => f.id !== id);
    this.features.push({ id, event, type: "core", timeoutMs });
  }

  registerExtension(extensionName: string, event: HookEvent, action: string, timeoutMs = 5000): void {
    const id = `${extensionName}:${action}`;
    this.features = this.features.filter((f) => f.id !== id);
    this.features.push({ id, event, type: "extension", extensionName, timeoutMs });
  }

  unregisterExtension(extensionName: string): void {
    this.features = this.features.filter((f) => f.extensionName !== extensionName);
  }

  listByEvent(event: HookEvent): HookFeature[] {
    const core = this.features.filter((f) => f.event === event && f.type === "core");
    const exts = this.features.filter((f) => f.event === event && f.type === "extension");
    return [...core, ...exts];
  }

  resolve(id: string): HookFeature | null {
    return this.features.find((f) => f.id === id) ?? null;
  }

  listAll(): HookFeature[] {
    return [...this.features];
  }
}

export const hookFeatureRegistry = new HookFeatureRegistry();

const CORE_FEATURES: Array<[string, HookEvent]> = [
  ["context-inject",     "sessionStart"],
  ["session-capture",    "sessionEnd"],
  ["prompt-journal",     "userPromptSubmitted"],
  ["tool-governance",    "preToolUse"],
  ["tool-analytics",     "postToolUse"],
  ["error-intelligence", "errorOccurred"],
  ["session-checkpoint", "preCompact"],
  ["subagent-track",     "subagentStart"],
  ["subagent-complete",  "subagentStop"],
];

for (const [id, event] of CORE_FEATURES) {
  hookFeatureRegistry.registerCore(id, event);
}
