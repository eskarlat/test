/**
 * Shared Socket.IO chat event handler factories — eliminates duplication
 * between useChatSocket (legacy single-session) and usePaneSocket (multi-pane).
 * Both paths produce the same handler shapes but target different state update functions.
 */

import type { ChatState } from "../stores/chat-store";
import { uuid } from "./utils";
import type { ChatMessage, ContentBlock } from "../types/chat";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatErrorValue(err: unknown): string | undefined {
  if (!err) return undefined;
  if (typeof err === "object") return JSON.stringify(err);
  return String(err);
}

export function extractResultContent(resultObj: Record<string, unknown>): string {
  if (typeof resultObj === "object" && resultObj !== null && "content" in resultObj && typeof resultObj.content === "string") {
    return resultObj.content;
  }
  return JSON.stringify(resultObj, null, 2);
}

// ---------------------------------------------------------------------------
// Tool/subagent state update helpers
// ---------------------------------------------------------------------------

export function buildToolStartUpdate(
  sessionId: string,
  data: { toolCallId: string; roundId: string; toolName: string; toolArgs?: Record<string, unknown> },
): (s: ChatState) => Partial<ChatState> {
  const block: ContentBlock = {
    type: "tool-execution",
    toolCallId: data.toolCallId,
    roundId: data.roundId,
    toolName: data.toolName,
    arguments: data.toolArgs ?? {},
    status: "running",
    isHistorical: false,
  };

  return (s) => {
    const tools = new Map(s.activeTools);
    tools.set(data.toolCallId, { ...data, status: "running", startedAt: Date.now() });

    const msgs = new Map(s.messages);
    appendBlockToLastAssistant(msgs, sessionId, block);
    return { activeTools: tools, messages: msgs };
  };
}

export function buildToolCompleteUpdate(
  sessionId: string,
  data: { toolCallId: string; toolName?: string; result?: Record<string, unknown>; success?: boolean; error?: unknown },
): (s: ChatState) => Partial<ChatState> {
  return (s) => {
    const tools = new Map(s.activeTools);
    const tracked = tools.get(data.toolCallId);
    const duration = tracked ? Date.now() - tracked.startedAt : undefined;
    tools.delete(data.toolCallId);

    const msgs = new Map(s.messages);
    const list = msgs.get(sessionId) ?? [];
    const errorStr = formatErrorValue(data.error);
    const updatedList = updateToolBlock(list, data.toolCallId, (oldBlock) => {
      const updated = {
        ...oldBlock,
        status: (data.success === false ? "error" : "complete") as "error" | "complete",
        result: { content: extractResultContent(data.result ?? {}) },
      };
      if (errorStr) updated.error = errorStr;
      if (duration != null) updated.duration = duration;
      return updated;
    });
    msgs.set(sessionId, updatedList);
    return { activeTools: tools, messages: msgs };
  };
}

export function buildSubagentStartUpdate(
  sessionId: string,
  data: { toolCallId: string; agentName: string; agentDisplayName?: string },
): (s: ChatState) => Partial<ChatState> {
  const block: ContentBlock = {
    type: "subagent",
    toolCallId: data.toolCallId,
    agentName: data.agentName,
    agentDisplayName: data.agentDisplayName ?? data.agentName,
    status: "running",
  };

  return (s) => {
    const subs = new Map(s.activeSubagents);
    subs.set(data.toolCallId, { ...data, status: "running", startedAt: Date.now() });

    const msgs = new Map(s.messages);
    appendBlockToLastAssistant(msgs, sessionId, block);
    return { activeSubagents: subs, messages: msgs };
  };
}

