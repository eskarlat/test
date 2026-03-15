import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../core/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import express from "express";
import { createServer } from "node:http";
import worktreeRouter, { setWorktreeManager } from "./worktrees.js";
import type { WorktreeManager } from "../core/worktree-manager.js";

function createApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use(worktreeRouter);
  return app;
}

async function request(
  app: express.Application,
  method: "GET" | "POST" | "PUT" | "DELETE",
  url: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Failed to start server"));
        return;
      }
      const port = addr.port;
      const options: RequestInit = {
        method,
        headers: { "Content-Type": "application/json" },
      };
      if (body !== undefined) {
        options.body = JSON.stringify(body);
      }
      fetch(`http://localhost:${port}${url}`, options)
        .then(async (res) => {
          let responseBody: unknown;
          const text = await res.text();
          try {
            responseBody = JSON.parse(text);
          } catch {
            responseBody = text || undefined;
          }
          server.close();
          resolve({ status: res.status, body: responseBody });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
}

const sampleWorktree = {
  id: "wt-1",
  projectId: "proj-1",
  path: "/tmp/wt-1",
  branch: "feature-x",
  status: "ready",
  createdBy: { type: "user" },
  createdAt: "2025-01-01T00:00:00.000Z",
  lastAccessedAt: "2025-01-01T00:00:00.000Z",
  cleanupPolicy: "never",
  diskUsageBytes: 1024,
};

function createMockManager(): WorktreeManager {
  return {
    list: vi.fn().mockResolvedValue([sampleWorktree]),
    create: vi.fn().mockResolvedValue(sampleWorktree),
    get: vi.fn().mockResolvedValue(sampleWorktree),
    remove: vi.fn().mockResolvedValue(undefined),
    runCleanup: vi.fn().mockResolvedValue({ removed: 1, freedBytes: 512, errors: [] }),
    totalDiskUsage: vi.fn().mockReturnValue(2048),
    updateDiskUsage: vi.fn().mockResolvedValue(1024),
  } as unknown as WorktreeManager;
}

describe("worktree routes", () => {
  let app: express.Application;
  let mockManager: WorktreeManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mockManager = createMockManager();
    setWorktreeManager(mockManager);
    app = createApp();
  });

  describe("GET /api/:pid/worktrees", () => {
    it("returns list of worktrees", async () => {
      const res = await request(app, "GET", "/api/proj-1/worktrees");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
      expect(body[0]!["id"]).toBe("wt-1");
    });

    it("returns 500 on error", async () => {
      (mockManager.list as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("db error"));
      const res = await request(app, "GET", "/api/proj-1/worktrees");
      expect(res.status).toBe(500);
    });
  });

  describe("POST /api/:pid/worktrees", () => {
    it("creates worktree with valid input", async () => {
      const body = {
        cleanupPolicy: "never",
        branch: "feature-y",
        createdBy: { type: "user" },
      };
      const res = await request(app, "POST", "/api/proj-1/worktrees", body);
      expect(res.status).toBe(201);
      expect((res.body as Record<string, unknown>)["id"]).toBe("wt-1");
    });

    it("returns 400 when cleanupPolicy is missing", async () => {
      const body = { createdBy: { type: "user" }, branch: "x" };
      const res = await request(app, "POST", "/api/proj-1/worktrees", body);
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain("cleanupPolicy");
    });

    it("returns 400 when createdBy is missing", async () => {
      const body = { cleanupPolicy: "never", branch: "x" };
      const res = await request(app, "POST", "/api/proj-1/worktrees", body);
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain("createdBy");
    });

    it("returns 400 when createdBy.type is invalid", async () => {
      const body = {
        cleanupPolicy: "never",
        branch: "x",
        createdBy: { type: "invalid" },
      };
      const res = await request(app, "POST", "/api/proj-1/worktrees", body);
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain("createdBy.type");
    });

    it("returns 400 when branch missing for non-automation type", async () => {
      const body = {
        cleanupPolicy: "never",
        createdBy: { type: "user" },
      };
      const res = await request(app, "POST", "/api/proj-1/worktrees", body);
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain("branch");
    });

    it("allows automation type without branch", async () => {
      const body = {
        cleanupPolicy: "always",
        createdBy: { type: "automation", automationId: "a-1" },
      };
      const res = await request(app, "POST", "/api/proj-1/worktrees", body);
      expect(res.status).toBe(201);
    });

    it("returns 409 when branch already checked out", async () => {
      (mockManager.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("branch is already checked out"),
      );
      const body = {
        cleanupPolicy: "never",
        branch: "main",
        createdBy: { type: "user" },
      };
      const res = await request(app, "POST", "/api/proj-1/worktrees", body);
      expect(res.status).toBe(409);
    });

    it("returns 500 on unexpected error", async () => {
      (mockManager.create as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("unexpected"),
      );
      const body = {
        cleanupPolicy: "never",
        branch: "feature",
        createdBy: { type: "user" },
      };
      const res = await request(app, "POST", "/api/proj-1/worktrees", body);
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/:pid/worktrees/:id", () => {
    it("returns worktree by id", async () => {
      const res = await request(app, "GET", "/api/proj-1/worktrees/wt-1");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["id"]).toBe("wt-1");
    });

    it("returns 404 when not found", async () => {
      (mockManager.get as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Worktree not found"),
      );
      const res = await request(app, "GET", "/api/proj-1/worktrees/bad-id");
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/:pid/worktrees/:id", () => {
    it("removes worktree and returns 204", async () => {
      const res = await request(app, "DELETE", "/api/proj-1/worktrees/wt-1");
      expect(res.status).toBe(204);
    });

    it("returns 404 when not found", async () => {
      (mockManager.remove as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Worktree not found"),
      );
      const res = await request(app, "DELETE", "/api/proj-1/worktrees/bad-id");
      expect(res.status).toBe(404);
    });

    it("returns 409 when in use", async () => {
      (mockManager.remove as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Worktree is in_use"),
      );
      const res = await request(app, "DELETE", "/api/proj-1/worktrees/wt-1");
      expect(res.status).toBe(409);
    });
  });

  describe("GET /api/:pid/worktrees/:id/status", () => {
    it("returns worktree status info", async () => {
      const res = await request(app, "GET", "/api/proj-1/worktrees/wt-1/status");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["status"]).toBe("ready");
      expect(body["diskUsageBytes"]).toBe(1024);
    });

    it("returns 404 when not found", async () => {
      (mockManager.updateDiskUsage as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("Worktree not found"),
      );
      const res = await request(app, "GET", "/api/proj-1/worktrees/bad-id/status");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/:pid/worktrees/cleanup", () => {
    it("runs cleanup and returns result", async () => {
      const res = await request(app, "POST", "/api/proj-1/worktrees/cleanup");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["removed"]).toBe(1);
      expect(body["freedBytes"]).toBe(512);
    });

    it("returns 500 on cleanup error", async () => {
      (mockManager.runCleanup as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("cleanup failed"),
      );
      const res = await request(app, "POST", "/api/proj-1/worktrees/cleanup");
      expect(res.status).toBe(500);
    });
  });

  describe("GET /api/:pid/worktrees/disk-usage", () => {
    it("returns disk usage summary", async () => {
      const res = await request(app, "GET", "/api/proj-1/worktrees/disk-usage");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["totalBytes"]).toBe(2048);
      expect(body["worktreeCount"]).toBe(1);
    });
  });
});
