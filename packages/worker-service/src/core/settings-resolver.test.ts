import { describe, it, expect, vi } from "vitest";

// Mock vault-resolver since it depends on DB
vi.mock("./vault-resolver.js", () => ({
  resolveVaultPlaceholders: vi.fn(
    (settings: Record<string, unknown>, _allowedKeys: string[], _vaultTypeKeys: string[]) => {
      // Return settings as-is by default (passthrough)
      const result: Record<string, string> = {};
      for (const [k, v] of Object.entries(settings)) {
        result[k] = String(v);
      }
      return result;
    },
  ),
}));

import {
  resolveSettings,
  resolveSettingsWithValidation,
} from "./settings-resolver.js";

describe("settings-resolver", () => {
  describe("resolveSettings", () => {
    it("returns resolved settings for valid input", () => {
      const schema = [
        { key: "apiKey", type: "string" as const },
      ];
      const result = resolveSettings(schema, { apiKey: "my-key" });
      expect(result).toHaveProperty("apiKey", "my-key");
    });

    it("throws when required settings are missing", () => {
      const schema = [
        { key: "apiKey", type: "string" as const, required: true },
      ];
      expect(() => resolveSettings(schema, {})).toThrow(
        "missing required settings: apiKey",
      );
    });

    it("applies default values when not provided", () => {
      const schema = [
        { key: "timeout", type: "number" as const, default: 30 },
      ];
      const result = resolveSettings(schema, {});
      expect(result).toHaveProperty("timeout", "30");
    });

    it("uses provided value over default", () => {
      const schema = [
        { key: "timeout", type: "number" as const, default: 30 },
      ];
      const result = resolveSettings(schema, { timeout: 60 });
      expect(result).toHaveProperty("timeout", "60");
    });
  });

  describe("type validation", () => {
    it("validates number type - valid", () => {
      const schema = [{ key: "port", type: "number" as const }];
      const result = resolveSettings(schema, { port: "8080" });
      expect(result.port).toBe("8080");
    });

    it("validates number type - invalid throws", () => {
      const schema = [{ key: "port", type: "number" as const }];
      expect(() => resolveSettings(schema, { port: "abc" })).toThrow(
        'Setting "port" must be a number',
      );
    });

    it("validates boolean type - true", () => {
      const schema = [{ key: "enabled", type: "boolean" as const }];
      const result = resolveSettings(schema, { enabled: true });
      expect(result.enabled).toBe("true");
    });

    it("validates boolean type - string true", () => {
      const schema = [{ key: "enabled", type: "boolean" as const }];
      const result = resolveSettings(schema, { enabled: "true" });
      expect(result.enabled).toBe("true");
    });

    it("validates boolean type - false", () => {
      const schema = [{ key: "enabled", type: "boolean" as const }];
      const result = resolveSettings(schema, { enabled: false });
      expect(result.enabled).toBe("false");
    });

    it("validates boolean type - invalid throws", () => {
      const schema = [{ key: "enabled", type: "boolean" as const }];
      expect(() => resolveSettings(schema, { enabled: "yes" })).toThrow(
        'Setting "enabled" must be a boolean',
      );
    });

    it("validates select type - valid option", () => {
      const schema = [
        {
          key: "env",
          type: "select" as const,
          options: [
            { label: "Dev", value: "dev" },
            { label: "Prod", value: "prod" },
          ],
        },
      ];
      const result = resolveSettings(schema, { env: "dev" });
      expect(result.env).toBe("dev");
    });

    it("validates select type - invalid option throws", () => {
      const schema = [
        {
          key: "env",
          type: "select" as const,
          options: [
            { label: "Dev", value: "dev" },
            { label: "Prod", value: "prod" },
          ],
        },
      ];
      expect(() => resolveSettings(schema, { env: "staging" })).toThrow(
        'not in allowed options',
      );
    });
  });

  describe("resolveSettingsWithValidation", () => {
    it("returns missingRequired list without throwing", () => {
      const schema = [
        { key: "a", type: "string" as const, required: true },
        { key: "b", type: "string" as const, required: true },
      ];
      const result = resolveSettingsWithValidation(schema, {});
      expect(result.missingRequired).toEqual(["a", "b"]);
      expect(result.settings).toEqual({});
    });

    it("returns empty missingRequired when all provided", () => {
      const schema = [
        { key: "a", type: "string" as const, required: true },
      ];
      const result = resolveSettingsWithValidation(schema, { a: "value" });
      expect(result.missingRequired).toEqual([]);
      expect(result.settings.a).toBe("value");
    });

    it("treats empty string as missing", () => {
      const schema = [
        { key: "a", type: "string" as const, required: true },
      ];
      const result = resolveSettingsWithValidation(schema, { a: "" });
      expect(result.missingRequired).toEqual(["a"]);
    });

    it("treats null as missing", () => {
      const schema = [
        { key: "a", type: "string" as const, required: true },
      ];
      const result = resolveSettingsWithValidation(schema, { a: null });
      expect(result.missingRequired).toEqual(["a"]);
    });

    it("passes vault type keys to resolver", async () => {
      const { resolveVaultPlaceholders } = vi.mocked(
        await import("./vault-resolver.js"),
      );
      const schema = [
        { key: "token", type: "vault" as const },
        { key: "name", type: "string" as const },
      ];
      resolveSettingsWithValidation(schema, { token: "${VAULT:my-token}", name: "test" });
      expect(resolveVaultPlaceholders).toHaveBeenCalledWith(
        expect.any(Object),
        expect.any(Array),
        ["token"],
      );
    });
  });
});
