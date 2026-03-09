import {
  CopilotClient,
  type CopilotSession,
  type SessionConfig,
  type SessionEvent,
  type PermissionHandler,
  type PermissionRequest,
  type PermissionRequestResult,
  type ModelInfo,
  type MessageOptions,
  type ResumeSessionConfig,
  type SessionListFilter,
  type SessionMetadata as SDKSessionMetadata,
} from "@github/copilot-sdk";
import type { Server as SocketIOServer } from "socket.io";
import { randomUUID } from "node:crypto";
import { logger } from "./logger.js";
import { eventBus } from "./event-bus.js";
import { assemble } from "./context-recipe-engine.js";
import { getBuiltinTools } from "./chat-builtin-tools.js";
import { getRegistry as getProjectRegistry } from "../routes/projects.js";
import { listMounted, type MountedExtensionInfo } from "./extension-registry.js";
import { circuitBreaker } from "./extension-circuit-breaker.js";
import { getServerPort } from "./server-port.js";
import type { ChatToolDefinition, ChatAgentDefinition } from "@renre-kit/extension-sdk";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BridgeState =
  | "not-initialized"
  | "starting"
  | "ready"
  | "error"
  | "unavailable";

export interface CreateChatSessionOpts {
  projectId: string;
  model?: string;
  reasoningEffort?: "low" | "medium" | "high" | "xhigh";
  title?: string;
  context?: Array<{ role: string; content: string }>;
}

export interface ChatAttachment {
  type: "file" | "directory" | "selection";
  path: string;
  displayName?: string;
}

interface ManagedSession {
  session: CopilotSession;
  projectId: string;
  model: string;
  title: string | undefined;
  createdAt: string;
  lastActivity: string;
  currentRoundId: string | null;
  activeToolCalls: Set<string>;
  /** Suppress the next SDK turn_start — sendMessage emits turn-start manually. */
  suppressNextTurnStart: boolean;
}

interface PendingCallback<T> {
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

/**
 * SDK UserInputResponse type — matches @github/copilot-sdk's UserInputResponse
 * which is not re-exported from the package root.
 */
interface UserInputResponse {
  answer: string;
  wasFreeform: boolean;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const LOG_SOURCE = "copilot-bridge";

const CALLBACK_TIMEOUT_MS = 30_000;
const RETRY_DELAYS_MS = [1_000, 5_000, 15_000];
const MAX_RETRIES = RETRY_DELAYS_MS.length;
const DEFAULT_SYSTEM_PROMPT_TOKEN_BUDGET = 4_000;

// ---------------------------------------------------------------------------
// CopilotBridge Singleton
// ---------------------------------------------------------------------------

export class CopilotBridge {
  private state: BridgeState = "not-initialized";
  private stateError: string | undefined;
  private client: CopilotClient | null = null;
  private io: SocketIOServer | null = null;
  private sessions = new Map<string, ManagedSession>();
  private startPromise: Promise<void> | null = null;
  private retryCount = 0;

  // Track sessions that already have event listeners attached
  private attachedListeners = new Set<string>();

  // Cached model info for capability checks
  private modelCache = new Map<string, ModelInfo>();

  // Pending permission/input/elicitation callbacks keyed by request ID
  private pendingPermissions = new Map<string, PendingCallback<PermissionRequestResult>>();
  private pendingInputs = new Map<string, PendingCallback<UserInputResponse>>();
  private pendingElicitations = new Map<string, PendingCallback<Record<string, unknown>>>();

  // Session event listeners for external consumers (e.g. AutomationEngine)
  private sessionEventListeners = new Map<string, Array<(event: string, data: Record<string, unknown>) => void>>();

  // -----------------------------------------------------------------------
  // Socket.IO
  // -----------------------------------------------------------------------

  setIO(io: SocketIOServer): void {
    this.io = io;
  }

  /**
   * Register a listener that receives all events emitted for a specific session.
   * Used by AutomationEngine to forward streaming events to automation rooms.
   */
  addSessionEventListener(
    sessionId: string,
    listener: (event: string, data: Record<string, unknown>) => void,
  ): void {
    const listeners = this.sessionEventListeners.get(sessionId) ?? [];
    listeners.push(listener);
    this.sessionEventListeners.set(sessionId, listeners);
  }

  /**
   * Remove a previously registered session event listener.
   */
  removeSessionEventListener(
    sessionId: string,
    listener: (event: string, data: Record<string, unknown>) => void,
  ): void {
    const listeners = this.sessionEventListeners.get(sessionId);
    if (!listeners) return;
    const filtered = listeners.filter((l) => l !== listener);
    if (filtered.length === 0) {
      this.sessionEventListeners.delete(sessionId);
    } else {
      this.sessionEventListeners.set(sessionId, filtered);
    }
  }

  private emitToSession(sessionId: string, event: string, data: Record<string, unknown>): void {
    if (!this.io) return;
    this.io.to(`chat:${sessionId}`).emit(event, data);

    // Notify session event listeners (e.g. AutomationEngine forwarding)
    const listeners = this.sessionEventListeners.get(sessionId);
    if (listeners) {
      for (const listener of listeners) {
        try {
          listener(event, data);
        } catch {
          // Listener errors should not break CopilotBridge event dispatch
        }
      }
    }
  }

