import { Router, type Request, type Response } from "express";
import { eventBus } from "../core/event-bus.js";
import type { WorkerEvent } from "../core/event-bus.js";

const router = Router();

router.get("/api/events", (req: Request, res: Response) => {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  // Send buffered history on connect for gap recovery
  const history = eventBus.getHistory();
  for (const event of history) {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
  }

  const handler = (event: WorkerEvent) => {
    res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`);
  };

  eventBus.on("event", handler);

  // 30-second keepalive heartbeat
  const heartbeat = setInterval(() => {
    res.write(": heartbeat\n\n");
  }, 30_000);

  req.on("close", () => {
    eventBus.off("event", handler);
    clearInterval(heartbeat);
  });
});

router.get("/api/events/history", (_req: Request, res: Response) => {
  res.json(eventBus.getHistory());
});

export default router;
