import type { ExtensionRouterFactory } from "@renre-kit/extension-sdk";
import { Router } from "express";

const factory: ExtensionRouterFactory = (context) => {
  const router = Router();
  const { mcp, logger } = context;

  // GET /tools — list Context7 MCP tools
  router.get("/tools", async (_req, res) => {
    if (!mcp) {
      res.status(503).json({ error: "MCP not connected" });
      return;
    }
    try {
      const tools = await mcp.listTools();
      res.json({ tools });
    } catch (err) {
      logger.error("Failed to list MCP tools", { error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /call — invoke a Context7 MCP tool
  router.post("/call", async (req, res) => {
    if (!mcp) {
      res.status(503).json({ error: "MCP not connected" });
      return;
    }
    const { tool, arguments: args } = req.body as {
      tool: string;
      arguments: Record<string, unknown>;
    };
    if (!tool) {
      res.status(400).json({ error: "Missing 'tool' in request body" });
      return;
    }
    try {
      const result = await mcp.callTool(tool, args ?? {});
      res.json({ result });
    } catch (err) {
      logger.error("Failed to call MCP tool", { tool, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /resources — list Context7 MCP resources
  router.get("/resources", async (_req, res) => {
    if (!mcp) {
      res.status(503).json({ error: "MCP not connected" });
      return;
    }
    try {
      const resources = await mcp.listResources();
      res.json({ resources });
    } catch (err) {
      logger.error("Failed to list MCP resources", { error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /resource?uri=... — read a specific Context7 MCP resource
  router.get("/resource", async (req, res) => {
    if (!mcp) {
      res.status(503).json({ error: "MCP not connected" });
      return;
    }
    const uri = req.query.uri as string;
    if (!uri) {
      res.status(400).json({ error: "Missing 'uri' query parameter" });
      return;
    }
    try {
      const data = await mcp.readResource(uri);
      res.json({ data });
    } catch (err) {
      logger.error("Failed to read MCP resource", { uri, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
};

export default factory;
