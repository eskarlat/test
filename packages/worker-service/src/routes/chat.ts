import { Router, type Request, type Response, type NextFunction } from "express";
import type { SessionEvent } from "@github/copilot-sdk";
import { copilotBridge } from "../core/copilot-bridge.js";
import { logger } from "../core/logger.js";

// ---------------------------------------------------------------------------
// SDK SessionEvent → UI ChatMessage conversion
// ---------------------------------------------------------------------------

interface ChatMessageDTO {
  id: string;
  parentId?: string;
  role: "user" | "assistant" | "system";
  blocks: Array<{ type: string; content: string }>;
  timestamp: string;
  isStreaming: boolean;
}

function convertSessionEventsToChatMessages(events: SessionEvent[]): ChatMessageDTO[] {
  const messages: ChatMessageDTO[] = [];
  for (const event of events) {
    const data = (event as unknown as { data: Record<string, unknown> }).data ?? {};
    if (event.type === "user.message") {
      messages.push({
        id: event.id,
        parentId: event.parentId ?? undefined,
        role: "user",
        blocks: [{ type: "text", content: String(data["content"] ?? "") }],
        timestamp: event.timestamp,
        isStreaming: false,
      });
    } else if (event.type === "assistant.message") {
      messages.push({
        id: event.id,
        parentId: event.parentId ?? undefined,
        role: "assistant",
        blocks: [{ type: "text", content: String(data["content"] ?? "") }],
        timestamp: event.timestamp,
        isStreaming: false,
      });
    }
  }
  return messages;
}

/**
 * Global chat routes — mounted at /api/chat
 */
export const chatRouter = Router();

/**
 * Project-scoped chat routes — mounted at /api/:projectId/chat
 */
export const projectChatRouter = Router({ mergeParams: true });

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

async function requireBridgeReady(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    await copilotBridge.ensureStarted();
    next();
  } catch {
    const status = copilotBridge.getStatus();
    res.status(503).json({ error: "Copilot bridge is not ready", status: status.status });
  }
}

function chatError(res: Response, action: string, err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  if (message.includes("not found")) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  logger.error("chat", `Failed to ${action}: ${message}`);
  res.status(500).json({ error: `Failed to ${action}` });
}

// ---------------------------------------------------------------------------
// Global routes
// ---------------------------------------------------------------------------

// GET /api/chat/status — Bridge health (also triggers lazy initialization)
chatRouter.get("/api/chat/status", (_req: Request, res: Response) => {
  try {
    const status = copilotBridge.getStatus();
    // Kick off initialization if not started yet (fire-and-forget)
    if (status.status === "not-initialized") {
      void copilotBridge.ensureStarted().catch(() => {});
    }
    res.json(copilotBridge.getStatus());
  } catch (err: unknown) {
    chatError(res, "get bridge status", err);
  }
});

// GET /api/chat/models — List available models (mapped to UI-friendly shape)
chatRouter.get("/api/chat/models", requireBridgeReady, async (_req: Request, res: Response) => {
  try {
    const sdkModels = await copilotBridge.listModels();
    const models = sdkModels.map((m) => ({
      id: m.id,
      name: m.name,
      supportsReasoning: m.capabilities?.supports?.reasoningEffort === true,
      supportsVision: m.capabilities?.supports?.vision === true,
    }));
    res.json(models);
  } catch (err: unknown) {
    chatError(res, "list models", err);
  }
});

// ---------------------------------------------------------------------------
// Project-scoped routes
// ---------------------------------------------------------------------------

// POST /api/:projectId/chat/sessions — Create a new chat session
projectChatRouter.post("/api/:projectId/chat/sessions", requireBridgeReady, async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { model, reasoningEffort, title, branchFrom } = req.body as {
      model: string;
      reasoningEffort?: string;
      title?: string;
      branchFrom?: { sessionId: string; messageIndex: number };
    };

    if (!model) {
      res.status(400).json({ error: "model is required" });
      return;
    }

    let context: Array<{ role: string; content: string }> | undefined;
    if (branchFrom) {
      try {
        const sourceMessages = await copilotBridge.getSessionMessages(branchFrom.sessionId);
        context = sourceMessages.slice(0, branchFrom.messageIndex + 1);
      } catch (err: unknown) {
        chatError(res, "fetch branch source", err);
        return;
      }
    }

    const sessionId = await copilotBridge.createChatSession({
      projectId: projectId!, model, reasoningEffort, title, context,
    });
    res.status(201).json({ sessionId });
  } catch (err: unknown) {
    chatError(res, "create chat session", err);
  }
});

// GET /api/:projectId/chat/sessions — List sessions for a project
projectChatRouter.get("/api/:projectId/chat/sessions", requireBridgeReady, async (req: Request, res: Response) => {
  try {
    res.json(await copilotBridge.listSessions(req.params["projectId"]!));
  } catch (err: unknown) {
    chatError(res, "list chat sessions", err);
  }
});

// GET /api/:projectId/chat/sessions/:sessionId — Session metadata
projectChatRouter.get("/api/:projectId/chat/sessions/:sessionId", requireBridgeReady, async (req: Request, res: Response) => {
  try {
    const metadata = await copilotBridge.getSessionMetadata(req.params["sessionId"]!);
    if (!metadata) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(metadata);
  } catch (err: unknown) {
    chatError(res, "get session metadata", err);
  }
});

// DELETE /api/:projectId/chat/sessions/:sessionId — Delete a session
projectChatRouter.delete("/api/:projectId/chat/sessions/:sessionId", requireBridgeReady, async (req: Request, res: Response) => {
  try {
    const deleted = await copilotBridge.deleteSession(req.params["sessionId"]!);
    if (!deleted) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json({ ok: true });
  } catch (err: unknown) {
    chatError(res, "delete session", err);
  }
});

// GET /api/:projectId/chat/sessions/:sessionId/messages — Get session messages
projectChatRouter.get("/api/:projectId/chat/sessions/:sessionId/messages", requireBridgeReady, async (req: Request, res: Response) => {
  try {
    const events = await copilotBridge.getSessionMessages(req.params["sessionId"]!);
    res.json(convertSessionEventsToChatMessages(events));
  } catch (err: unknown) {
    chatError(res, "get session messages", err);
  }
});

// POST /api/:projectId/chat/sessions/:sessionId/resume — Resume a session
projectChatRouter.post("/api/:projectId/chat/sessions/:sessionId/resume", requireBridgeReady, async (req: Request, res: Response) => {
  try {
    const sessionId = req.params["sessionId"]!;
    const projectId = req.params["projectId"]!;
    const result = await copilotBridge.resumeSession(sessionId, projectId);
    if (!result) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // Fetch and convert session history to UI-compatible ChatMessage format
    let messages: ChatMessageDTO[] = [];
    try {
      const events = await copilotBridge.getSessionMessages(sessionId);
      messages = convertSessionEventsToChatMessages(events);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("chat", `Failed to fetch messages for resumed session ${sessionId}: ${msg}`);
    }

    res.json({ ...result, messages });
  } catch (err: unknown) {
    chatError(res, "resume session", err);
  }
});
