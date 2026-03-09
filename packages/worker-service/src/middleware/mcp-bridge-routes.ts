import type { Request, Response, NextFunction } from "express";
import { getClient } from "../core/mcp-manager.js";
import { getMountedInfo } from "../core/extension-registry.js";
import { getRegistry as getProjectRegistry } from "../routes/projects.js";
import type { MCPClient } from "@renre-kit/extension-sdk";

const MCP_PATH_RE =
  /^\/api\/([^/]+)\/([^/]+)\/mcp\/(tools|call|resources|resource)$/;

export function mcpBridgeMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const match = MCP_PATH_RE.exec(req.path);
  if (!match) {
    next();
    return;
  }

  const projectId = match[1]!;
  const extensionName = match[2]!;
  const action = match[3]!;

  if (!getProjectRegistry().has(projectId)) {
    next();
    return;
  }

  const info = getMountedInfo(projectId, extensionName);
  if (!info?.manifest?.mcp) {
    next();
    return;
  }

  const client = getClient(projectId, extensionName);
  if (!client) {
    res.status(503).json({ error: "MCP not connected" });
    return;
  }

  void handleMcpAction(action, req, res, client);
}

async function handleMcpAction(
  action: string,
  req: Request,
  res: Response,
  client: MCPClient,
): Promise<void> {
  try {
    if (action === "tools") {
      const tools = await client.listTools();
      res.json({ tools });
    } else if (action === "call") {
      const { tool, arguments: args } = req.body as {
        tool: string;
        arguments: Record<string, unknown>;
      };
      const result = await client.callTool(tool, args ?? {});
      res.json({ result });
    } else if (action === "resources") {
      const resources = await client.listResources();
      res.json({ resources });
    } else if (action === "resource") {
      const uri = req.query["uri"] as string;
      if (!uri) {
        res.status(400).json({ error: "Missing uri parameter" });
        return;
      }
      // readResource is on MCPClientImpl but not in the public interface — cast
      const result = await (
        client as { readResource(uri: string): Promise<unknown> }
      ).readResource(uri);
      res.json({ result });
    } else {
      res.status(404).json({ error: "Unknown MCP action" });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: msg });
  }
}
