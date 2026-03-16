import { describe, it, expect, beforeEach } from "vitest";
import {
  getToolIntent,
  registerExtensionToolIntent,
  clearExtensionToolIntents,
} from "./tool-intent";

describe("extension tool intent resolution (ADR-052 §1.6)", () => {
  beforeEach(() => {
    clearExtensionToolIntents();
  });

  it("uses built-in intent over extension for known tools", () => {
    registerExtensionToolIntent("Read", "Custom read {{file_path}}");
    // Built-in takes priority — shortenPath keeps short paths as-is
    expect(getToolIntent("Read", { file_path: "src/index.ts" })).toBe("Read src/index.ts");
  });

  it("resolves extension intent template with arguments", () => {
    registerExtensionToolIntent("deploy", "Deploy to {{environment}}");
    expect(getToolIntent("deploy", { environment: "staging" })).toBe("Deploy to staging");
  });

  it("uses argument key as fallback when value is missing", () => {
    registerExtensionToolIntent("deploy", "Deploy to {{environment}}");
    expect(getToolIntent("deploy", {})).toBe("Deploy to environment");
  });

  it("falls back to humanized name when no registration exists", () => {
    expect(getToolIntent("myCustomTool", { arg1: "value" })).toBe("My Custom Tool — value");
  });

  it("handles multiple template variables", () => {
    registerExtensionToolIntent("transfer", "Move {{source}} to {{destination}}");
    expect(getToolIntent("transfer", { source: "A", destination: "B" })).toBe("Move A to B");
  });

  it("clears registrations", () => {
    registerExtensionToolIntent("deploy", "Deploy to {{environment}}");
    clearExtensionToolIntents();
    // Should fall back to humanized name
    const result = getToolIntent("deploy", { environment: "prod" });
    expect(result).toBe("Deploy — prod");
  });
});
