import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../core/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./errors.js";
import { logger } from "../core/logger.js";

describe("errors routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp(router);
  });

  describe("POST /api/errors", () => {
    it("logs error and returns ok", async () => {
      const res = await request(app, "POST", "/api/errors", {
        source: "extension:git",
        type: "runtime",
        error: "Something broke",
        stack: "Error at line 42",
        context: { file: "index.ts" },
      });
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["ok"]).toBe(true);
      expect(logger.error).toHaveBeenCalledWith(
        "extension:git",
        "Something broke",
        expect.objectContaining({ type: "runtime" }),
      );
    });

    it("returns 400 when source is missing", async () => {
      const res = await request(app, "POST", "/api/errors", {
        error: "Something broke",
      });
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain(
        "source",
      );
    });

    it("returns 400 when error is missing", async () => {
      const res = await request(app, "POST", "/api/errors", {
        source: "cli",
      });
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain(
        "error",
      );
    });

    it("returns 400 when both source and error are missing", async () => {
      const res = await request(app, "POST", "/api/errors", {});
      expect(res.status).toBe(400);
    });

    it("accepts report without optional fields", async () => {
      const res = await request(app, "POST", "/api/errors", {
        source: "cli",
        type: "crash",
        error: "Unexpected failure",
      });
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["ok"]).toBe(true);
    });
  });
});
