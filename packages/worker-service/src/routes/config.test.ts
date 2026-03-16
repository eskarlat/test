import { describe, it, expect, beforeEach, vi } from "vitest";

let mockConfigData: Record<string, unknown> = {};
let mockFileExists = true;

vi.mock("../core/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  setLogLevel: vi.fn(),
  getLogLevel: vi.fn(() => "info"),
}));

vi.mock("../core/paths.js", () => ({
  globalPaths: () => ({
    configFile: "/tmp/test-renre-kit/config.json",
  }),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => JSON.stringify(mockConfigData)),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(() => mockFileExists),
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./config.js";
import { writeFileSync } from "node:fs";
import { setLogLevel } from "../core/logger.js";

describe("config routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockConfigData = { logLevel: "info", marketplaces: [] };
    mockFileExists = true;
    app = createTestApp(router);
  });

  describe("GET /api/config", () => {
    it("returns config JSON with status 200", async () => {
      const res = await request(app, "GET", "/api/config");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["logLevel"]).toBe("info");
    });

    it("returns defaults when config file does not exist", async () => {
      mockFileExists = false;
      const res = await request(app, "GET", "/api/config");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["logLevel"]).toBe("info");
    });
  });

  describe("POST /api/config", () => {
    it("merges updates and returns ok", async () => {
      const res = await request(app, "POST", "/api/config", {
        logLevel: "debug",
      });
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["ok"]).toBe(true);
      expect(writeFileSync).toHaveBeenCalled();
    });

    it("applies valid log level immediately", async () => {
      await request(app, "POST", "/api/config", { logLevel: "debug" });
      expect(setLogLevel).toHaveBeenCalledWith("debug");
    });

    it("returns 500 when write fails", async () => {
      vi.mocked(writeFileSync).mockImplementation(() => {
        throw new Error("disk full");
      });
      const res = await request(app, "POST", "/api/config", {
        logLevel: "warn",
      });
      expect(res.status).toBe(500);
      expect((res.body as Record<string, unknown>)["error"]).toBeDefined();
    });
  });
});
