// RenRe Kit Extension SDK
// Types and utilities for building RenRe Kit extensions

import type { Router } from "express";
import type { ComponentType } from "react";
import type { ScopedScheduler } from "./types/scheduler.js";

export type HookEvent =
  | "sessionStart"
  | "sessionEnd"
  | "userPromptSubmitted"
  | "preToolUse"
  | "postToolUse"
  | "errorOccurred"
  | "preCompact"
  | "subagentStart"
  | "subagentStop";

export type SettingType = "string" | "vault" | "number" | "boolean" | "select";

export type PermissionDecision = "allow" | "deny" | "ask";

export interface ScopedStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface ScopedDatabase {
  readonly tablePrefix: string;
  readonly projectId: string;
  prepare(sql: string): ScopedStatement;
  exec(sql: string): void;
}

export interface ExtensionLogger {
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

export interface MCPClient {
  listTools(): Promise<MCPTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  listResources(): Promise<MCPResource[]>;
  readResource(uri: string): Promise<unknown>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPResource {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
}

// ---- LLM types (ADR-047 §8: Extension LLM Access) ----

export type ReasoningEffort = "low" | "medium" | "high" | "xhigh";

export interface LLMModelInfo {
  id: string;
  name: string;
  supportsVision: boolean;
  supportsReasoning: boolean;
  supportedReasoningEfforts?: ReasoningEffort[];
  maxContextTokens: number;
}

export interface LLMAttachment {
  type: "file" | "directory" | "selection";
  path: string;
  displayName?: string;
}

export interface LLMCompleteRequest {
  prompt: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  systemPrompt?: string;
  attachments?: LLMAttachment[];
  maxTokens?: number;
}

export interface LLMCompleteResponse {
  content: string;
  reasoning?: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
}

export interface LLMStreamRequest {
  prompt: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  systemPrompt?: string;
  attachments?: LLMAttachment[];
  maxTokens?: number;
}

export type LLMStreamHandler = {
  onDelta?: (delta: string) => void;
  onReasoning?: (delta: string) => void;
  onComplete?: (response: LLMCompleteResponse) => void;
  onError?: (error: Error) => void;
};

export interface LLMSessionOpts {
  model?: string;
  reasoningEffort?: ReasoningEffort;
  systemPrompt?: string;
}

export interface LLMSessionMessage {
  role: "user" | "assistant";
  content: string;
  reasoning?: string;
  timestamp: number;
}

export interface LLMSession {
  readonly sessionId: string;
  send(prompt: string, attachments?: LLMAttachment[]): Promise<LLMCompleteResponse>;
  stream(prompt: string, handler: LLMStreamHandler, attachments?: LLMAttachment[]): Promise<void>;
  getMessages(): Promise<LLMSessionMessage[]>;
  disconnect(): Promise<void>;
}

export interface ScopedLLM {
  listModels(): Promise<LLMModelInfo[]>;
  complete(request: LLMCompleteRequest): Promise<LLMCompleteResponse>;
  stream(request: LLMStreamRequest, handler: LLMStreamHandler): Promise<void>;
  createSession(opts?: LLMSessionOpts): Promise<LLMSession>;
}

// ---- Chat Tool / Agent types (ADR-047 §9: Extension Tools & Custom Agents) ----

export interface ChatToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  endpoint: string; // "GET /path" or "POST /path"
  /** Optional display hints for Console UI chat tool rendering (ADR-052 §1.6) */
  toolDisplay?: {
    /** Mustache-style intent template, e.g. "Deploy to {{environment}}" */
    intent?: string;
    /** Argument keys to show in standard mode */
    keyArgs?: string[];
    /** Result summary mode: "short" = first line, or omit for fallback */
    resultSummary?: string;
  };
}

export interface ChatAgentDefinition {
  name: string;
  displayName: string;
  description: string;
  prompt: string;
  tools: string[];
}

export interface ExtensionContext {
  projectId: string;
  projectDir: string;
  db: ScopedDatabase | null;
  logger: ExtensionLogger;
  config: Record<string, string>;
  mcp: MCPClient | null;
  llm: ScopedLLM | null;
  scheduler: ScopedScheduler | null;
}

export interface ExtensionPageProps {
  projectId: string;
  extensionName: string;
  apiBaseUrl: string;
}

export interface ExtensionModule {
  pages: Record<string, ComponentType<ExtensionPageProps>>;
}

export interface UIPage {
  id: string;
  label: string;
  icon?: string;
  path: string;
}

export interface ActionDefinition {
  name: string;
  description: string;
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH";
  path: string;
}

export interface SettingDefinition {
  key: string;
  type: SettingType;
  label: string;
  description?: string;
  required?: boolean;
  default?: string | number | boolean;
  options?: { label: string; value: string }[];
}

export interface ExtensionPermissions {
  database?: boolean;
  network?: string[];
  mcp?: boolean;
  hooks?: HookEvent[];
  vault?: string[];
  filesystem?: string[];
  llm?: boolean;
  scheduler?: boolean;
}

export interface ExtensionHookConfig {
  events: HookEvent[];
  entrypoint: string;
  timeout?: number;
}

export interface SkillDefinition {
  name: string;
  description: string;
  file: string;
}

/** Extension backend entry point — the default export of `backend/index.ts` */
export type ExtensionRouterFactory = (context: ExtensionContext) => Router;

export interface ContextProviderManifest {
  entrypoint: string;
  maxTokens?: number;
}

// ---- Context Provider types (ADR-036) ----

export interface ProviderSettingDefinition {
  key: string;
  label: string;
  type: "string" | "number" | "boolean" | "select";
  default: unknown;
  description?: string;
  options?: { label: string; value: string }[];
}

export interface FullContextProviderManifest {
  name: string;
  description: string;
  icon?: string;
  defaultEnabled: boolean;
  configSchema?: ProviderSettingDefinition[];
}

export interface ContextRequest {
  projectId: string;
  config: Record<string, unknown>;
  tokenBudget: number;
  sessionInput: {
    timestamp: number;
    cwd: string;
    source: string;
    initialPrompt?: string;
    sessionId?: string;
  };
}

export interface ContextResponse {
  content: string;
  estimatedTokens: number;
  itemCount: number;
  truncated: boolean;
  metadata?: {
    lastUpdated?: string;
    source?: string;
  };
}

export interface MCPStdioConfig {
  transport: "stdio";
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface MCPSSEConfig {
  transport: "sse";
  url: string;
  headers?: Record<string, string>;
  reconnect?: boolean;
  reconnectIntervalMs?: number;
}

export interface ExtensionManifest {
  name: string;
  version: string;
  displayName: string;
  description: string;
  author: string;
  minSdkVersion?: string;
  backend?: {
    entrypoint: string;
    actions?: ActionDefinition[];
  };
  ui?: {
    pages: UIPage[];
    bundle: string;
    styles?: string;
  };
  mcp?: MCPStdioConfig | MCPSSEConfig;
  migrations?: string;
  settings?: {
    schema: SettingDefinition[];
  };
  permissions?: ExtensionPermissions;
  hooks?: ExtensionHookConfig;
  skills?: SkillDefinition[];
  contextProvider?: ContextProviderManifest;
  chatTools?: ChatToolDefinition[];
  chatAgents?: ChatAgentDefinition[];
}

export { SDK_VERSION } from "./version.js";

// ---- Scheduler types (ADR-050 §16.4) ----
export type {
  ScopedScheduler,
  CronJobOptions,
  CronJobContext,
  CronJobInfo,
  CronJobRun,
} from "./types/scheduler.js";
