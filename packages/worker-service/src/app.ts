import express, { type Request, type Response, type NextFunction } from "express";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { logger } from "./core/logger.js";
import healthRouter from "./routes/health.js";
import projectsRouter from "./routes/projects.js";
import errorsRouter from "./routes/errors.js";
import backupRouter from "./routes/backup.js";
import vaultRouter from "./routes/vault.js";
import extensionsRouter from "./routes/extensions.js";
import extensionUiAssetsRouter from "./routes/extension-ui-assets.js";
import hooksRouter from "./routes/hooks.js";
import sessionsRouter from "./routes/sessions.js";
import mcpRouter from "./routes/mcp.js";
import { projectRouterMiddleware } from "./middleware/project-router.js";
import { actionsRouteMiddleware } from "./middleware/actions-route.js";
import { mcpBridgeMiddleware } from "./middleware/mcp-bridge-routes.js";
import { requestTrackerMiddleware } from "./middleware/request-tracker.js";
import logsRouter from "./routes/logs.js";
import statsRouter from "./routes/stats.js";
import configRouter from "./routes/config.js";
import marketplaceRouter from "./routes/marketplace.js";
import observationsRouter from "./routes/observations.js";
import toolRulesRouter from "./routes/tool-rules.js";
import promptsRouter from "./routes/prompts.js";
import errorsIntelligenceRouter from "./routes/errors-intelligence.js";
import toolAnalyticsRouter from "./routes/tool-analytics.js";
import subagentsRouter from "./routes/subagents.js";
import contextRecipeRouter from "./routes/context-recipe.js";
import searchRouter from "./routes/search.js";
import { chatRouter, projectChatRouter } from "./routes/chat.js";
import worktreeRouter from "./routes/worktrees.js";
import automationRouter from "./routes/automations.js";
import extCronRouter from "./routes/ext-cron.js";
import { registerBuiltInProviders } from "./core/context-recipe-engine.js";
import { seedBuiltinRules } from "./core/tool-governance.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export function createApp(): express.Application {
  const app = express();

  // Initialize intelligence layer defaults
  registerBuiltInProviders();
  seedBuiltinRules();

  // Body parsing
  app.use(express.json());

  // CORS for Console UI
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, PATCH, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    next();
  });

  // Request logging middleware — only metadata, never bodies
  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on("finish", () => {
      const duration = Date.now() - start;
      logger.info("worker", `${req.method} ${req.url} ${res.statusCode} ${duration}ms`);
    });
    next();
  });

  // Request tracker middleware — counts per-extension requests and latency
  app.use(requestTrackerMiddleware);

  // Handle preflight
  app.options("*", (_req: Request, res: Response) => {
    res.sendStatus(204);
  });

  // Core routes
  app.use(healthRouter);
  app.use(projectsRouter);
  app.use(errorsRouter);
  app.use(backupRouter);
  app.use(vaultRouter);
  app.use(extensionsRouter);
  app.use(extensionUiAssetsRouter);
  app.use(hooksRouter);
  app.use(sessionsRouter);
  app.use(mcpRouter);
  app.use(logsRouter);
  app.use(statsRouter);
  app.use(configRouter);
  app.use(marketplaceRouter);
  app.use(observationsRouter);
  app.use(toolRulesRouter);
  app.use(promptsRouter);
  app.use(errorsIntelligenceRouter);
  app.use(toolAnalyticsRouter);
  app.use(subagentsRouter);
  app.use(contextRecipeRouter);
  app.use(searchRouter);
  app.use(chatRouter);
  app.use(projectChatRouter);
  app.use(worktreeRouter);
  app.use(automationRouter);
  app.use(extCronRouter);
  // Actions discovery route (must come before extension router)
  app.use(actionsRouteMiddleware);
  // MCP bridge routes (must come before extension router, after core routes)
  app.use(mcpBridgeMiddleware);
  // Extension request routing (must come before static serving, after core routes)
  app.use(projectRouterMiddleware);

  // Shutdown route
  app.post("/api/server/shutdown", (_req: Request, res: Response) => {
    res.json({ ok: true });
    setTimeout(() => process.emit("SIGTERM"), 100);
  });

  // Static file serving for Console UI (Phase 11 placeholder)
  const consoleUiDist = join(__dirname, "..", "..", "console-ui", "dist");
  if (existsSync(consoleUiDist)) {
    app.use(express.static(consoleUiDist));
    app.get("*", (_req: Request, res: Response) => {
      res.sendFile(join(consoleUiDist, "index.html"));
    });
  }

  // Error handling middleware
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    const source = determineErrorSource(req.url);
    logger.error(source, err.message, { url: req.url, method: req.method });
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}

function determineErrorSource(url: string): string {
  if (url.startsWith("/api/") && url.split("/").length > 3) {
    const parts = url.split("/");
    // /api/{project-id}/{extension}/{action}
    if (parts[3]) return `ext:${parts[3]}`;
  }
  return "worker";
}
