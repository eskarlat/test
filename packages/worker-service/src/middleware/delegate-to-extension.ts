import type { Request, Response, NextFunction, Router } from "express";
import { logger } from "../core/logger.js";

export interface ExtensionRouteMatch {
  projectId: string;
  extensionName: string;
}

/**
 * Parse projectId and extensionName from an extension-scoped route.
 * Returns null if the path doesn't match or params are missing.
 */
export function parseExtensionRoute(
  path: string,
  pattern: RegExp,
): ExtensionRouteMatch | null {
  const match = pattern.exec(path);
  if (!match) return null;
  const projectId = match[1];
  const extensionName = match[2];
  if (!projectId || !extensionName) return null;
  return { projectId, extensionName };
}

export interface DelegationOptions {
  extensionName: string;
  rewritePath: string;
  errorLabel?: string;
  onError?: () => void;
  onSuccess?: () => void;
}

/**
 * Delegates a request to an extension router with URL rewriting and error isolation.
 * Shared by project-router, context-provider-route, and similar middleware.
 */
export function delegateToExtensionRouter(
  req: Request,
  res: Response,
  next: NextFunction,
  extRouter: Router,
  opts: DelegationOptions,
): void {
  const label = opts.errorLabel ?? "Extension error";
  const originalUrl = req.url;
  req.url = opts.rewritePath;

  try {
    extRouter(req, res, (err?: unknown) => {
      req.url = originalUrl;
      if (err) {
        opts.onError?.();
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`ext:${opts.extensionName}`, `${label}: ${msg}`);
        if (!res.headersSent) {
          res.status(500).json({ error: label });
        }
      } else {
        opts.onSuccess?.();
        next();
      }
    });
  } catch (err) {
    req.url = originalUrl;
    opts.onError?.();
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`ext:${opts.extensionName}`, `${label} (uncaught): ${msg}`);
    if (!res.headersSent) {
      res.status(500).json({ error: label });
    }
  }
}
