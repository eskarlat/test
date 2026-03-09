import type { Request, Response, NextFunction } from "express";

const DEFAULT_TIMEOUT_MS = 30_000;

export function extensionTimeout(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
  return (_req: Request, res: Response, next: NextFunction): void => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (!res.headersSent) {
        res.status(504).json({ error: "Gateway Timeout", message: "Extension request timed out" });
      }
    }, timeoutMs);

    res.on("finish", () => clearTimeout(timer));
    res.on("close", () => clearTimeout(timer));

    if (!timedOut) {
      next();
    }
  };
}