  private emitToAllSessions(event: string, data: Record<string, unknown>): void {
    if (!this.io) return;
    for (const sessionId of this.sessions.keys()) {
      this.io.to(`chat:${sessionId}`).emit(event, data);
    }
  }

  private emitBridgeStatus(): void {
    if (!this.io) return;
    this.io.emit("chat:bridge-status", this.getStatus());
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  getStatus(): { status: BridgeState; error?: string; sessionCount: number; models: string[] } {
    return {
      status: this.state,
      ...(this.stateError ? { error: this.stateError } : {}),
      sessionCount: this.sessions.size,
      models: [],
    };
  }

  async ensureStarted(): Promise<void> {
    if (this.state === "ready" && this.client) return;
    if (this.state === "unavailable") {
      throw new Error(
        "Copilot SDK is unavailable — GitHub Copilot may not be installed or authenticated",
      );
    }
    if (this.startPromise) return this.startPromise;

    this.startPromise = this.doStart();
    try {
      await this.startPromise;
    } finally {
      this.startPromise = null;
    }
  }

  private async doStart(): Promise<void> {
    this.state = "starting";
    this.stateError = undefined;
    this.emitBridgeStatus();
    logger.info(LOG_SOURCE, "Initializing CopilotClient...");

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const client = new CopilotClient();
        await client.start();
        this.client = client;
        this.state = "ready";
        this.stateError = undefined;
        this.retryCount = 0;
        this.emitBridgeStatus();
        logger.info(LOG_SOURCE, "CopilotClient started successfully");
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(
          LOG_SOURCE,
          `Start attempt ${attempt + 1}/${MAX_RETRIES + 1} failed: ${msg}`,
        );

        if (attempt < MAX_RETRIES) {
          const delay = RETRY_DELAYS_MS[attempt]!;
          logger.info(LOG_SOURCE, `Retrying in ${delay}ms...`);
          await sleep(delay);
        }
      }
    }

    this.state = "unavailable";
    this.stateError = "CopilotClient failed to start after all retries";
    this.emitBridgeStatus();
    logger.error(LOG_SOURCE, "CopilotClient failed to start after all retries — marking unavailable");
    throw new Error("Copilot SDK unavailable after retries");
  }

  /**
   * Handle a client crash: set error state, notify all sessions, attempt auto-restart.
   * Uses exponential backoff: 1s, 5s, 15s (max 3 retries).
   */
  private async handleCrash(): Promise<void> {
    this.state = "error";
    this.stateError = "CopilotClient process crashed";
    this.client = null;
    this.emitBridgeStatus();

    logger.error(LOG_SOURCE, "CopilotClient crashed — initiating recovery");

    // Notify all active session rooms
    this.emitToAllSessions("error", {
      message: "Copilot CLI process crashed",
      recoverable: true,
      reason: "cli-crashed",
    });

    // Clear dead sessions — old SDK session objects are unusable after crash
    this.sessions.clear();
    this.attachedListeners.clear();

    // Auto-restart with exponential backoff
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      this.retryCount = attempt + 1;
      const delay = RETRY_DELAYS_MS[attempt]!;
      logger.info(LOG_SOURCE, `Crash recovery attempt ${attempt + 1}/${MAX_RETRIES} in ${delay}ms`);
      await sleep(delay);

      try {
        const client = new CopilotClient();
        await client.start();
        this.client = client;
        this.state = "ready";
        this.stateError = undefined;
        this.retryCount = 0;
        logger.info(LOG_SOURCE, "CopilotClient recovered successfully");
        return;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(LOG_SOURCE, `Crash recovery attempt ${attempt + 1} failed: ${msg}`);
      }
    }

    // Exhausted retries
    this.state = "unavailable";
    this.stateError = "CopilotClient crashed and recovery failed after all retries";
    logger.error(LOG_SOURCE, "CopilotClient recovery exhausted — marking unavailable");

    this.emitToAllSessions("error", {
      message: "Copilot CLI is unavailable after crash recovery failed",
      recoverable: false,
      reason: "recovery-exhausted",
    });
  }

  async shutdown(): Promise<void> {
    logger.info(LOG_SOURCE, "Shutting down CopilotBridge...");

    // Abort all active sessions
    for (const [sessionId, managed] of this.sessions) {
      try {
        await managed.session.abort();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(LOG_SOURCE, `Error aborting session ${sessionId}: ${msg}`);
      }
    }
    this.sessions.clear();
    this.attachedListeners.clear();

    // Clear all pending callbacks
    this.rejectAllPending("CopilotBridge shutting down");

    // Stop client
    if (this.client) {
      try {
        await this.client.stop();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(LOG_SOURCE, `Error stopping CopilotClient: ${msg}`);
        try {
          await this.client.forceStop();
        } catch {
          // swallow
        }
      }
      this.client = null;
    }

    this.state = "not-initialized";
    this.stateError = undefined;
    logger.info(LOG_SOURCE, "CopilotBridge shut down");
  }

  // -----------------------------------------------------------------------
  // Model listing
  // -----------------------------------------------------------------------

  async listModels(): Promise<ModelInfo[]> {
    await this.ensureStarted();
    const models = await this.client!.listModels();
    for (const m of models) {
      this.modelCache.set(m.id, m);
    }
    return models;
  }

