// backend/src/index.ts
import { Router } from "express";
var factory = (context) => {
  const router = Router();
  const { mcp, logger } = context;
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
  router.post("/call", async (req, res) => {
    if (!mcp) {
      res.status(503).json({ error: "MCP not connected" });
      return;
    }
    const { tool, arguments: args } = req.body;
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
  router.get("/resource", async (req, res) => {
    if (!mcp) {
      res.status(503).json({ error: "MCP not connected" });
      return;
    }
    const uri = req.query.uri;
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
var src_default = factory;
export {
  src_default as default
};
//# sourceMappingURL=index.js.map