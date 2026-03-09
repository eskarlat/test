import { execFileSync, spawnSync } from "node:child_process";
import type { ContextProvider, ContextResult } from "../context-recipe-engine.js";

function formatLogLines(lines: string[]): string {
  return lines.map((l) => `- ${l}`).join("\n");
}

function resolveGitPath(): string {
  const knownPaths =
    process.platform === "win32"
      ? ["C:\\Program Files\\Git\\bin\\git.exe", "C:\\Program Files (x86)\\Git\\bin\\git.exe"]
      : ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"];

  for (const candidate of knownPaths) {
    const result = spawnSync(candidate, ["--version"], { timeout: 1000 });
    if (result.status === 0) return candidate;
  }
  // Fallback: resolve from PATH at import time
  const whichResult = spawnSync(
    process.platform === "win32" ? "where" : "/usr/bin/which",
    ["git"],
    { timeout: 1000, encoding: "utf8" },
  );
  if (whichResult.status === 0 && typeof whichResult.stdout === "string") {
    const resolved = whichResult.stdout.trim().split("\n")[0];
    if (resolved) return resolved;
  }
  return "/usr/bin/git";
}

const GIT_PATH = resolveGitPath();

export const gitHistoryProvider: ContextProvider = {
  id: "git-history",
  name: "Git History",
  description: "Recent git commits from the working directory. Gives agents awareness of recent code changes.",
  async getContext(_projectId: string, _config: Record<string, unknown>, tokenBudget: number): Promise<ContextResult> {
    const maxChars = tokenBudget * 4;
    try {
      const output = execFileSync(GIT_PATH, ["log", "--oneline", "-10"], {
        cwd: process.cwd(),
        encoding: "utf8",
        timeout: 3000,
      }).trim();

      if (!output) {
        return { content: "", estimatedTokens: 0, itemCount: 0, truncated: false };
      }

      const lines = output.split("\n");
      const formatted = formatLogLines(lines);
      let content = `## Recent Git History\n${formatted}\n`;
      const truncated = content.length > maxChars;
      if (truncated) content = content.slice(0, maxChars);

      return {
        content,
        estimatedTokens: Math.ceil(content.length / 4),
        itemCount: lines.length,
        truncated,
      };
    } catch {
      // Not a git repo or git unavailable
      return { content: "", estimatedTokens: 0, itemCount: 0, truncated: false };
    }
  },
};