  private modelSupportsReasoning(modelId: string | undefined): boolean {
    if (!modelId) return false;
    const info = this.modelCache.get(modelId);
    if (!info) return false;
    return info.capabilities?.supports?.reasoningEffort === true;
  }

  // -----------------------------------------------------------------------
  // Session management
  // -----------------------------------------------------------------------

  async createChatSession(opts: CreateChatSessionOpts): Promise<string> {
    await this.ensureStarted();

    // Ensure model cache is populated for capability checks
    if (this.modelCache.size === 0) {
      await this.listModels();
    }

    const { projectId, model, reasoningEffort, title, context } = opts;

    const projectPath = getProjectRegistry().get(projectId)?.path;
    const systemPrompt = await this.assembleSystemPrompt(projectId);
    const fullSystemPrompt = title ? `# ${title}\n\n${systemPrompt}` : systemPrompt;
    const builtinTools = getBuiltinTools(projectId);

    let sessionConfig = this.buildSessionConfig(
      projectId, model, reasoningEffort, projectPath, fullSystemPrompt, builtinTools,
    );

    let sdkSession: Awaited<ReturnType<CopilotClient["createSession"]>>;
    try {
      sdkSession = await this.client!.createSession(sessionConfig);
    } catch (err) {
      // Retry without reasoningEffort if model doesn't support it
      const msg = err instanceof Error ? err.message : "";
      if (reasoningEffort && msg.includes("does not support reasoning effort")) {
        logger.info(LOG_SOURCE, `Model ${model} does not support reasoning effort, retrying without it`);
        sessionConfig = this.buildSessionConfig(
          projectId, model, undefined, projectPath, fullSystemPrompt, builtinTools,
        );
        sdkSession = await this.client!.createSession(sessionConfig);
      } else {
        throw err;
      }
    }
    const sessionId = sdkSession.sessionId;
    sdkSession.registerTools(builtinTools);

    // Register extension tools and agents (Task 7.3 / 7.4)
    this.registerExtensionToolsAndAgents(sdkSession, projectId);

    const now = new Date().toISOString();
    this.sessions.set(sessionId, {
      session: sdkSession, projectId, model: model ?? "default",
      title, createdAt: now, lastActivity: now,
      currentRoundId: null, activeToolCalls: new Set(),
      suppressNextTurnStart: false,
    });
    this.attachEventListeners(sdkSession, sessionId);

    await this.replayBranchContext(sdkSession, context);

    eventBus.publish("session:started", { projectId, sessionId, agent: "copilot-chat" });
    logger.info(LOG_SOURCE, `Chat session created: ${sessionId} for project ${projectId}`);
    return sessionId;
  }

  // -----------------------------------------------------------------------
  // Extension tools and agents registration (Task 7.3 / 7.4 / 7.5)
  // -----------------------------------------------------------------------

  private registerExtensionToolsAndAgents(
    sdkSession: CopilotSession,
    projectId: string,
  ): void {
    const extensions = listMounted(projectId);
    const port = getServerPort();

    for (const ext of extensions) {
      if (!this.canRegisterExtensionChat(ext, projectId)) continue;

      const manifest = ext.manifest;
      if (!manifest) continue;

      // Register chat tools (Task 7.3)
      this.registerExtensionChatTools(sdkSession, ext, manifest.chatTools ?? [], projectId, port);

      // Register chat agents (Task 7.4)
      this.registerExtensionChatAgents(sdkSession, ext, manifest.chatAgents ?? [], manifest.chatTools ?? []);
    }
  }

  private canRegisterExtensionChat(ext: MountedExtensionInfo, projectId: string): boolean {
    // Must have llm permission
    if (ext.manifest?.permissions?.llm !== true) return false;

    // Must not be suspended
    if (circuitBreaker.isSuspended(projectId, ext.name)) {
      logger.warn(LOG_SOURCE, `Skipping chat tools for suspended extension: ${ext.name}`);
      return false;
    }

    // Must be mounted
    if (ext.status !== "mounted") {
      logger.warn(LOG_SOURCE, `Skipping chat tools for ${ext.status} extension: ${ext.name}`);
      return false;
    }

    return true;
  }

  private registerExtensionChatTools(
    sdkSession: CopilotSession,
    ext: MountedExtensionInfo,
    chatTools: ChatToolDefinition[],
    projectId: string,
    port: number,
  ): void {
    const registeredTools: { name: string; description: string; parameters: Record<string, unknown>; handler: (args: Record<string, unknown>) => Promise<unknown> }[] = [];

    for (const tool of chatTools) {
      // Validate endpoint format: "METHOD /path"
      const endpointParts = tool.endpoint.split(" ");
      if (endpointParts.length < 2 || !endpointParts[1]) {
        logger.warn(LOG_SOURCE, `Skipping tool ${ext.name}__${tool.name}: invalid endpoint format "${tool.endpoint}"`);
        continue;
      }

      const namespacedName = `${ext.name}__${tool.name}`;
      const displayName = ext.manifest?.displayName ?? ext.name;

      registeredTools.push({
        name: namespacedName,
        description: `[${displayName}] ${tool.description}`,
        parameters: tool.parameters,
        handler: async (args: Record<string, unknown>) => {
          return this.callExtensionToolEndpoint(tool.endpoint, ext.name, namespacedName, projectId, port, args);
        },
      });
    }

    if (registeredTools.length > 0) {
      sdkSession.registerTools(registeredTools);
      logger.info(LOG_SOURCE, `Registered ${registeredTools.length} chat tools from extension ${ext.name}`);
    }
  }

