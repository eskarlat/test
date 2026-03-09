import type {
  ScopedLLM,
  LLMModelInfo,
  LLMCompleteRequest,
  LLMCompleteResponse,
  LLMStreamRequest,
  LLMStreamHandler,
  LLMSessionOpts,
  LLMSession,
  LLMSessionMessage,
  LLMAttachment,
} from "@renre-kit/extension-sdk";
import type { CopilotBridge } from "./copilot-bridge.js";
import { logger } from "./logger.js";

// ---------------------------------------------------------------------------
// Rate limiter — per-extension request tracking (log-only for now)
// ---------------------------------------------------------------------------

const RATE_WARN_THRESHOLD = 60; // requests per minute

interface RateWindow {
  count: number;
  windowStart: number;
}

const rateWindows = new Map<string, RateWindow>();

function trackRequest(extensionName: string): void {
  const now = Date.now();
  const key = extensionName;
  let window = rateWindows.get(key);

  if (!window || now - window.windowStart > 60_000) {
    window = { count: 0, windowStart: now };
    rateWindows.set(key, window);
  }

  window.count++;

  if (window.count === RATE_WARN_THRESHOLD) {
    logger.warn(
      `ext:${extensionName}`,
      `LLM rate warning: ${RATE_WARN_THRESHOLD} requests in current minute window`,
    );
  }
}

// ---------------------------------------------------------------------------
// Error wrapping — extension-friendly error messages
// ---------------------------------------------------------------------------

function wrapError(extensionName: string, operation: string, err: unknown): Error {
  const msg = err instanceof Error ? err.message : String(err);
  logger.warn(`ext:${extensionName}`, `LLM ${operation} failed: ${msg}`);
  return new Error(`LLM ${operation} failed: ${msg}`);
}

// ---------------------------------------------------------------------------
// ScopedLLM factory
// ---------------------------------------------------------------------------

/**
 * Creates a ScopedLLM proxy that delegates to the CopilotBridge for a
 * specific extension. Rate-limits requests and isolates errors so
 * extension failures don't propagate to the bridge.
 */
