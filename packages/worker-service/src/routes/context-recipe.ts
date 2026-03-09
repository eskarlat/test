import { Router, type Request, type Response } from "express";
import {
  getRecipe,
  saveRecipe,
  resetRecipe,
  preview,
  getRegisteredProviders,
  assemble,
  type RecipeEntry,
} from "../core/context-recipe-engine.js";

const router = Router();

const DEFAULT_TOKEN_BUDGET = 4000;

interface ProviderConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  estimatedTokens: number;
  config: Record<string, unknown>;
}

function toUiProviders(
  entries: RecipeEntry[],
  tokenEstimates?: Map<string, number>,
): ProviderConfig[] {
  const registered = getRegisteredProviders();
  const infoMap = new Map(registered.map((p) => [p.id, p]));
  return entries.map((e) => ({
    id: e.providerId,
    name: infoMap.get(e.providerId)?.name ?? e.providerId,
    description: infoMap.get(e.providerId)?.description ?? "",
    enabled: e.enabled,
    estimatedTokens: tokenEstimates?.get(e.providerId) ?? 0,
    config: e.config,
  }));
}

function toRecipeEntries(providers: ProviderConfig[]): RecipeEntry[] {
  return providers.map((p) => ({
    providerId: p.id,
    enabled: p.enabled,
    config: p.config,
  }));
}

function buildUiResponseSync(projectId: string) {
  const recipe = getRecipe(projectId);
  return {
    providers: toUiProviders(recipe.providers),
    tokenBudget: recipe.tokenBudget ?? DEFAULT_TOKEN_BUDGET,
  };
}

async function buildUiResponseWithEstimates(projectId: string) {
  const recipe = getRecipe(projectId);
  const tokenBudget = recipe.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

  // Run assembly to get real token estimates per provider
  const assembled = await assemble(projectId, tokenBudget);
  const tokenEstimates = new Map<string, number>();
  for (const p of assembled.providers) {
    tokenEstimates.set(p.id, p.tokens);
  }

  return {
    providers: toUiProviders(recipe.providers, tokenEstimates),
    tokenBudget,
  };
}

// GET /api/:projectId/context-recipes
router.get("/api/:projectId/context-recipes", (req: Request, res: Response) => {
  const { projectId } = req.params;
  buildUiResponseWithEstimates(projectId!)
    .then((result) => res.json(result))
    .catch(() => res.json(buildUiResponseSync(projectId!)));
});

// PUT /api/:projectId/context-recipes
router.put("/api/:projectId/context-recipes", (req: Request, res: Response) => {
  const { projectId } = req.params;
  const body = req.body as Record<string, unknown>;

  if (!body["providers"] || !Array.isArray(body["providers"])) {
    res.status(400).json({ error: "providers array is required" });
    return;
  }

  const tokenBudget =
    typeof body["tokenBudget"] === "number" ? body["tokenBudget"] : DEFAULT_TOKEN_BUDGET;

  saveRecipe(projectId!, {
    providers: toRecipeEntries(body["providers"] as ProviderConfig[]),
    tokenBudget,
  });

  buildUiResponseWithEstimates(projectId!)
    .then((result) => res.json(result))
    .catch(() => res.json(buildUiResponseSync(projectId!)));
});

// GET /api/:projectId/context-recipes/preview
router.get("/api/:projectId/context-recipes/preview", (req: Request, res: Response) => {
  const { projectId } = req.params;
  const recipe = getRecipe(projectId!);
  const tokenBudget = recipe.tokenBudget ?? DEFAULT_TOKEN_BUDGET;

  preview(projectId!, tokenBudget)
    .then((result) => res.json({ content: result.content }))
    .catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: msg });
    });
});

// POST /api/:projectId/context-recipes/reset
router.post("/api/:projectId/context-recipes/reset", (req: Request, res: Response) => {
  const { projectId } = req.params;
  resetRecipe(projectId!);
  buildUiResponseWithEstimates(projectId!)
    .then((result) => res.json(result))
    .catch(() => res.json(buildUiResponseSync(projectId!)));
});

// GET /api/:projectId/context-recipes/providers
router.get("/api/:projectId/context-recipes/providers", (_req: Request, res: Response) => {
  const providers = getRegisteredProviders().map((p) => ({ id: p.id, name: p.name }));
  res.json(providers);
});

export default router;