  /**
   * Route an extension tool call to its backend endpoint.
   */
  private async callExtensionToolEndpoint(
    endpoint: string,
    extName: string,
    namespacedName: string,
    projectId: string,
    port: number,
    args: Record<string, unknown>,
  ): Promise<unknown> {
    const parts = endpoint.split(" ");
    const method = parts[0] ?? "POST";
    const path = parts.slice(1).join(" ");

    try {
      const url = `http://localhost:${port}/api/${projectId}/${extName}${path}`;
      const fetchOpts: RequestInit = {
        method,
        headers: { "Content-Type": "application/json" },
        ...(method !== "GET" ? { body: JSON.stringify(args) } : {}),
      };
      const response = await fetch(url, fetchOpts);
      return await response.json() as unknown;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(LOG_SOURCE, `Extension tool ${namespacedName} failed: ${msg}`);
      return { error: `Extension tool failed: ${msg}` };
    }
  }

  private registerExtensionChatAgents(
    sdkSession: CopilotSession,
    ext: MountedExtensionInfo,
    chatAgents: ChatAgentDefinition[],
    chatTools: ChatToolDefinition[],
  ): void {
    const validToolNames = new Set(chatTools.map((t) => t.name));

    for (const agent of chatAgents) {
      // Validate all referenced tools exist
      const invalidTools = agent.tools.filter((t) => !validToolNames.has(t));
      if (invalidTools.length > 0) {
        logger.warn(
          LOG_SOURCE,
          `Skipping agent ${ext.name}__${agent.name}: references invalid tools [${invalidTools.join(", ")}]`,
        );
        continue;
      }

      const namespacedName = `${ext.name}__${agent.name}`;
      const namespacedTools = agent.tools.map((t) => `${ext.name}__${t}`);

      try {
        (sdkSession as unknown as { registerCustomAgent: (config: Record<string, unknown>) => void }).registerCustomAgent({
          name: namespacedName,
          displayName: agent.displayName,
          description: agent.description,
          prompt: agent.prompt,
          tools: namespacedTools,
        });
        logger.info(LOG_SOURCE, `Registered chat agent: ${namespacedName}`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.warn(LOG_SOURCE, `Failed to register agent ${namespacedName}: ${msg}`);
      }
    }
  }

  private buildSessionConfig(
    projectId: string,
    model: string | undefined,
    reasoningEffort: string | undefined,
    projectPath: string | undefined,
    systemPrompt: string,
    tools: ReturnType<typeof getBuiltinTools>,
  ): SessionConfig {
    const config: SessionConfig = {
      systemMessage: { mode: "append" as const, content: systemPrompt },
      tools,
      onPermissionRequest: this.createPermissionHandler(projectId),
      infiniteSessions: { enabled: true },
    };
    if (model) config.model = model;
    if (reasoningEffort && this.modelSupportsReasoning(model)) {
      config.reasoningEffort = reasoningEffort as SessionConfig["reasoningEffort"];
    }
    if (projectPath) config.workingDirectory = projectPath;
    const configAny = config as unknown as Record<string, unknown>;
    configAny["onUserInputRequest"] = this.createUserInputHandler();
    return config;
  }

  private async replayBranchContext(
    sdkSession: CopilotSession,
    context?: Array<{ role: string; content: string }>,
  ): Promise<void> {
    if (!context || context.length === 0) return;
    for (const msg of context) {
      if (msg.role !== "user") continue;
      try {
        await sdkSession.send({ prompt: msg.content });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        logger.warn(LOG_SOURCE, `Failed to replay context message: ${errMsg}`);
      }
    }
  }

  async resumeSession(sessionId: string, projectId?: string): Promise<{ sessionId: string; projectId: string } | null> {
    await this.ensureStarted();

    const managed = this.sessions.get(sessionId);
    if (managed) {
      // Already tracked locally — re-attach listeners
      if (projectId && !managed.projectId) managed.projectId = projectId;
      this.attachEventListeners(managed.session, sessionId);
      return { sessionId, projectId: managed.projectId };
    }

    const resolvedProjectId = projectId ?? "";

    // Resume from SDK — requires a permission handler at minimum
    try {
      const projectPath = resolvedProjectId ? getProjectRegistry().get(resolvedProjectId)?.path : undefined;
      const builtinTools = resolvedProjectId ? getBuiltinTools(resolvedProjectId) : [];

      const resumeConfig: ResumeSessionConfig = {
        onPermissionRequest: this.createPermissionHandler(resolvedProjectId),
        onUserInputRequest: this.createUserInputHandler(),
        infiniteSessions: { enabled: true },
        ...(projectPath ? { workingDirectory: projectPath } : {}),
        ...(builtinTools.length > 0 ? { tools: builtinTools } : {}),
      };

      const sdkSession = await this.client!.resumeSession(sessionId, resumeConfig);
      if (builtinTools.length > 0) {
        sdkSession.registerTools(builtinTools);
      }
      if (resolvedProjectId) {
        this.registerExtensionToolsAndAgents(sdkSession, resolvedProjectId);
      }

      const now = new Date().toISOString();
      const resumedManaged: ManagedSession = {
        session: sdkSession,
        projectId: resolvedProjectId,
        model: "default",
        title: undefined,
        createdAt: now,
        lastActivity: now,
        currentRoundId: null,
        activeToolCalls: new Set(),
        suppressNextTurnStart: false,
      };

      this.sessions.set(sessionId, resumedManaged);
      this.attachEventListeners(sdkSession, sessionId);

      logger.info(LOG_SOURCE, `Session resumed: ${sessionId} for project ${resolvedProjectId}`);
      return { sessionId, projectId: resolvedProjectId };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(LOG_SOURCE, `Failed to resume session ${sessionId}: ${msg}`);
      return null;
    }
  }

  async sendMessage(
    sessionId: string,
    prompt: string,
    attachments?: ChatAttachment[],
  ): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      throw new Error(`Session ${sessionId} not found`);
    }

