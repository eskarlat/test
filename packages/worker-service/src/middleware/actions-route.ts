import type { Request, Response, NextFunction } from "express";
import { getMountedInfo } from "../core/extension-registry.js";

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

  const match = /^\/api\/([^/]+)\/([^/]+)\/__actions$/.exec(req.path);
  if (!match) {
    next();
    return;
  }

  const projectId = match[1];
  const extensionName = match[2];

  if (!projectId || !extensionName) {
    next();
    return;
  }

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
