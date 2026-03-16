import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../core/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../core/event-bus.js", () => ({
  eventBus: { publish: vi.fn() },
}));

const mockListSecretKeys = vi.fn();
const mockSetSecret = vi.fn();
const mockDeleteSecret = vi.fn();
const mockGetSecret = vi.fn();

vi.mock("../core/vault-resolver.js", () => ({
  listSecretKeys: (...args: unknown[]) => mockListSecretKeys(...args),
  setSecret: (...args: unknown[]) => mockSetSecret(...args),
  deleteSecret: (...args: unknown[]) => mockDeleteSecret(...args),
  getSecret: (...args: unknown[]) => mockGetSecret(...args),
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./vault.js";

describe("vault routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockListSecretKeys.mockReturnValue(["API_KEY", "DB_PASSWORD"]);
    mockGetSecret.mockReturnValue("some-value");
    mockDeleteSecret.mockReturnValue(true);
    app = createTestApp(router);
  });

  describe("GET /api/vault/keys", () => {
    it("returns array of key names", async () => {
      const res = await request(app, "GET", "/api/vault/keys");
      expect(res.status).toBe(200);
      expect(res.body).toEqual(["API_KEY", "DB_PASSWORD"]);
    });

    it("returns 500 when listing fails", async () => {
      mockListSecretKeys.mockImplementation(() => {
        throw new Error("vault locked");
      });
      const res = await request(app, "GET", "/api/vault/keys");
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/vault/secrets", () => {
    it("with valid key/value returns ok", async () => {
      const res = await request(app, "POST", "/api/vault/secrets", {
        key: "MY_KEY",
        value: "my-value",
      });
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["ok"]).toBe(true);
      expect(mockSetSecret).toHaveBeenCalledWith("MY_KEY", "my-value");
    });

    it("without key returns 400", async () => {
      const res = await request(app, "POST", "/api/vault/secrets", {
        value: "my-value",
      });
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain("key");
    });

    it("with empty key returns 400", async () => {
      const res = await request(app, "POST", "/api/vault/secrets", {
        key: "  ",
        value: "my-value",
      });
      expect(res.status).toBe(400);
    });

    it("without value returns 400", async () => {
      const res = await request(app, "POST", "/api/vault/secrets", {
        key: "MY_KEY",
      });
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain("value");
    });

    it("returns 500 when setSecret throws", async () => {
      mockSetSecret.mockImplementation(() => {
        throw new Error("encryption failed");
      });
      const res = await request(app, "POST", "/api/vault/secrets", {
        key: "MY_KEY",
        value: "val",
      });
      expect(res.status).toBe(500);
    });
  });

  describe("DELETE /api/vault/secrets/:key", () => {
    it("returns ok when key is found", async () => {
      mockDeleteSecret.mockReturnValue(true);
      const res = await request(app, "DELETE", "/api/vault/secrets/MY_KEY");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["ok"]).toBe(true);
    });

    it("returns 404 when key is not found", async () => {
      mockDeleteSecret.mockReturnValue(false);
      const res = await request(app, "DELETE", "/api/vault/secrets/MISSING");
      expect(res.status).toBe(404);
    });

    it("returns 500 when deleteSecret throws", async () => {
      mockDeleteSecret.mockImplementation(() => {
        throw new Error("vault error");
      });
      const res = await request(app, "DELETE", "/api/vault/secrets/MY_KEY");
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/vault/secrets/:key/exists", () => {
    it("returns exists true when key exists", async () => {
      mockGetSecret.mockReturnValue("some-value");
      const res = await request(app, "GET", "/api/vault/secrets/MY_KEY/exists");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["exists"]).toBe(true);
    });

    it("returns exists false when key does not exist", async () => {
      mockGetSecret.mockReturnValue(null);
      const res = await request(
        app,
        "GET",
        "/api/vault/secrets/MISSING/exists",
      );
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["exists"]).toBe(false);
    });

    it("returns 500 when getSecret throws", async () => {
      mockGetSecret.mockImplementation(() => {
        throw new Error("vault error");
      });
      const res = await request(app, "GET", "/api/vault/secrets/MY_KEY/exists");
      expect(res.status).toBe(500);
    });
  });
});
