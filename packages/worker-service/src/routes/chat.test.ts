import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock logger
vi.mock("../core/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock copilot-bridge — factory must not reference outer variables
vi.mock("../core/copilot-bridge.js", () => ({
  copilotBridge: {
    ensureStarted: vi.fn().mockResolvedValue(undefined),
    getStatus: vi.fn().mockReturnValue({ status: "ready" }),
    listModels: vi.fn().mockResolvedValue([
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet",
        capabilities: { supports: { reasoningEffort: true, vision: false } },
      },
    ]),
    createChatSession: vi.fn().mockResolvedValue("session-1"),
    listSessions: vi.fn().mockResolvedValue([{ id: "session-1", title: "Test" }]),
    getSessionMetadata: vi.fn().mockResolvedValue({ id: "session-1", title: "Test" }),
    deleteSession: vi.fn().mockResolvedValue(true),
    getSessionMessages: vi.fn().mockResolvedValue([
      {
        id: "msg-1",
        type: "user.message",
        timestamp: "2025-01-01T00:00:00.000Z",
        data: { content: "Hello" },
      },
      {
        id: "msg-2",
        type: "assistant.message",
        parentId: "msg-1",
        timestamp: "2025-01-01T00:00:01.000Z",
        data: { content: "Hi there" },
      },
    ]),
    resumeSession: vi.fn().mockResolvedValue({ sessionId: "session-1", status: "active" }),
  },
}));

import express from "express";
import { createServer } from "node:http";
import { chatRouter, projectChatRouter } from "./chat.js";
import { copilotBridge } from "../core/copilot-bridge.js";

// Cast for easy access to mock fns
const bridge = copilotBridge as unknown as Record<string, ReturnType<typeof vi.fn>>;

function createApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use(chatRouter);
  app.use(projectChatRouter);
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

