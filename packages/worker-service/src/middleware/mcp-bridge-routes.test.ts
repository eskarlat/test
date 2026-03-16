import { describe, it, expect, beforeEach, vi } from "vitest";
import express from "express";

const mocks = vi.hoisted(() => ({
  getClient: vi.fn().mockReturnValue(null),
  getMountedInfo: vi.fn().mockReturnValue(null),
  getProjectRegistry: vi.fn().mockReturnValue(new Map()),
}));

vi.mock("../core/mcp-manager.js", () => ({
  getClient: mocks.getClient,
}));

vi.mock("../core/extension-registry.js", () => ({
  getMountedInfo: mocks.getMountedInfo,
}));

vi.mock("../routes/projects.js", () => ({
  getRegistry: mocks.getProjectRegistry,
}));

import { mcpBridgeMiddleware } from "./mcp-bridge-routes.js";
import { request } from "../test-helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createApp(): express.Application {
  const app = express();
  app.use(express.json());
  app.use(mcpBridgeMiddleware);
  // Fallthrough handler for requests that pass through the middleware
  app.use((_req: express.Request, res: express.Response) => {
    res.status(418).json({ passedThrough: true });
  });
  return app;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mcpBridgeMiddleware", () => {
  let app: express.Application;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createApp();
  });

  it("passes through for non-MCP paths", async () => {
    const res = await request(app, "GET", "/api/p1/ext1/something-else");
    expect(res.status).toBe(418);
    expect((res.body as Record<string, unknown>)["passedThrough"]).toBe(true);
  });

  it("passes through when project is not registered", async () => {
    mocks.getProjectRegistry.mockReturnValue(new Map());

    const res = await request(app, "GET", "/api/p1/ext1/mcp/tools");
    expect(res.status).toBe(418);
  });

  it("passes through when extension has no MCP manifest", async () => {
    mocks.getProjectRegistry.mockReturnValue(new Map([["p1", { id: "p1" }]]));
    mocks.getMountedInfo.mockReturnValue({ manifest: {} });

    const res = await request(app, "GET", "/api/p1/ext1/mcp/tools");
    expect(res.status).toBe(418);
  });

  it("returns 503 when MCP client is not connected", async () => {
    mocks.getProjectRegistry.mockReturnValue(new Map([["p1", { id: "p1" }]]));
    mocks.getMountedInfo.mockReturnValue({ manifest: { mcp: { transport: "stdio" } } });
    mocks.getClient.mockReturnValue(null);

    const res = await request(app, "GET", "/api/p1/ext1/mcp/tools");
    expect(res.status).toBe(503);
    expect((res.body as Record<string, unknown>)["error"]).toBe("MCP not connected");
  });

  describe("with connected MCP client", () => {
    const mockClient = {
      listTools: vi.fn(),
      callTool: vi.fn(),
      listResources: vi.fn(),
      readResource: vi.fn(),
    };

    beforeEach(() => {
      mocks.getProjectRegistry.mockReturnValue(new Map([["p1", { id: "p1" }]]));
      mocks.getMountedInfo.mockReturnValue({ manifest: { mcp: { transport: "stdio" } } });
      mocks.getClient.mockReturnValue(mockClient);
    });

    it("handles tools action", async () => {
      mockClient.listTools.mockResolvedValue([{ name: "tool1" }]);

      const res = await request(app, "GET", "/api/p1/ext1/mcp/tools");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["tools"]).toEqual([{ name: "tool1" }]);
    });

    it("handles call action", async () => {
      mockClient.callTool.mockResolvedValue({ result: "done" });

      const res = await request(app, "POST", "/api/p1/ext1/mcp/call", {
        tool: "my-tool",
        arguments: { key: "value" },
      });
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["result"]).toEqual({ result: "done" });
      expect(mockClient.callTool).toHaveBeenCalledWith("my-tool", { key: "value" });
    });

    it("handles call action with missing arguments", async () => {
      mockClient.callTool.mockResolvedValue({ result: "ok" });

      const res = await request(app, "POST", "/api/p1/ext1/mcp/call", {
        tool: "my-tool",
      });
      expect(res.status).toBe(200);
      expect(mockClient.callTool).toHaveBeenCalledWith("my-tool", {});
    });

    it("handles resources action", async () => {
      mockClient.listResources.mockResolvedValue([{ uri: "file:///test" }]);

      const res = await request(app, "GET", "/api/p1/ext1/mcp/resources");
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["resources"]).toEqual([{ uri: "file:///test" }]);
    });

    it("handles resource action with uri parameter", async () => {
      mockClient.readResource.mockResolvedValue({ content: "data" });

      const res = await request(
        app,
        "GET",
        "/api/p1/ext1/mcp/resource?uri=file:///test.txt",
      );
      expect(res.status).toBe(200);
      expect((res.body as Record<string, unknown>)["result"]).toEqual({ content: "data" });
    });

    it("returns 400 for resource action without uri", async () => {
      const res = await request(app, "GET", "/api/p1/ext1/mcp/resource");
      expect(res.status).toBe(400);
      expect((res.body as Record<string, unknown>)["error"]).toBe("Missing uri parameter");
    });

    it("returns 500 when MCP client throws", async () => {
      mockClient.listTools.mockRejectedValue(new Error("MCP timeout"));

      const res = await request(app, "GET", "/api/p1/ext1/mcp/tools");
      expect(res.status).toBe(500);
      expect((res.body as Record<string, unknown>)["error"]).toBe("MCP timeout");
    });
  });
});
