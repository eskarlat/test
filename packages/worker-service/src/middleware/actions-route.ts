import type { Request, Response, NextFunction } from "express";
import { getMountedInfo } from "../core/extension-registry.js";
import { parseExtensionRoute } from "./delegate-to-extension.js";

const ACTIONS_ROUTE_RE = /^\/api\/([^/]+)\/([^/]+)\/__actions$/;

export function actionsRouteMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Only handle GET /api/{projectId}/{extensionName}/__actions
  if (req.method !== "GET") {
    next();
    return;
  }

  const parsed = parseExtensionRoute(req.path, ACTIONS_ROUTE_RE);
  if (!parsed) {
    next();
    return;
  }

  const { projectId, extensionName } = parsed;

  const info = getMountedInfo(projectId, extensionName);
  if (!info) {
    res.status(404).json({ error: `Extension ${extensionName} not mounted for project ${projectId}` });
    return;
  }

  const actions = info.manifest?.backend?.actions ?? [];

  res.json({
    name: extensionName,
    version: info.version,
    actions,
  });
}
