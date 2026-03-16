import { describe, it, expect, vi, beforeEach } from "vitest";
import Database from "better-sqlite3";

// Mock logger
vi.mock("./logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock event-bus
vi.mock("./event-bus.js", () => ({
  eventBus: { publish: vi.fn() },
}));

let db: InstanceType<typeof Database>;

vi.mock("./db-manager.js", () => ({
  dbManager: {
    getConnection: () => db,
  },
}));

// We use real encryption - import after mocks
import {
  getSecret,
  setSecret,
  deleteSecret,
  listSecretKeys,
  resolveVaultPlaceholders,
} from "./vault-resolver.js";
import { eventBus } from "./event-bus.js";

describe("vault-resolver", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db = new Database(":memory:");
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE _vault (
        key TEXT PRIMARY KEY,
        encrypted_value BLOB NOT NULL,
        iv TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
  });

  describe("setSecret / getSecret", () => {
    it("stores and retrieves a secret", () => {
      setSecret("api-key", "sk-12345");
      const value = getSecret("api-key");
      expect(value).toBe("sk-12345");
    });

    it("returns null for non-existent key", () => {
      expect(getSecret("missing")).toBeNull();
    });

    it("updates existing secret", () => {
      setSecret("token", "old-value");
      setSecret("token", "new-value");
      expect(getSecret("token")).toBe("new-value");
    });

    it("publishes event on set", () => {
      setSecret("key1", "val");
      expect(eventBus.publish).toHaveBeenCalledWith("vault:updated", { action: "set", key: "key1" });
    });
  });

  describe("deleteSecret", () => {
    it("deletes existing secret", () => {
      setSecret("to-delete", "value");
      const result = deleteSecret("to-delete");
      expect(result).toBe(true);
      expect(getSecret("to-delete")).toBeNull();
    });

    it("returns false for non-existent key", () => {
      expect(deleteSecret("missing")).toBe(false);
    });

    it("publishes event on delete", () => {
      setSecret("key", "val");
      vi.mocked(eventBus.publish).mockClear();
      deleteSecret("key");
      expect(eventBus.publish).toHaveBeenCalledWith("vault:updated", { action: "delete", key: "key" });
    });
  });

  describe("listSecretKeys", () => {
    it("returns empty array when no secrets", () => {
      expect(listSecretKeys()).toEqual([]);
    });

    it("returns sorted key names", () => {
      setSecret("zebra", "z");
      setSecret("alpha", "a");
      setSecret("middle", "m");
      expect(listSecretKeys()).toEqual(["alpha", "middle", "zebra"]);
    });
  });

  describe("resolveVaultPlaceholders", () => {
    it("passes through non-vault type keys", () => {
      const result = resolveVaultPlaceholders(
        { name: "test", count: "42" },
        [],
        [],
      );
      expect(result.name).toBe("test");
      expect(result.count).toBe("42");
    });

    it("resolves vault placeholders", () => {
      setSecret("my-token", "secret-123");
      const result = resolveVaultPlaceholders(
        { token: "${VAULT:my-token}" },
        ["my-token"],
        ["token"],
      );
      expect(result.token).toBe("secret-123");
    });

    it("throws when vault key not in allowed list", () => {
      expect(() =>
        resolveVaultPlaceholders(
          { token: "${VAULT:unauthorized}" },
          [],
          ["token"],
        ),
      ).toThrow("does not declare it in permissions.vault");
    });

    it("throws when vault key not found", () => {
      expect(() =>
        resolveVaultPlaceholders(
          { token: "${VAULT:missing}" },
          ["missing"],
          ["token"],
        ),
      ).toThrow('Vault key "missing" not found');
    });

    it("converts non-string values to string", () => {
      const result = resolveVaultPlaceholders(
        { count: 42 },
        [],
        [],
      );
      expect(result.count).toBe("42");
    });

    it("does not resolve vault placeholders in non-vault-type keys", () => {
      setSecret("my-token", "secret");
      const result = resolveVaultPlaceholders(
        { name: "${VAULT:my-token}" },
        ["my-token"],
        [], // name is not a vault-type key
      );
      expect(result.name).toBe("${VAULT:my-token}");
    });
  });
});
