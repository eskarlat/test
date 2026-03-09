// Chat type definitions — ADR-047 §6.5

// ---------------------------------------------------------------------------
// Content blocks — discriminated union
// ---------------------------------------------------------------------------

export interface TextBlock {
  type: "text";
  content: string;
}

export interface ReasoningBlock {
  type: "reasoning";
  content: string;
  tokens?: number;
  collapsed: boolean;
}

export interface ToolExecutionBlock {
  type: "tool-execution";
  toolCallId: string;
  roundId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  argumentsStreaming?: string;
  mcpServerName?: string;
  status: "pending" | "validating" | "running" | "complete" | "error";
  result?: ToolResult;
  error?: string;
  partialOutput?: string;
  progressMessage?: string;
  duration?: number;
  isHistorical: boolean;
}

export interface ToolResult {
  content: string;
  detailedContent?: string;
  contents?: ToolResultContent[];
}

export type ToolResultContent =
  | { type: "text"; text: string }
  | { type: "terminal"; text: string; exitCode?: number; cwd?: string }
  | { type: "image"; data: string; mimeType: string }
  | { type: "resource_link"; uri: string; title?: string };

export interface SubagentBlock {
  type: "subagent";
  toolCallId: string;
  agentName: string;
  agentDisplayName: string;
  agentDescription?: string;
  status: "running" | "complete" | "failed";
  error?: string;
  duration?: number;
  nestedBlocks?: ContentBlock[];
}

export interface FileDiffBlock {
  type: "file-diff";
  fileName: string;
  diff: string;
  newFileContents?: string;
  intention?: string;
  isNewFile: boolean;
  edits: FileEdit[];
  isDone: boolean;
}

export interface FileEdit {
  range: { startLine: number; endLine: number };
  newText: string;
}

export interface ConfirmationBlock {
  type: "confirmation";
  requestId: string;
  title: string;
  message: string;
  permissionKind: "shell" | "write" | "read" | "mcp" | "url" | "custom-tool";
  diff?: string;
  status: "pending" | "approved" | "denied";
}

export interface ProgressBlock {
  type: "progress";
  message: string;
}

export interface WarningBlock {
  type: "warning";
  message: string;
}

export interface CompactionBlock {
  type: "compaction";
  tokensRemoved: number;
  summary?: string;
  checkpointPath?: string;
}

export interface ImageBlock {
  type: "image";
  data: string;
  mimeType: string;
  alt?: string;
}

export interface TerminalBlock {
  type: "terminal";
  text: string;
  exitCode?: number;
  cwd?: string;
}

export type ContentBlock =
  | TextBlock
  | ReasoningBlock
  | ToolExecutionBlock
  | SubagentBlock
  | FileDiffBlock
  | ConfirmationBlock
  | ProgressBlock
  | WarningBlock
  | CompactionBlock
  | ImageBlock
  | TerminalBlock;

// ---------------------------------------------------------------------------
// Tool round grouping
// ---------------------------------------------------------------------------

export interface ToolRound {
  type: "tool-round";
  roundId: string;
  tools: ToolExecutionBlock[];
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

export interface ChatMessage {
  id: string;
  parentId?: string;
  role: "user" | "assistant" | "system";
  blocks: ContentBlock[];
  timestamp: string;
  attachments?: Attachment[];
  isStreaming: boolean;
}

// ---------------------------------------------------------------------------
// Attachments
// ---------------------------------------------------------------------------

export interface FileAttachment {
  type: "file";
  path: string;
  displayName?: string;
}

export interface DirectoryAttachment {
  type: "directory";
  path: string;
  displayName?: string;
}

export interface SelectionAttachment {
  type: "selection";
  filePath: string;
  displayName?: string;
  selection: {
    start: { line: number; character: number };
    end: { line: number; character: number };
  };
  text: string;
}

export type Attachment = FileAttachment | DirectoryAttachment | SelectionAttachment;

// ---------------------------------------------------------------------------
// Session metadata
// ---------------------------------------------------------------------------

export interface BranchedFrom {
  sessionId: string;
  messageIndex: number;
  timestamp: string;
}

export interface SessionMetadata {
  id: string;
  projectId: string;
  title?: string;
  model: string;
  reasoningEffort?: string;
  createdAt: string;
  lastMessageAt?: string;
  messageCount: number;
  branchedFrom?: BranchedFrom;
}

// ---------------------------------------------------------------------------
// Model info
// ---------------------------------------------------------------------------

export interface ModelInfo {
  id: string;
  name: string;
  supportsReasoning: boolean;
  supportedReasoningEfforts?: string[];
  supportsVision: boolean;
}

// ---------------------------------------------------------------------------
// Active tool / subagent tracking (store types)
// ---------------------------------------------------------------------------

export interface ToolExecution {
  toolCallId: string;
  roundId: string;
  toolName: string;
  status: "pending" | "validating" | "running" | "complete" | "error";
  startedAt: number;
}

export interface SubagentExecution {
  toolCallId: string;
  agentName: string;
  status: "running" | "complete" | "failed";
  startedAt: number;
}

// ---------------------------------------------------------------------------
// Pending interaction requests
// ---------------------------------------------------------------------------

export interface PermissionRequest {
  requestId: string;
  title: string;
  message: string;
  permissionKind: string;
  diff?: string;
}

export interface InputRequest {
  requestId: string;
  prompt: string;
}

export interface ElicitationRequest {
  requestId: string;
  schema: Record<string, unknown>;
  message?: string;
}
