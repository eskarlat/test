import { describe, it, expect, beforeEach, vi } from "vitest";

let mockFileContent = "";
let mockFileExists = true;

vi.mock("../core/paths.js", () => ({
  globalPaths: () => ({
    logsDir: "/tmp/test-renre-kit/logs",
  }),
}));

vi.mock("node:fs", () => ({
  readFileSync: vi.fn(() => mockFileContent),
  existsSync: vi.fn(() => mockFileExists),
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./logs.js";

describe("logs routes", () => {
  let app: ReturnType<typeof createTestApp>;

  const sampleLines = [
    "[2025-06-01T10:00:00.000Z] [INFO] [worker] Server started",
    "[2025-06-01T10:01:00.000Z] [WARN] [ext:git] Rate limited",
    "[2025-06-01T10:02:00.000Z] [ERROR] [vault] Decryption failed",
    "[2025-06-01T10:03:00.000Z] [DEBUG] [cli] Verbose output",
  ].join("\n");

  beforeEach(() => {
    vi.clearAllMocks();
    mockFileContent = sampleLines;
    mockFileExists = true;
    app = createTestApp(router);
  });

  describe("GET /api/logs", () => {
    it("returns 200 with log entries", async () => {
      const res = await request(app, "GET", "/api/logs");
      expect(res.status).toBe(200);
      const entries = res.body as Array<Record<string, unknown>>;
      expect(entries.length).toBe(4);
    });

    it("returns most recent first", async () => {
      const res = await request(app, "GET", "/api/logs");
      const entries = res.body as Array<Record<string, unknown>>;
      expect(entries[0]!["source"]).toBe("cli");
      expect(entries[3]!["source"]).toBe("worker");
    });

    it("respects limit query parameter", async () => {
      const res = await request(app, "GET", "/api/logs?limit=2");
      const entries = res.body as Array<Record<string, unknown>>;
      expect(entries.length).toBe(2);
    });

    it("returns empty array when log file does not exist", async () => {
      mockFileExists = false;
      const res = await request(app, "GET", "/api/logs");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns empty array for unparseable content", async () => {
      mockFileContent = "this is not a valid log line\nneither is this";
      const res = await request(app, "GET", "/api/logs");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });
  });

  describe("GET /api/:projectId/logs", () => {
    it("returns 200 with log entries", async () => {
      const res = await request(app, "GET", "/api/proj-1/logs");
      expect(res.status).toBe(200);
      const entries = res.body as Array<Record<string, unknown>>;
      expect(entries.length).toBeGreaterThan(0);
    });

    it("respects limit query parameter", async () => {
      const res = await request(app, "GET", "/api/proj-1/logs?limit=1");
      const entries = res.body as Array<Record<string, unknown>>;
      expect(entries.length).toBe(1);
    });
  });
});
