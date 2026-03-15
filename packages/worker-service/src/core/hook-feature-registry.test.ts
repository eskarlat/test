import { describe, it, expect, beforeEach } from "vitest";
import { HookFeatureRegistry } from "./hook-feature-registry.js";

describe("HookFeatureRegistry", () => {
  let registry: HookFeatureRegistry;

  beforeEach(() => {
    registry = new HookFeatureRegistry();
  });

  it("registers and lists core features", () => {
    registry.registerCore("my-feature", "preToolUse");
    const features = registry.listByEvent("preToolUse");
    expect(features).toHaveLength(1);
    expect(features[0]!.id).toBe("my-feature");
    expect(features[0]!.type).toBe("core");
    expect(features[0]!.timeoutMs).toBe(5000);
  });

  it("registers with custom timeout", () => {
    registry.registerCore("fast", "sessionStart", 1000);
    expect(registry.resolve("fast")!.timeoutMs).toBe(1000);
  });

  it("replaces existing feature with same id", () => {
    registry.registerCore("dup", "preToolUse", 1000);
    registry.registerCore("dup", "postToolUse", 2000);
    expect(registry.listAll()).toHaveLength(1);
    expect(registry.resolve("dup")!.event).toBe("postToolUse");
    expect(registry.resolve("dup")!.timeoutMs).toBe(2000);
  });

  it("registers extension features", () => {
    registry.registerExtension("my-ext", "preToolUse", "check", 3000);
    const features = registry.listByEvent("preToolUse");
    expect(features).toHaveLength(1);
    expect(features[0]!.id).toBe("my-ext:check");
    expect(features[0]!.type).toBe("extension");
    expect(features[0]!.extensionName).toBe("my-ext");
  });

  it("unregisters all features for an extension", () => {
    registry.registerExtension("ext-a", "preToolUse", "check1");
    registry.registerExtension("ext-a", "postToolUse", "check2");
    registry.registerExtension("ext-b", "preToolUse", "other");
    registry.registerCore("core-1", "preToolUse");

    registry.unregisterExtension("ext-a");

    const all = registry.listAll();
    expect(all).toHaveLength(2);
    expect(all.map((f) => f.id).sort()).toEqual(["core-1", "ext-b:other"]);
  });

  it("listByEvent returns core before extension", () => {
    registry.registerExtension("ext", "preToolUse", "check");
    registry.registerCore("core", "preToolUse");

    const features = registry.listByEvent("preToolUse");
    expect(features[0]!.type).toBe("core");
    expect(features[1]!.type).toBe("extension");
  });

  it("listByEvent filters by event", () => {
    registry.registerCore("a", "preToolUse");
    registry.registerCore("b", "postToolUse");
    registry.registerCore("c", "sessionStart");

    expect(registry.listByEvent("preToolUse")).toHaveLength(1);
    expect(registry.listByEvent("postToolUse")).toHaveLength(1);
    expect(registry.listByEvent("errorOccurred")).toHaveLength(0);
  });

  it("resolve returns null for unknown id", () => {
    expect(registry.resolve("nope")).toBeNull();
  });

  it("resolve finds registered feature", () => {
    registry.registerCore("target", "sessionEnd");
    const f = registry.resolve("target");
    expect(f).not.toBeNull();
    expect(f!.event).toBe("sessionEnd");
  });

  it("listAll returns copy of all features", () => {
    registry.registerCore("a", "preToolUse");
    registry.registerCore("b", "postToolUse");
    const all = registry.listAll();
    expect(all).toHaveLength(2);
  });
});
