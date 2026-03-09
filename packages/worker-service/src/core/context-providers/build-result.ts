import type { ContextResult } from "../context-recipe-engine.js";

export function buildResult(content: string, maxChars: number, itemCount: number): ContextResult {
  const truncated = content.length > maxChars;
  const out = truncated ? content.slice(0, maxChars) : content;
  return {
    content: out,
    estimatedTokens: Math.ceil(out.length / 4),
    itemCount,
    truncated,
  };
}
