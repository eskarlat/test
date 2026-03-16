import { describe, it, expect, beforeEach } from "vitest";
import {
  getToolDisplayConfig,
  registerExtensionToolDisplayConfig,
  clearExtensionToolDisplayConfigs,
} from "./tool-display-config";

describe("extension tool display config resolution (ADR-052 §1.6)", () => {
  beforeEach(() => {
    clearExtensionToolDisplayConfigs();
  });

  it("returns built-in config for known tools", () => {
    registerExtensionToolDisplayConfig("Read", { keyArgs: ["custom"] });
    // Built-in takes priority
    const config = getToolDisplayConfig("Read");
    expect(config.keyArgs).toEqual(["file_path"]);
  });

  it("returns extension config for registered unknown tools", () => {
    registerExtensionToolDisplayConfig("deploy", {
      keyArgs: ["environment", "branch"],
      resultSummary: "short",
    });
    const config = getToolDisplayConfig("deploy");
    expect(config.keyArgs).toEqual(["environment", "branch"]);
    // "short" mode should use first line
    const summary = config.resultSummary({ content: "Deployed successfully\nMore details" });
    expect(summary).toBe("Deployed successfully");
  });

  it("falls back to default for unregistered tools", () => {
    const config = getToolDisplayConfig("unknownTool");
    expect(config.keyArgs).toEqual([]);
  });

  it("clears registrations", () => {
    registerExtensionToolDisplayConfig("deploy", { keyArgs: ["env"] });
    clearExtensionToolDisplayConfigs();
    const config = getToolDisplayConfig("deploy");
    expect(config.keyArgs).toEqual([]); // fallback
  });
});
