import type { Request, Response, NextFunction } from "express";
import { getMountedInfo, getRouter } from "../core/extension-registry.js";
import { getRegistry as getProjectRegistry } from "../routes/projects.js";
import { parseExtensionRoute, delegateToExtensionRouter } from "./delegate-to-extension.js";

const CONTEXT_ROUTE_RE = /^\/api\/([^/]+)\/([^/]+)\/__context$/;

/**
 * POST /api/{projectId}/{extensionName}/__context — Context Provider route (ADR-036)
 *
 * Forwards ContextRequest to extensions that declare a contextProvider in their manifest.
 * Returns ContextResponse { content, estimatedTokens, itemCount, truncated, metadata? }
 */
export function contextProviderRouteMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (req.method !== "POST") {
    next();
    return;
  }

  const parsed = parseExtensionRoute(req.path, CONTEXT_ROUTE_RE);
  if (!parsed) {
    next();
    return;
  }

  const { projectId, extensionName } = parsed;

  // Check project is registered
  const projectRegistry = getProjectRegistry();
  if (!projectRegistry.has(projectId)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  const info = getMountedInfo(projectId, extensionName);
  if (!info) {
    res.status(404).json({ error: `Extension ${extensionName} not mounted for project ${projectId}` });
    return;
  }

  // Verify the extension declares a contextProvider
  if (!info.manifest?.contextProvider) {
    res.status(400).json({ error: `Extension ${extensionName} does not declare a contextProvider` });
    return;
  }

  const extRouter = getRouter(projectId, extensionName);
  if (!extRouter) {
    res.status(404).json({ error: `Extension ${extensionName} router not available` });
    return;
  }

  delegateToExtensionRouter(req, res, next, extRouter, {
    extensionName,
    rewritePath: "/__context",
    errorLabel: "Context provider error",
  });
}