describe("chat routes", () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    bridge["ensureStarted"].mockResolvedValue(undefined);
    bridge["getStatus"].mockReturnValue({ status: "ready" });
    bridge["listModels"].mockResolvedValue([
      {
        id: "claude-sonnet-4-20250514",
        name: "Claude Sonnet",
        capabilities: { supports: { reasoningEffort: true, vision: false } },
      },
    ]);
    bridge["createChatSession"].mockResolvedValue("session-1");
    bridge["listSessions"].mockResolvedValue([{ id: "session-1", title: "Test" }]);
    bridge["getSessionMetadata"].mockResolvedValue({ id: "session-1", title: "Test" });
    bridge["deleteSession"].mockResolvedValue(true);
    bridge["getSessionMessages"].mockResolvedValue([
      {
        id: "msg-1",
        type: "user.message",
        timestamp: "2025-01-01T00:00:00.000Z",
        data: { content: "Hello" },
      },
      {
        id: "msg-2",
        type: "assistant.message",
        parentId: "msg-1",
        timestamp: "2025-01-01T00:00:01.000Z",
        data: { content: "Hi there" },
      },
    ]);
    bridge["resumeSession"].mockResolvedValue({ sessionId: "session-1", status: "active" });
    app = createApp();
  });

  describe("GET /api/chat/status", () => {
    it("returns bridge status", async () => {
      const res = await request(app, "GET", "/api/chat/status");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["status"]).toBe("ready");
    });

    it("triggers lazy init if not-initialized", async () => {
      bridge["getStatus"].mockReturnValue({ status: "not-initialized" });
      const res = await request(app, "GET", "/api/chat/status");
      expect(res.status).toBe(200);
      expect(bridge["ensureStarted"]).toHaveBeenCalled();
    });
  });

  describe("GET /api/chat/models", () => {
    it("returns models in UI-friendly shape", async () => {
      const res = await request(app, "GET", "/api/chat/models");
      expect(res.status).toBe(200);
      const models = res.body as Array<Record<string, unknown>>;
      expect(models).toHaveLength(1);
      expect(models[0]!["id"]).toBe("claude-sonnet-4-20250514");
      expect(models[0]!["supportsReasoning"]).toBe(true);
      expect(models[0]!["supportsVision"]).toBe(false);
    });

    it("returns 503 when bridge is not ready", async () => {
      bridge["ensureStarted"].mockRejectedValue(new Error("not ready"));
      bridge["getStatus"].mockReturnValue({ status: "error" });
      const res = await request(app, "GET", "/api/chat/models");
      expect(res.status).toBe(503);
    });
  });

  describe("POST /api/:projectId/chat/sessions", () => {
    it("creates a chat session", async () => {
      const res = await request(app, "POST", "/api/proj-1/chat/sessions", {
        model: "claude-sonnet-4-20250514",
      });
      expect(res.status).toBe(201);
      expect((res.body as Record<string, unknown>)["sessionId"]).toBe("session-1");
    });

    it("returns 400 when model is missing", async () => {
      const res = await request(app, "POST", "/api/proj-1/chat/sessions", {});
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toContain("model");
    });

    it("returns 503 when bridge is not ready", async () => {
      bridge["ensureStarted"].mockRejectedValue(new Error("not ready"));
      bridge["getStatus"].mockReturnValue({ status: "error" });
      const res = await request(app, "POST", "/api/proj-1/chat/sessions", {
        model: "claude-sonnet-4-20250514",
      });
      expect(res.status).toBe(503);
    });
  });

  describe("GET /api/:projectId/chat/sessions", () => {
    it("returns sessions list", async () => {
      const res = await request(app, "GET", "/api/proj-1/chat/sessions");
      expect(res.status).toBe(200);
      const body = res.body as Array<Record<string, unknown>>;
      expect(body).toHaveLength(1);
    });
  });

  describe("GET /api/:projectId/chat/sessions/:sessionId", () => {
    it("returns session metadata", async () => {
      const res = await request(app, "GET", "/api/proj-1/chat/sessions/session-1");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["id"]).toBe("session-1");
    });

    it("returns 404 when session not found", async () => {
      bridge["getSessionMetadata"].mockResolvedValue(null);
      const res = await request(app, "GET", "/api/proj-1/chat/sessions/bad-id");
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/:projectId/chat/sessions/:sessionId", () => {
    it("deletes session", async () => {
      const res = await request(app, "DELETE", "/api/proj-1/chat/sessions/session-1");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["ok"]).toBe(true);
    });

    it("returns 404 when session not found", async () => {
      bridge["deleteSession"].mockResolvedValue(false);
      const res = await request(app, "DELETE", "/api/proj-1/chat/sessions/bad-id");
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/:projectId/chat/sessions/:sessionId/messages", () => {
    it("returns converted chat messages", async () => {
      const res = await request(app, "GET", "/api/proj-1/chat/sessions/session-1/messages");
      expect(res.status).toBe(200);
      const messages = res.body as Array<Record<string, unknown>>;
      expect(messages).toHaveLength(2);
      expect(messages[0]!["role"]).toBe("user");
      expect(messages[1]!["role"]).toBe("assistant");
      expect(messages[1]!["parentId"]).toBe("msg-1");
      const blocks = messages[0]!["blocks"] as Array<Record<string, unknown>>;
      expect(blocks[0]!["content"]).toBe("Hello");
    });

    it("returns 404 when session messages not found", async () => {
      bridge["getSessionMessages"].mockRejectedValue(new Error("Session not found"));
      const res = await request(app, "GET", "/api/proj-1/chat/sessions/bad-id/messages");
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/:projectId/chat/sessions/:sessionId/resume", () => {
    it("resumes session with messages", async () => {
      const res = await request(app, "POST", "/api/proj-1/chat/sessions/session-1/resume");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["sessionId"]).toBe("session-1");
      expect(body["status"]).toBe("active");
      const messages = body["messages"] as Array<Record<string, unknown>>;
      expect(messages).toHaveLength(2);
    });

    it("returns 404 when session not found", async () => {
      bridge["resumeSession"].mockResolvedValue(null);
      const res = await request(app, "POST", "/api/proj-1/chat/sessions/bad-id/resume");
      expect(res.status).toBe(404);
    });
  });
});