export function buildSubagentCompleteUpdate(
  sessionId: string,
  data: { toolCallId: string },
): (s: ChatState) => Partial<ChatState> {
  return (s) => {
    const subs = new Map(s.activeSubagents);
    const tracked = subs.get(data.toolCallId);
    const duration = tracked ? Date.now() - tracked.startedAt : undefined;
    subs.delete(data.toolCallId);

    const msgs = new Map(s.messages);
    const list = msgs.get(sessionId) ?? [];
    const updatedList = updateSubagentBlock(list, data.toolCallId, (oldBlock) => ({
      ...oldBlock,
      status: "complete" as const,
      ...(duration != null ? { duration } : {}),
    }));
    msgs.set(sessionId, updatedList);
    return { activeSubagents: subs, messages: msgs };
  };
}

export function buildCompactionCompleteUpdate(
  sessionId: string,
  data: { tokensRemoved: number; summary?: string },
): (s: ChatState) => Partial<ChatState> {
  const block: ContentBlock = {
    type: "compaction",
    tokensRemoved: data.tokensRemoved,
    ...(data.summary ? { summary: data.summary } : {}),
  };
  return (s) => {
    const next = new Map(s.messages);
    const msgs = next.get(sessionId);
    if (!msgs) return {};
    const updated = msgs.map((m) =>
      m.blocks.length === 1 && m.blocks[0]?.type === "compaction" && m.blocks[0].tokensRemoved === 0
        ? { ...m, blocks: [block] }
        : m,
    );
    next.set(sessionId, updated);
    return { messages: next };
  };
}

export function createStreamingAssistantMessage(): ChatMessage {
  return {
    id: uuid(),
    role: "assistant",
    blocks: [],
    timestamp: new Date().toISOString(),
    isStreaming: true,
  };
}

export function createCompactionStartMessage(): ChatMessage {
  const block: ContentBlock = { type: "compaction", tokensRemoved: 0, summary: "Compacting..." };
  return {
    id: `compaction-${Date.now()}`,
    role: "system",
    blocks: [block],
    timestamp: new Date().toISOString(),
    isStreaming: false,
  };
}

export function createErrorMessage(message: string): ChatMessage {
  const block: ContentBlock = { type: "warning", message };
  return {
    id: uuid(),
    role: "system",
    blocks: [block],
    timestamp: new Date().toISOString(),
    isStreaming: false,
  };
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Append a content block to the last assistant message for a session. */
function appendBlockToLastAssistant(
  messages: Map<string, ChatMessage[]>,
  sessionId: string,
  block: ContentBlock,
): void {
  const list = messages.get(sessionId) ?? [];
  const last = list[list.length - 1];
  if (last?.role === "assistant") {
    const updated = { ...last, blocks: [...last.blocks, block] };
    messages.set(sessionId, [...list.slice(0, -1), updated]);
  }
}

function updateToolBlock(
  messages: ChatMessage[],
  toolCallId: string,
  updater: (block: import("../types/chat").ToolExecutionBlock) => ContentBlock,
): ChatMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    const blockIdx = msg.blocks.findIndex(
      (b) => b.type === "tool-execution" && b.toolCallId === toolCallId,
    );
    if (blockIdx < 0) return msg;
    const oldBlock = msg.blocks[blockIdx] as import("../types/chat").ToolExecutionBlock;
    const blocks = [...msg.blocks];
    blocks[blockIdx] = updater(oldBlock);
    return { ...msg, blocks };
  });
}

function updateSubagentBlock(
  messages: ChatMessage[],
  toolCallId: string,
  updater: (block: import("../types/chat").SubagentBlock) => ContentBlock,
): ChatMessage[] {
  return messages.map((msg) => {
    if (msg.role !== "assistant") return msg;
    const blockIdx = msg.blocks.findIndex(
      (b) => b.type === "subagent" && b.toolCallId === toolCallId,
    );
    if (blockIdx < 0) return msg;
    const oldBlock = msg.blocks[blockIdx] as import("../types/chat").SubagentBlock;
    const blocks = [...msg.blocks];
    blocks[blockIdx] = updater(oldBlock);
    return { ...msg, blocks };
  });
}
