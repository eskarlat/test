import type { Request, Response, NextFunction } from "express";
import { getMountedInfo, getRouter } from "../core/extension-registry.js";
import { logger } from "../core/logger.js";
import { getRegistry as getProjectRegistry } from "../routes/projects.js";

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

  const match = /^\/api\/([^/]+)\/([^/]+)\/__context$/.exec(req.path);
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

  // Delegate to the extension router at /__context
  const extRouter = getRouter(projectId, extensionName);
  if (!extRouter) {
    res.status(404).json({ error: `Extension ${extensionName} router not available` });
    return;
  }

  // Rewrite URL to /__context and delegate to extension router
  const originalUrl = req.url;
  req.url = "/__context";

  try {
    extRouter(req, res, (err?: unknown) => {
      req.url = originalUrl;
      if (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`ext:${extensionName}`, `Context provider error: ${msg}`);
        if (!res.headersSent) {
          res.status(500).json({ error: "Context provider error" });
        }
      } else {
        next();
      }
    });
  } catch (err) {
    req.url = originalUrl;
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`ext:${extensionName}`, `Context provider uncaught error: ${msg}`);
    if (!res.headersSent) {
      res.status(500).json({ error: "Context provider error" });
    }
  }
}
