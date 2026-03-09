import { dbManager } from "./db-manager.js";
import { logger } from "./logger.js";
import { sessionHistoryProvider } from "./context-providers/session-history-provider.js";
import { observationsProvider } from "./context-providers/observations-provider.js";
import { gitHistoryProvider } from "./context-providers/git-history-provider.js";
import { errorPatternsProvider } from "./context-providers/error-patterns-provider.js";
import { toolRulesProvider } from "./context-providers/tool-rules-provider.js";
import { extensionContextProvider } from "./context-providers/extension-provider.js";

export interface ContextResult {
  content: string;
  estimatedTokens: number;
  itemCount: number;
  truncated: boolean;
}

export interface ContextProvider {
  id: string;
  name: string;
  description: string;
  getContext(projectId: string, config: Record<string, unknown>, tokenBudget: number): Promise<ContextResult>;
}

export interface RecipeEntry {
  providerId: string;
  enabled: boolean;
  config: Record<string, unknown>;
}

export interface Recipe {
  providers: RecipeEntry[];
  tokenBudget?: number;
}

export interface AssembledContext {
  content: string;
  totalTokens: number;
  providers: Array<{ id: string; tokens: number; truncated: boolean }>;
}

interface RecipeRow {
  project_id: string;
  recipe: string;
  updated_at: string;
}

const DEFAULT_TOKEN_BUDGET = 4000;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function getDb() {
  return dbManager.getConnection();
}

const providerRegistry = new Map<string, ContextProvider>();

export function registerProvider(provider: ContextProvider): void {
  providerRegistry.set(provider.id, provider);
}

export function getRegisteredProviders(): ContextProvider[] {
  return Array.from(providerRegistry.values());
}

const DEFAULT_RECIPE: Recipe = {
  providers: [
    { providerId: "session-history", enabled: true, config: {} },
    { providerId: "observations", enabled: true, config: {} },
    { providerId: "git-history", enabled: true, config: {} },
    { providerId: "error-patterns", enabled: true, config: {} },
    { providerId: "tool-rules", enabled: true, config: {} },
  ],
};

export function getRecipe(projectId: string): Recipe {
  try {
    const row = getDb()
      .prepare("SELECT recipe FROM _context_recipes WHERE project_id = ?")
      .get(projectId) as RecipeRow | undefined;
    if (row) {
      return JSON.parse(row.recipe) as Recipe;
    }
  } catch {
    // fall through to defaults
  }
  return DEFAULT_RECIPE;
}

export function saveRecipe(projectId: string, recipe: Recipe): void {
  const now = new Date().toISOString();
  try {
    getDb()
      .prepare(
        `INSERT OR REPLACE INTO _context_recipes (project_id, recipe, updated_at)
         VALUES (?, ?, ?)`,
      )
      .run(projectId, JSON.stringify(recipe), now);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("context-recipe", `Failed to save recipe: ${msg}`);
  }
}

export function resetRecipe(projectId: string): void {
  try {
    getDb()
      .prepare("DELETE FROM _context_recipes WHERE project_id = ?")
      .run(projectId);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("context-recipe", `Failed to reset recipe: ${msg}`);
  }
}

async function runProvider(
  entry: RecipeEntry,
  projectId: string,
  remainingBudget: number,
): Promise<{ id: string; content: string; tokens: number; truncated: boolean }> {
  const provider = providerRegistry.get(entry.providerId);
  if (!provider) {
    return { id: entry.providerId, content: "", tokens: 0, truncated: false };
  }

  try {
    const result = await provider.getContext(projectId, entry.config, remainingBudget);
    let content = result.content;
    let truncated = result.truncated;

    const tokens = estimateTokens(content);
    if (tokens > remainingBudget) {
      const charLimit = remainingBudget * 4;
      content = content.slice(0, charLimit);
      truncated = true;
    }

    return { id: entry.providerId, content, tokens: estimateTokens(content), truncated };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("context-recipe", `Provider ${entry.providerId} failed: ${msg}`);
    return { id: entry.providerId, content: "", tokens: 0, truncated: false };
  }
}

export async function assemble(
  projectId: string,
  tokenBudget = DEFAULT_TOKEN_BUDGET,
): Promise<AssembledContext> {
  const recipe = getRecipe(projectId);
  const contentParts: string[] = [];
  const providerResults: Array<{ id: string; tokens: number; truncated: boolean }> = [];
  let remainingBudget = tokenBudget;

  for (const entry of recipe.providers) {
    if (!entry.enabled) continue;
    if (remainingBudget <= 0) break;

    const result = await runProvider(entry, projectId, remainingBudget);
    if (result.content) {
      contentParts.push(result.content);
      remainingBudget -= result.tokens;
      providerResults.push({ id: result.id, tokens: result.tokens, truncated: result.truncated });
    }
  }

  return {
    content: contentParts.join("\n\n"),
    totalTokens: tokenBudget - remainingBudget,
    providers: providerResults,
  };
}

export async function preview(
  projectId: string,
  tokenBudget = DEFAULT_TOKEN_BUDGET,
): Promise<AssembledContext & { recipe: Recipe }> {
  const result = await assemble(projectId, tokenBudget);
  const recipe = getRecipe(projectId);
  return { ...result, recipe };
}

export function registerBuiltInProviders(): void {
  registerProvider(sessionHistoryProvider);
  registerProvider(observationsProvider);
  registerProvider(gitHistoryProvider);
  registerProvider(errorPatternsProvider);
  registerProvider(toolRulesProvider);
  registerProvider(extensionContextProvider);
  logger.info("context-recipe", "Built-in context providers registered");
}
