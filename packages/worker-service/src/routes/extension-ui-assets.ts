import { Router, type Request, type Response } from "express";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, extname, normalize, resolve } from "node:path";
import { globalPaths } from "../core/paths.js";

const router = Router();

const MIME_TYPES: Record<string, string> = {
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".css": "text/css",
  ".html": "text/html",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

// GET /api/extensions/:name/:version/ui/* — serve extension UI static assets
router.get(
  "/api/extensions/:name/:version/ui/*",
  (req: Request, res: Response) => {
    const { name, version } = req.params;
    const filePath =
      (req.params as Record<string, string>)["0"] ?? "index.js";

    if (!name || !version) {
      res.status(400).json({ error: "Missing name or version" });
      return;
    }

    const { extensionsDir } = globalPaths();
    const uiDir = join(extensionsDir, name, version, "ui");

    // Security: prevent directory traversal
    const requestedFile = normalize(filePath);
    if (requestedFile.startsWith("..")) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    const fullPath = resolve(join(uiDir, requestedFile));
    const resolvedUiDir = resolve(uiDir);

    // Ensure resolved path stays within uiDir
    if (!fullPath.startsWith(resolvedUiDir)) {
      res.status(403).json({ error: "Forbidden" });
      return;
    }

    if (!existsSync(fullPath) || statSync(fullPath).isDirectory()) {
      res.status(404).json({ error: "Asset not found" });
      return;
    }

    const ext = extname(fullPath);
    const mimeType = MIME_TYPES[ext] ?? "application/octet-stream";
    res.setHeader("Content-Type", mimeType);
    res.setHeader("Cache-Control", "public, max-age=3600");
    res.send(readFileSync(fullPath));
  },
);

export default router;