    managed.lastActivity = new Date().toISOString();

    // Reset round tracking for new user message
    managed.currentRoundId = null;
    managed.activeToolCalls.clear();

    const messageOpts: MessageOptions = {
      prompt,
      ...(attachments && attachments.length > 0
        ? {
            attachments: attachments.map((a) => {
              if (a.type === "file") {
                return { type: "file" as const, path: a.path, ...(a.displayName ? { displayName: a.displayName } : {}) };
              }
              if (a.type === "directory") {
                return { type: "directory" as const, path: a.path, ...(a.displayName ? { displayName: a.displayName } : {}) };
              }
              return { type: "file" as const, path: a.path, ...(a.displayName ? { displayName: a.displayName } : {}) };
            }),
          }
        : {}),
    };

    // Emit turn-start manually for immediate UI feedback.
    // Suppress the SDK's next assistant.turn_start so it doesn't duplicate this one.
    // Subsequent turn_starts (from tool-use → re-prompt) will still fire normally.
    managed.suppressNextTurnStart = true;
    this.emitToSession(sessionId, "turn-start", {
      sessionId,
      timestamp: new Date().toISOString(),
    });

    // send() returns a Promise<string> (messageId); events come through session event listeners
    await managed.session.send(messageOpts);
  }

  async cancelGeneration(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      throw new Error(`Session ${sessionId} not found`);
    }

    await managed.session.abort();
    managed.currentRoundId = null;
    managed.activeToolCalls.clear();
    this.emitToSession(sessionId, "idle", { sessionId, reason: "cancelled" });
    logger.debug(LOG_SOURCE, `Generation cancelled for session ${sessionId}`);
  }

  async listSessions(projectId?: string): Promise<Array<Record<string, unknown>>> {
    await this.ensureStarted();

    // Collect in-memory managed sessions (keyed by id for dedup)
    const resultsMap = new Map<string, Record<string, unknown>>();
    for (const [id, managed] of this.sessions) {
      if (projectId && managed.projectId !== projectId) continue;
      resultsMap.set(id, {
        id,
        projectId: managed.projectId,
        title: managed.title ?? null,
        model: managed.model,
        createdAt: managed.createdAt,
        lastMessageAt: managed.lastActivity,
        messageCount: 0,
      });
    }

    // Query SDK for persisted sessions (survives server restarts)
    try {
      const filter: SessionListFilter = {};
      if (projectId) {
        const projectPath = getProjectRegistry().get(projectId)?.path;
        if (projectPath) filter.cwd = projectPath;
      }
      const sdkSessions: SDKSessionMetadata[] = await this.client!.listSessions(filter);

      for (const sdk of sdkSessions) {
        // Skip sessions we already have in-memory (managed data is richer)
        if (resultsMap.has(sdk.sessionId)) continue;

        resultsMap.set(sdk.sessionId, {
          id: sdk.sessionId,
          projectId: projectId ?? "",
          title: sdk.summary ?? null,
          model: "default",
          createdAt: sdk.startTime.toISOString(),
          lastMessageAt: sdk.modifiedTime.toISOString(),
          messageCount: 0,
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(LOG_SOURCE, `Failed to list SDK sessions: ${msg}`);
      // Fall through — return whatever we have from in-memory
    }

    // Sort by lastMessageAt descending (most recent first)
    return Array.from(resultsMap.values()).sort((a, b) => {
      const ta = String(a["lastMessageAt"] ?? "");
      const tb = String(b["lastMessageAt"] ?? "");
      return tb.localeCompare(ta);
    });
  }

  async getSessionMessages(sessionId: string): Promise<SessionEvent[]> {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      throw new Error(`Session ${sessionId} not found`);
    }

    return managed.session.getMessages();
  }

  async getSessionMetadata(sessionId: string): Promise<Record<string, unknown> | null> {
    const managed = this.sessions.get(sessionId);
    if (!managed) {
      return null;
    }

    return {
      id: sessionId,
      projectId: managed.projectId,
      model: managed.model,
      title: managed.title ?? null,
      createdAt: managed.createdAt,
      lastMessageAt: managed.lastActivity,
      messageCount: 0,
    };
  }

  async deleteSession(sessionId: string): Promise<boolean> {
    const managed = this.sessions.get(sessionId);

    if (managed) {
      try {
        await managed.session.disconnect();
      } catch {
        // Session may already be disconnected
      }

      eventBus.publish("session:ended", {
        projectId: managed.projectId,
        sessionId,
        agent: "copilot-chat",
      });

      this.sessions.delete(sessionId);
      this.attachedListeners.delete(sessionId);
    }

    // Always attempt SDK deletion — session may be persisted but not in memory
    try {
      await this.client!.deleteSession(sessionId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // If session wasn't in memory AND SDK deletion failed, it truly doesn't exist
      if (!managed) {
        logger.warn(LOG_SOURCE, `Session ${sessionId} not found in memory or SDK: ${msg}`);
        return false;
      }
      logger.warn(LOG_SOURCE, `Error deleting session from SDK: ${msg}`);
    }

    logger.info(LOG_SOURCE, `Session deleted: ${sessionId}`);
    return true;
  }

  /**
   * Close an ephemeral session without persisting to SDK storage.
   * Used by AutomationEngine for per-step sessions that create dozens
   * of sessions per run and should not pollute the session list.
   * ADR-047 amendment: public closeSession() for automation cleanup.
   */
  async closeSession(sessionId: string): Promise<void> {
    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    try {
      await managed.session.disconnect();
    } catch {
      // Session may already be disconnected
    }

    this.sessions.delete(sessionId);
    this.attachedListeners.delete(sessionId);
    logger.debug(LOG_SOURCE, `Ephemeral session closed: ${sessionId}`);
  }

  // -----------------------------------------------------------------------
  // Permission / Input / Elicitation callback resolution
  // -----------------------------------------------------------------------

  resolvePermission(requestId: string, result: PermissionRequestResult): void {
    const pending = this.pendingPermissions.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingPermissions.delete(requestId);
      pending.resolve(result);
    }
  }

  resolveInput(requestId: string, response: UserInputResponse): void {
    const pending = this.pendingInputs.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingInputs.delete(requestId);
      pending.resolve(response);
    }
  }

  resolveElicitation(requestId: string, response: Record<string, unknown>): void {
    const pending = this.pendingElicitations.get(requestId);
    if (pending) {
      clearTimeout(pending.timer);
      this.pendingElicitations.delete(requestId);
      pending.resolve(response);
    }
  }

  // -----------------------------------------------------------------------
  // System prompt assembly (Task 4.4)
  // -----------------------------------------------------------------------

  private async assembleSystemPrompt(projectId: string): Promise<string> {
    const parts: string[] = [];

    // Project info header
    const registry = getProjectRegistry();
    const project = registry.get(projectId);
    if (project) {
      parts.push(`Project: ${project.name}`);
      parts.push(`Path: ${project.path}`);

      // List installed extensions
      if (project.mountedExtensions.length > 0) {
        const extList = project.mountedExtensions
          .filter((ext) => ext.status === "mounted")
          .map((ext) => `  - ${ext.name} (v${ext.version})`)
          .join("\n");
        if (extList) {
          parts.push(`\nInstalled Extensions:\n${extList}`);
        }
      }
    }

    // Context from recipe engine
    try {
      const ctx = await assemble(projectId, DEFAULT_SYSTEM_PROMPT_TOKEN_BUDGET);
      if (ctx.content) {
        parts.push("");
        parts.push(ctx.content);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(LOG_SOURCE, `Context recipe assembly failed: ${msg}`);
    }

    if (parts.length === 0) {
      return buildDefaultSystemPrompt(projectId);
    }

    return parts.join("\n");
  }

  // -----------------------------------------------------------------------
  // SDK Event listeners (Task 4.6)
  // -----------------------------------------------------------------------

  private attachEventListeners(sdkSession: CopilotSession, sessionId: string): void {
    // Prevent duplicate listeners — SDK .on() adds listeners, doesn't replace
    if (this.attachedListeners.has(sessionId)) return;
    this.attachedListeners.add(sessionId);

    const managed = this.sessions.get(sessionId);
    if (!managed) return;

    sdkSession.on((event: SessionEvent) => {
      const data = (event as unknown as { data: Record<string, unknown> }).data ?? {};
      const handler = this.eventDispatch[event.type];
      if (handler) {
        handler(sessionId, managed, data);
      } else {
        logger.debug(LOG_SOURCE, `Unhandled SDK event: ${event.type}`);
      }
    });
  }

  /**
   * Dispatch table mapping SDK event types to handler methods.
   * Each handler receives (sessionId, managed, data).
   */
  private eventDispatch: Record<string, (sid: string, m: ManagedSession, d: Record<string, unknown>) => void> = {
    "assistant.message_delta": (sid, _m, d) => {
      this.emitToSession(sid, "message-delta", { sessionId: sid, delta: String(d["deltaContent"] ?? d["content"] ?? "") });
    },
    "assistant.message": (sid, _m, d) => {
      this.emitToSession(sid, "message", { sessionId: sid, content: String(d["content"] ?? ""), role: "assistant" });
    },
    "assistant.reasoning_delta": (sid, _m, d) => {
      this.emitToSession(sid, "reasoning-delta", { sessionId: sid, delta: String(d["deltaContent"] ?? d["content"] ?? ""), tokens: typeof d["tokens"] === "number" ? d["tokens"] : undefined });
    },
    "assistant.reasoning": (sid, _m, d) => {
      this.emitToSession(sid, "reasoning", { sessionId: sid, content: String(d["content"] ?? ""), tokens: d["tokens"] ?? 0 });
    },
    "assistant.turn_start": (sid, m, _d) => {
      // sendMessage sets suppressNextTurnStart=true to avoid duplicating
      // the manual turn-start it emitted. But subsequent turns (tool-use →
      // re-prompt within a single send()) must still emit turn-start.
      if (m.suppressNextTurnStart) {
        m.suppressNextTurnStart = false;
        return;
      }
      this.emitToSession(sid, "turn-start", { sessionId: sid, timestamp: new Date().toISOString() });
    },
    "assistant.turn_end": (sid, _m, d) => {
      this.emitToSession(sid, "turn-end", { sessionId: sid, turnId: d["turnId"] ?? "", timestamp: new Date().toISOString() });
    },
    "tool.execution_start": (sid, m, d) => {
      this.handleToolStart(sid, m, d);
    },
    "tool.execution_partial_result": (sid, m, d) => {
      this.emitToSession(sid, "tool-partial", { sessionId: sid, roundId: m.currentRoundId, toolCallId: String(d["toolCallId"] ?? ""), delta: String(d["partialOutput"] ?? d["content"] ?? "") });
    },
    "tool.execution_progress": (sid, m, d) => {
      this.emitToSession(sid, "tool-progress", { sessionId: sid, roundId: m.currentRoundId, toolCallId: String(d["toolCallId"] ?? ""), progress: d["progress"] ?? 0, message: String(d["progressMessage"] ?? d["message"] ?? "") });
    },
    "tool.execution_complete": (sid, m, d) => {
      this.handleToolComplete(sid, m, d);
    },
    "subagent.started": (sid, m, d) => {
      this.handleSubagentStarted(sid, m, d);
    },
    "subagent.completed": (sid, m, d) => {
      this.handleSubagentCompleted(sid, m, d);
    },
    "subagent.failed": (sid, _m, d) => {
      this.emitToSession(sid, "subagent-failed", { sessionId: sid, toolCallId: String(d["toolCallId"] ?? ""), agentName: String(d["agentName"] ?? "unknown"), error: String(d["error"] ?? d["message"] ?? "Unknown error") });
    },
    // permission.requested, user_input.requested, elicitation.requested:
    // These are handled by the onPermissionRequest / onUserInputRequest callbacks
    // in createPermissionHandler / createUserInputHandler. The callbacks generate
    // their own requestId and create pending promises. If we ALSO emitted here
    // (with the SDK's different requestId), the client would get two events per
    // request — the second would overwrite pendingPermission with an unresolvable
    // requestId, causing the bridge to time out and auto-deny.
    "permission.requested": () => { /* handled by onPermissionRequest callback */ },
    "user_input.requested": () => { /* handled by onUserInputRequest callback */ },
    "elicitation.requested": () => { /* handled via separate callback if wired */ },
    "session.title_changed": (sid, m, d) => {
      m.title = String(d["title"] ?? "");
      this.emitToSession(sid, "title-changed", { sessionId: sid, title: m.title });
    },
    "session.compaction_start": (sid, _m, _d) => {
      this.emitToSession(sid, "compaction-start", { sessionId: sid });
    },
    "session.compaction_complete": (sid, _m, d) => {
      this.emitToSession(sid, "compaction-complete", { sessionId: sid, tokensRemoved: d["tokensRemoved"] ?? 0, summary: String(d["summary"] ?? "") });
    },
    "session.usage_info": (sid, _m, d) => {
      this.emitToSession(sid, "usage", { sessionId: sid, contextWindowPct: d["contextWindowPct"] ?? 0, promptTokens: d["promptTokens"] ?? 0, completionTokens: d["completionTokens"] ?? 0, totalTokens: d["totalTokens"] ?? 0 });
    },
    "session.idle": (sid, m, _d) => {
      m.currentRoundId = null;
      m.activeToolCalls.clear();
      this.emitToSession(sid, "idle", { sessionId: sid });
    },
    "session.error": (sid, m, d) => {
      this.handleSessionError(sid, m, d);
    },
  };

  private handleToolStart(sid: string, m: ManagedSession, d: Record<string, unknown>): void {
    const toolCallId = String(d["toolCallId"] ?? randomUUID());
    if (m.activeToolCalls.size === 0) m.currentRoundId = randomUUID();
    m.activeToolCalls.add(toolCallId);
    this.emitToSession(sid, "tool-start", {
      sessionId: sid, roundId: m.currentRoundId,
      toolName: typeof d["toolName"] === "string" ? d["toolName"] : "unknown",
      toolArgs: (d["arguments"] ?? {}) as Record<string, unknown>, toolCallId,
    });
  }

  private handleToolComplete(sid: string, m: ManagedSession, d: Record<string, unknown>): void {
    const toolCallId = String(d["toolCallId"] ?? "");
    m.activeToolCalls.delete(toolCallId);
    this.emitToSession(sid, "tool-complete", {
      sessionId: sid, roundId: m.currentRoundId, toolCallId,
      toolName: typeof d["toolName"] === "string" ? d["toolName"] : "unknown",
      result: (d["result"] ?? {}) as Record<string, unknown>,
      success: typeof d["success"] === "boolean" ? d["success"] : true,
      ...(d["error"] ? { error: d["error"] } : {}),
    });
    if (m.activeToolCalls.size === 0) m.currentRoundId = null;
  }

  private handleSubagentStarted(sid: string, _m: ManagedSession, d: Record<string, unknown>): void {
    const agentName = typeof d["agentName"] === "string" ? d["agentName"] : "unknown";
    this.emitToSession(sid, "subagent-start", {
      sessionId: sid, toolCallId: String(d["toolCallId"] ?? ""),
      agentName, agentDisplayName: String(d["agentDisplayName"] ?? agentName),
    });
  }

  private handleSubagentCompleted(sid: string, _m: ManagedSession, d: Record<string, unknown>): void {
    const agentName = typeof d["agentName"] === "string" ? d["agentName"] : "unknown";
    this.emitToSession(sid, "subagent-complete", {
      sessionId: sid, toolCallId: String(d["toolCallId"] ?? ""), agentName,
    });
  }

  private handleSessionError(sid: string, _m: ManagedSession, d: Record<string, unknown>): void {
    const errorMsg = typeof d["message"] === "string" ? d["message"] : "Unknown error";
    const errorType = typeof d["errorType"] === "string" ? d["errorType"] : "unknown";
    this.emitToSession(sid, "error", { sessionId: sid, message: errorMsg, errorType });
    if (errorType === "system") {
      this.handleCrash().catch((err) => {
        logger.error(LOG_SOURCE, `Crash recovery failed: ${err instanceof Error ? err.message : String(err)}`);
      });
    }
  }

  // -----------------------------------------------------------------------
  // Permission handler (Task 4.7)
  // -----------------------------------------------------------------------

  private createPermissionHandler(_projectId: string): PermissionHandler {
    return async (request: PermissionRequest, invocation: { sessionId: string }): Promise<PermissionRequestResult> => {
      const requestId = randomUUID();
      const toolName = typeof request["toolName"] === "string"
        ? request["toolName"]
        : request.kind;
      const description = typeof request["description"] === "string"
        ? request["description"]
        : "";

      // Forward to UI for user decision
      const targetSessionId = invocation.sessionId;
      this.emitToSession(targetSessionId, "permission-request", {
        requestId,
        sessionId: targetSessionId,
        permissionKind: String(request.kind ?? "custom-tool"),
        title: toolName,
        message: description ?? `Allow ${toolName}?`,
      });

      // Wait for user resolution with 30s timeout — auto-deny
      return new Promise<PermissionRequestResult>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingPermissions.delete(requestId);
          resolve({
            kind: "denied-no-approval-rule-and-could-not-request-from-user",
          });
        }, CALLBACK_TIMEOUT_MS);

        this.pendingPermissions.set(requestId, { resolve, reject, timer });
      });
    };
  }

  // -----------------------------------------------------------------------
  // User input handler (Task 4.7)
  // -----------------------------------------------------------------------

  private createUserInputHandler() {
    return async (
      request: { question: string; choices?: string[]; allowFreeform?: boolean },
      invocation: { sessionId: string },
    ): Promise<UserInputResponse> => {
      const requestId = randomUUID();
      const question = request.question;
      const choices = request.choices;

      const targetSessionId = invocation.sessionId;
      this.emitToSession(targetSessionId, "input-request", {
        requestId,
        sessionId: targetSessionId,
        prompt: question,
        ...(choices ? { choices } : {}),
      });

      // Wait for user resolution with 30s timeout — return empty response
      return new Promise<UserInputResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
          this.pendingInputs.delete(requestId);
          resolve({ answer: "", wasFreeform: false });
        }, CALLBACK_TIMEOUT_MS);

        this.pendingInputs.set(requestId, { resolve, reject, timer });
      });
    };
  }

  // -----------------------------------------------------------------------
  // Cleanup helpers
  // -----------------------------------------------------------------------

  private rejectAllPending(reason: string): void {
    const error = new Error(reason);

    for (const [, pending] of this.pendingPermissions) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingPermissions.clear();

    for (const [, pending] of this.pendingInputs) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingInputs.clear();

    for (const [, pending] of this.pendingElicitations) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pendingElicitations.clear();
  }

  // -----------------------------------------------------------------------
  // Managed session access (for route handlers)
  // -----------------------------------------------------------------------

  getSession(sessionId: string): ManagedSession | undefined {
    return this.sessions.get(sessionId);
  }

  getManagedSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function buildDefaultSystemPrompt(projectId: string): string {
  return [
    "You are an AI assistant working on a software project.",
    `Project ID: ${projectId}`,
    "",
    "Follow the project's conventions and coding standards.",
    "When making changes, explain your reasoning.",
    "Ask for clarification when requirements are ambiguous.",
  ].join("\n");
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const copilotBridge = new CopilotBridge();
