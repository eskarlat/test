import { getServerPort } from "../server-port.js";
import type { ContextProvider, ContextResult } from "../context-recipe-engine.js";
import { listProviders } from "../context-provider-manager.js";

async function fetchExtensionContext(
  port: number,
  projectId: string,
  extensionName: string,
  subBudget: number,
): Promise<string | null> {
  const url = `http://127.0.0.1:${port}/api/${projectId}/${extensionName}/__context`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tokenBudget: subBudget }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return null;
    const data = await res.json() as { content?: string };
    if (!data.content) return null;
    const chars = subBudget * 4;
    return data.content.length > chars ? data.content.slice(0, chars) : data.content;
  } catch {
    return null;
  }
}

export const extensionContextProvider: ContextProvider = {
  id: "extension-providers",
  name: "Extension Context",
  description: "Context contributed by installed extensions. Each extension can provide project-specific data.",
  async getContext(projectId: string, _config: Record<string, unknown>, tokenBudget: number): Promise<ContextResult> {
    const registered = listProviders().filter((p) => p.type === "extension" && p.extensionName);
    if (registered.length === 0) {
      return { content: "", estimatedTokens: 0, itemCount: 0, truncated: false };
    }

    const subBudget = Math.floor(tokenBudget / registered.length);
    const port = getServerPort();
    const contentParts: string[] = [];

    for (const provider of registered) {
      const result = await fetchExtensionContext(port, projectId, provider.extensionName!, subBudget);
      if (result) contentParts.push(result);
    }

    if (contentParts.length === 0) {
      return { content: "", estimatedTokens: 0, itemCount: 0, truncated: false };
    }

    const content = contentParts.join("\n\n");
    const estimatedTokens = Math.ceil(content.length / 4);
    return {
      content,
      estimatedTokens,
      itemCount: contentParts.length,
      truncated: estimatedTokens > tokenBudget,
    };
  },
};
