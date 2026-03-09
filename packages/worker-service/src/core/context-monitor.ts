const CHARS_PER_TOKEN = 4;

const AGENT_CONTEXT_WINDOWS: Record<string, number> = {
  copilot: 128_000,
  "claude-code": 200_000,
  cursor: 128_000,
};

const DEFAULT_CONTEXT_WINDOW = 128_000;

export const SUGGEST_THRESHOLD = 0.65;

interface SessionUsage {
  tokens: number;
  suggested: boolean;
}

const sessionUsage = new Map<string, SessionUsage>();

function getContextWindow(agent: string): number {
  return AGENT_CONTEXT_WINDOWS[agent] ?? DEFAULT_CONTEXT_WINDOW;
}

export function trackToolUse(sessionId: string, argsJson: string, resultJson: string): void {
  const tokens = Math.ceil((argsJson.length + resultJson.length) / CHARS_PER_TOKEN);
  addTokens(sessionId, tokens);
}

export function trackPrompt(sessionId: string, prompt: string): void {
  const tokens = Math.ceil(prompt.length / CHARS_PER_TOKEN);
  addTokens(sessionId, tokens);
}

function addTokens(sessionId: string, tokens: number): void {
  const usage = sessionUsage.get(sessionId) ?? { tokens: 0, suggested: false };
  usage.tokens += tokens;
  sessionUsage.set(sessionId, usage);
}

export function getUsage(
  sessionId: string,
  agent: string,
): {
  tokens: number;
  contextWindow: number;
  percentage: number;
  shouldSuggestLearn: boolean;
} {
  const usage = sessionUsage.get(sessionId) ?? { tokens: 0, suggested: false };
  const contextWindow = getContextWindow(agent);
  const percentage = usage.tokens / contextWindow;
  const shouldSuggestLearn = !usage.suggested && percentage >= SUGGEST_THRESHOLD;
  return { tokens: usage.tokens, contextWindow, percentage, shouldSuggestLearn };
}

export function markSuggested(sessionId: string): void {
  const usage = sessionUsage.get(sessionId);
  if (usage) usage.suggested = true;
}

export function clearSession(sessionId: string): void {
  sessionUsage.delete(sessionId);
}
