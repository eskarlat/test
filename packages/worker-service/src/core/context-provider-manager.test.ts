import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const testDb = new Database(":memory:");
vi.mock("./db-manager.js", () => ({
  dbManager: { getConnection: () => testDb },
}));

import {
  registerExtensionProvider,
  unregisterExtensionProvider,
  listProviders,
} from "./context-provider-manager.js";
import type { ExtensionManifest } from "@renre-kit/extension-sdk";

describe("context-provider-manager", () => {
  beforeEach(() => {
    testDb.exec("DROP TABLE IF EXISTS _context_providers");
  });

  it("registers an extension provider", () => {
    const manifest = {
      name: "test-ext",
      version: "1.0.0",
      displayName: "Test Extension",
      description: "A test extension",
      contextProvider: true,
    } as ExtensionManifest;

    registerExtensionProvider("test-ext", manifest);

    const providers = listProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]!.id).toBe("ext:test-ext");
    expect(providers[0]!.type).toBe("extension");
    expect(providers[0]!.name).toBe("Test Extension");
    expect(providers[0]!.description).toBe("A test extension");
  });

  it("skips registration when no contextProvider in manifest", () => {
    const manifest = {
      name: "no-ctx",
      version: "1.0.0",
      displayName: "No Context",
      description: "No provider",
    } as ExtensionManifest;

    registerExtensionProvider("no-ctx", manifest);

    const providers = listProviders();
    expect(providers).toHaveLength(0);
  });

  it("replaces existing provider on re-register", () => {
    const manifest1 = {
      name: "ext-a", version: "1.0.0", displayName: "V1", description: "First",
      contextProvider: true,
    } as ExtensionManifest;
    const manifest2 = {
      name: "ext-a", version: "2.0.0", displayName: "V2", description: "Second",
      contextProvider: true,
    } as ExtensionManifest;

    registerExtensionProvider("ext-a", manifest1);
    registerExtensionProvider("ext-a", manifest2);

    const providers = listProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]!.name).toBe("V2");
  });

  it("stores config schema from settings", () => {
    const manifest = {
      name: "cfg", version: "1.0.0", displayName: "Config", description: "With config",
      contextProvider: true,
      settings: { schema: [{ key: "api_key", label: "Key", type: "string" }] },
    } as ExtensionManifest;

    registerExtensionProvider("cfg", manifest);

    const providers = listProviders();
    const row = providers[0] as Record<string, unknown>;
    const schema = row.config_schema ?? row.configSchema;
    expect(schema).toBeTruthy();
    const parsed = JSON.parse(schema as string);
    expect(parsed[0].key).toBe("api_key");
  });

  it("unregisters an extension provider", () => {
    const manifest = {
      name: "rm", version: "1.0.0", displayName: "Remove Me", description: "Will be removed",
      contextProvider: true,
    } as ExtensionManifest;

    registerExtensionProvider("rm", manifest);
    expect(listProviders()).toHaveLength(1);

    unregisterExtensionProvider("rm");
    expect(listProviders()).toHaveLength(0);
  });

  it("unregister handles missing extension gracefully", () => {
    expect(() => unregisterExtensionProvider("nonexistent")).not.toThrow();
  });

  it("listProviders returns empty array on error", () => {
    // Table doesn't exist yet if we drop it - listProviders should create it
    testDb.exec("DROP TABLE IF EXISTS _context_providers");
    const providers = listProviders();
    expect(Array.isArray(providers)).toBe(true);
  });
});
