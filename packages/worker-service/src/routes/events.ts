import { Router, type Request, type Response } from "express";
import { eventBus, type WorkerEvent } from "../core/event-bus.js";
import { logger } from "../core/logger.js";

const router = Router();

const KEEPALIVE_INTERVAL_MS = 30_000;

/**
 * GET /api/events — SSE stream endpoint (ADR-023)
 *
 * Streams all EventBus events to connected clients in real-time.
 * Sends keepalive comments every 30 seconds.
 * Supports multiple concurrent clients.
 */
router.get("/api/events", (req: Request, res: Response) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders();

  // Send buffered events on connect for reconnection recovery
  const history = eventBus.getHistory();
  for (const event of history) {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  }

  // Forward new events
  const onEvent = (event: WorkerEvent): void => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
  };
  eventBus.on("event", onEvent);

  // Keepalive to prevent connection timeout
  const keepalive = setInterval(() => {
    res.write(": keepalive\n\n");
  }, KEEPALIVE_INTERVAL_MS);

  // Cleanup on client disconnect
  req.on("close", () => {
    eventBus.off("event", onEvent);
    clearInterval(keepalive);
    logger.debug("worker", "SSE client disconnected");
  });

  logger.debug("worker", "SSE client connected");
});

/**
 * GET /api/events/history — Return buffered events for reconnection recovery
 */
router.get("/api/events/history", (_req: Request, res: Response) => {
  res.json(eventBus.getHistory());
});

export default router;