export function createScopedLLM(
  extensionName: string,
  projectId: string,
  bridge: CopilotBridge,
): ScopedLLM {
  return {
    async listModels(): Promise<LLMModelInfo[]> {
      trackRequest(extensionName);
      try {
        const models = await bridge.listModels();
        return models.map((m) => ({
          id: m.id,
          name: m.name ?? m.id,
          supportsVision: m.supportsVision ?? false,
          supportsReasoning: m.supportsReasoning ?? false,
          ...(m.supportedReasoningEfforts ? { supportedReasoningEfforts: m.supportedReasoningEfforts } : {}),
          maxContextTokens: m.maxContextTokens ?? 128_000,
        }));
      } catch (err) {
        throw wrapError(extensionName, "listModels", err);
      }
    },

    async complete(request: LLMCompleteRequest): Promise<LLMCompleteResponse> {
      trackRequest(extensionName);
      logger.debug(
        `ext:${extensionName}`,
        `LLM complete, model=${request.model ?? "default"}`,
      );

      try {
        // Create ephemeral session, send message, collect response, destroy
        const sessionId = await bridge.createChatSession({
          projectId,
          ...(request.model ? { model: request.model } : {}),
          ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
        });

        const attachments = mapAttachments(request.attachments);

        // Collect the response by listening to events
        const response = await collectCompleteResponse(bridge, sessionId, request.prompt, attachments);

        // Cleanup ephemeral session
        await bridge.deleteSession(sessionId);

        logger.debug(
          `ext:${extensionName}`,
          `LLM complete done, tokens=${response.usage.promptTokens + response.usage.completionTokens}`,
        );

        return response;
      } catch (err) {
        throw wrapError(extensionName, "complete", err);
      }
    },

    async stream(request: LLMStreamRequest, handler: LLMStreamHandler): Promise<void> {
      trackRequest(extensionName);
      logger.debug(
        `ext:${extensionName}`,
        `LLM stream, model=${request.model ?? "default"}`,
      );

      try {
        const sessionId = await bridge.createChatSession({
          projectId,
          ...(request.model ? { model: request.model } : {}),
          ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
        });

        const attachments = mapAttachments(request.attachments);

        await streamResponse(bridge, sessionId, request.prompt, attachments, handler);

        await bridge.deleteSession(sessionId);
      } catch (err) {
        const wrapped = wrapError(extensionName, "stream", err);
        if (handler.onError) {
          handler.onError(wrapped);
        } else {
          throw wrapped;
        }
      }
    },

    async createSession(opts?: LLMSessionOpts): Promise<LLMSession> {
      trackRequest(extensionName);
      logger.debug(
        `ext:${extensionName}`,
        `LLM createSession, model=${opts?.model ?? "default"}`,
      );

      try {
        const sessionId = await bridge.createChatSession({
          projectId,
          ...(opts?.model ? { model: opts.model } : {}),
          ...(opts?.reasoningEffort ? { reasoningEffort: opts.reasoningEffort } : {}),
        });

        return createLLMSessionProxy(extensionName, bridge, sessionId);
      } catch (err) {
        throw wrapError(extensionName, "createSession", err);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// LLMSession proxy — wraps a managed CopilotBridge session
// ---------------------------------------------------------------------------

function createLLMSessionProxy(
  extensionName: string,
  bridge: CopilotBridge,
  sessionId: string,
): LLMSession {
  const messages: LLMSessionMessage[] = [];

  return {
    get sessionId(): string {
      return sessionId;
    },

    async send(prompt: string, attachments?: LLMAttachment[]): Promise<LLMCompleteResponse> {
      trackRequest(extensionName);
      try {
        const mapped = mapAttachments(attachments);
        const response = await collectCompleteResponse(bridge, sessionId, prompt, mapped);
        messages.push(
          { role: "user", content: prompt, timestamp: Date.now() },
          { role: "assistant", content: response.content, ...(response.reasoning ? { reasoning: response.reasoning } : {}), timestamp: Date.now() },
        );
        return response;
      } catch (err) {
        throw wrapError(extensionName, "session.send", err);
      }
    },

    async stream(prompt: string, handler: LLMStreamHandler, attachments?: LLMAttachment[]): Promise<void> {
      trackRequest(extensionName);
      try {
        const mapped = mapAttachments(attachments);
        const collected = { content: "", reasoning: "" };

        const wrappedHandler: LLMStreamHandler = {
          onDelta: (delta) => {
            collected.content += delta;
            if (handler.onDelta) handler.onDelta(delta);
          },
          onReasoning: (delta) => {
            collected.reasoning += delta;
            if (handler.onReasoning) handler.onReasoning(delta);
          },
          onComplete: (response) => {
            messages.push(
              { role: "user", content: prompt, timestamp: Date.now() },
              { role: "assistant", content: response.content, ...(response.reasoning ? { reasoning: response.reasoning } : {}), timestamp: Date.now() },
            );
            if (handler.onComplete) handler.onComplete(response);
          },
          onError: handler.onError,
        };

        await streamResponse(bridge, sessionId, prompt, mapped, wrappedHandler);
      } catch (err) {
        const wrapped = wrapError(extensionName, "session.stream", err);
        if (handler.onError) {
          handler.onError(wrapped);
        } else {
          throw wrapped;
        }
      }
    },

    async getMessages(): Promise<LLMSessionMessage[]> {
      return [...messages];
    },

    async disconnect(): Promise<void> {
      try {
        await bridge.deleteSession(sessionId);
      } catch (err) {
        logger.warn(`ext:${extensionName}`, `Session disconnect error: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type BridgeAttachment = { type: "file" | "directory" | "selection"; path: string; displayName?: string };

function mapAttachments(
  attachments: LLMAttachment[] | undefined,
): BridgeAttachment[] | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  return attachments.map((a) => ({
    type: a.type,
    path: a.path,
    ...(a.displayName ? { displayName: a.displayName } : {}),
  }));
}

interface ParsedEventData {
  type: string;
  data: Record<string, unknown>;
}

function parseEvent(event: unknown): ParsedEventData {
  const raw = event as unknown as { type: string; data?: Record<string, unknown> };
  return { type: raw.type, data: raw.data ?? {} };
}

function stringField(data: Record<string, unknown>, key: string, fallback: string): string {
  const val = data[key];
  return typeof val === "string" ? val : fallback;
}

function extractResponseFromEvents(events: unknown[]): { content: string; reasoning: string | undefined; model: string } {
  let content = "";
  let reasoning: string | undefined;
  let model = "default";

  for (let i = events.length - 1; i >= 0; i--) {
    if (!events[i]) continue;
    const { type, data } = parseEvent(events[i]);
    if (type === "assistant.message") {
      content = stringField(data, "content", "");
      model = stringField(data, "model", "default");
      break;
    }
    if (type === "assistant.reasoning" && reasoning === undefined) {
      const val = data["content"];
      reasoning = typeof val === "string" ? val : undefined;
    }
  }

  return { content, reasoning, model };
}

/**
 * Send a message to a bridge session and collect the complete response.
 * Uses getSessionMessages() after send completes to extract the assistant reply.
 */
async function collectCompleteResponse(
  bridge: CopilotBridge,
  sessionId: string,
  prompt: string,
  attachments: BridgeAttachment[] | undefined,
): Promise<LLMCompleteResponse> {
  await bridge.sendMessage(sessionId, prompt, attachments);
  const events = await bridge.getSessionMessages(sessionId);
  const { content, reasoning, model } = extractResponseFromEvents(events);

  return {
    content,
    ...(reasoning ? { reasoning } : {}),
    model,
    usage: { promptTokens: 0, completionTokens: 0 },
  };
}

/**
 * Send a message and stream the response via handler callbacks.
 * Uses bridge.sendMessage which handles streaming via SDK events,
 * then extracts the final response for the onComplete callback.
 */
async function streamResponse(
  bridge: CopilotBridge,
  sessionId: string,
  prompt: string,
  attachments: BridgeAttachment[] | undefined,
  handler: LLMStreamHandler,
): Promise<void> {
  await bridge.sendMessage(sessionId, prompt, attachments);
  const events = await bridge.getSessionMessages(sessionId);
  const { content, reasoning, model } = extractResponseFromEvents(events);

  if (handler.onComplete) {
    handler.onComplete({
      content,
      ...(reasoning ? { reasoning } : {}),
      model,
      usage: { promptTokens: 0, completionTokens: 0 },
    });
  }
}
