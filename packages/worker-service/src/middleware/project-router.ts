import type { Request, Response, NextFunction } from "express";
import { getRouter } from "../core/extension-registry.js";
import { circuitBreaker } from "../core/extension-circuit-breaker.js";
import { extensionTimeout } from "./extension-timeout.js";
import { delegateToExtensionRouter } from "./delegate-to-extension.js";
import { getRegistry as getProjectRegistry } from "../routes/projects.js";

const REQUEST_TIMEOUT_MS = 30_000;

// Core API path segments that are NOT project IDs
const CORE_PATHS = new Set([
  "projects",
  "vault",
  "events",
  "errors",
  "backup",
  "server",
  "marketplace",
  "extensions",
  "health",
]);

export function projectRouterMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Match /api/{projectId}/{extensionName}/*
  const match = /^\/api\/([^/]+)\/([^/]+)(\/.*)?$/.exec(req.path);
  if (!match) {
    next();
    return;
  }

  const projectId = match[1];
  const extensionName = match[2];

  if (!projectId || !extensionName || CORE_PATHS.has(projectId)) {
    next();
    return;
  }

  // Check project is registered in project registry
  const projectRegistry = getProjectRegistry();
  if (!projectRegistry.has(projectId)) {
    res.status(404).json({ error: "Project not found" });
    return;
  }

  // Check circuit breaker
  if (circuitBreaker.isSuspended(projectId, extensionName)) {
    const retryAfterSec = Math.ceil(
      circuitBreaker.retryAfterMs(projectId, extensionName) / 1000,
    );
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(503).json({
      error: "Extension suspended",
      message: `Extension ${extensionName} is temporarily suspended due to repeated errors`,
    });
    return;
  }

  // Get extension router
  const extRouter = getRouter(projectId, extensionName);
  if (!extRouter) {
    res.status(404).json({
      error: `Extension ${extensionName} not mounted for this project`,
    });
    return;
  }

  const subPath = match[3] ?? "/";

  // Apply timeout then delegate to extension router
  const timeoutMiddleware = extensionTimeout(REQUEST_TIMEOUT_MS);
  timeoutMiddleware(req, res, () => {
    delegateToExtensionRouter(req, res, next, extRouter, {
      extensionName,
      rewritePath: subPath,
      errorLabel: "Internal extension error",
      onError: () => circuitBreaker.recordError(projectId, extensionName),
      onSuccess: () => circuitBreaker.recordSuccess(projectId, extensionName),
    });
  });
}
