import type { Server, Socket } from "socket.io";
import type { PermissionRequestResult } from "@github/copilot-sdk";
import { eventBus, type WorkerEvent, type WorkerEventType } from "./event-bus.js";
import { copilotBridge } from "./copilot-bridge.js";
import { logger } from "./logger.js";

// System-level event prefixes — events NOT scoped to a single project
const SYSTEM_PREFIXES = ["extension:", "project:", "mcp:", "vault:", "updates:"];

// Project-level event prefixes — events scoped to a specific project
const PROJECT_PREFIXES = [
  "session:", "observation:", "tool:", "prompt:", "error:", "subagent:", "automation:",
];

function isSystemEvent(type: string): boolean {
  return SYSTEM_PREFIXES.some((prefix) => type.startsWith(prefix));
}

function isProjectEvent(type: string): boolean {
  return PROJECT_PREFIXES.some((prefix) => type.startsWith(prefix));
}

function extractProjectId(payload: Record<string, unknown>): string | null {
  if (typeof payload["projectId"] === "string") return payload["projectId"];
  return null;
}

/**
 * Resolve the chat session ID from a socket's joined rooms.
 * Looks for rooms matching `chat:{sessionId}`.
 */
function getSessionFromSocket(socket: Socket): string | null {
  for (const room of socket.rooms) {
    if (room.startsWith("chat:")) {
      return room.slice(5);
    }
  }
  return null;
}

/**
 * Attach Socket.IO bridge to forward EventBus events to room-scoped clients.
 * Per ADR-048: system room (auto-join), project:{pid} rooms, chat:{sid} rooms.
 */
export function attachSocketBridge(io: Server): void {
  // Forward EventBus events to appropriate Socket.IO rooms
  const handler = (event: WorkerEvent) => {
    if (isSystemEvent(event.type)) {
      io.to("system").emit(event.type, event.payload);
    }

    if (isProjectEvent(event.type)) {
      const projectId = extractProjectId(event.payload);
      if (projectId) {
        io.to(`project:${projectId}`).emit(event.type, event.payload);
      }
    }
  };

  eventBus.on("event", handler);

  io.on("connection", (socket: Socket) => {
    logger.debug("socket", `Client connected: ${socket.id}`);

    // Auto-join system room (ADR-048 §3)
    socket.join("system");

    // Send event history for gap recovery (ADR-048 §5)
    socket.emit("event-history", eventBus.getHistory());

    // Room management
    socket.on("project:join", (projectId: string) => {
      if (typeof projectId !== "string" || !projectId) return;
      socket.join(`project:${projectId}`);
      logger.debug("socket", `${socket.id} joined project:${projectId}`);
    });

    socket.on("project:leave", (projectId: string) => {
      if (typeof projectId !== "string" || !projectId) return;
      socket.leave(`project:${projectId}`);
      logger.debug("socket", `${socket.id} left project:${projectId}`);
    });

    socket.on("chat:join", (sessionId: string) => {
      if (typeof sessionId !== "string" || !sessionId) return;
      socket.join(`chat:${sessionId}`);
      logger.debug("socket", `${socket.id} joined chat:${sessionId}`);
    });

    socket.on("chat:leave", (sessionId: string) => {
      if (typeof sessionId !== "string" || !sessionId) return;
      socket.leave(`chat:${sessionId}`);
      logger.debug("socket", `${socket.id} left chat:${sessionId}`);
    });

    socket.on("automation:join", (runId: string) => {
      if (typeof runId !== "string" || !runId) return;
      socket.join(`automation:${runId}`);
      logger.debug("socket", `${socket.id} joined automation:${runId}`);
    });

    socket.on("automation:leave", (runId: string) => {
      if (typeof runId !== "string" || !runId) return;
      socket.leave(`automation:${runId}`);
      logger.debug("socket", `${socket.id} left automation:${runId}`);
    });

    // Chat event handlers — CopilotBridge integration (ADR-047 §4, ADR-048, ADR-052 §2.6)
    // withSession resolves the target session ID. When an explicit sessionId is
    // provided in the event payload (multi-pane), it is used after validating the
    // socket has joined that room. Otherwise, falls back to room inference for
    // backward compatibility with single-pane clients.
    const withSession = (
      eventName: string,
      fn: (sessionId: string) => Promise<void>,
      explicitSessionId: string | undefined,
      ack?: (res: { ok: boolean; error?: string }) => void,
    ): void => {
      const sessionId = explicitSessionId ?? getSessionFromSocket(socket);
      if (!sessionId) { ack?.({ ok: false, error: "Not joined to a chat session" }); return; }
      if (explicitSessionId && !socket.rooms.has(`chat:${explicitSessionId}`)) {
        ack?.({ ok: false, error: "Not joined to the specified chat session" });
        return;
      }
      fn(sessionId)
        .then(() => ack?.({ ok: true }))
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.warn("socket", `${eventName} failed for ${sessionId}: ${msg}`);
          ack?.({ ok: false, error: msg });
        });
    };

    socket.on("chat:send", (data: { prompt: string; sessionId?: string; attachments?: Array<{ type: string; path: string; displayName?: string }> }, ack?: (res: { ok: boolean; error?: string }) => void) => {
      withSession("chat:send", (sid) => copilotBridge.sendMessage(sid, data.prompt, data.attachments as Array<{ type: "file" | "directory" | "selection"; path: string; displayName?: string }>), data.sessionId, ack);
    });

    socket.on("chat:cancel", (data: { sessionId?: string }, ack?: (res: { ok: boolean; error?: string }) => void) => {
      withSession("chat:cancel", (sid) => copilotBridge.cancelGeneration(sid), data?.sessionId, ack);
    });

    socket.on("chat:permission", (data: { requestId: string; decision: PermissionRequestResult }) => {
      if (!data.requestId || !data.decision) return;
      copilotBridge.resolvePermission(data.requestId, data.decision);
    });

    socket.on("chat:input", (data: { requestId: string; answer: string }) => {
      if (!data.requestId) return;
      copilotBridge.resolveInput(data.requestId, {
        answer: data.answer ?? "",
        wasFreeform: true,
      });
    });

    socket.on("chat:elicitation", (data: { requestId: string; data: Record<string, unknown> }) => {
      if (!data.requestId) return;
      copilotBridge.resolveElicitation(data.requestId, data.data ?? {});
    });

    socket.on("disconnect", (reason: string) => {
      logger.debug("socket", `Client disconnected: ${socket.id} (${reason})`);
    });
  });
}

// Re-export classifiers for testing
export { isSystemEvent, isProjectEvent };
export type { WorkerEventType };
