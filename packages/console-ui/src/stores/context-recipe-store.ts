import { create } from "zustand";
import { apiGet, apiPut } from "../api/client";

export interface ProviderConfig {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  estimatedTokens: number;
  config: Record<string, unknown>;
}

interface RecipeResponse {
  providers: ProviderConfig[];
  tokenBudget: number;
}

export interface ContextRecipeStore {
  providers: ProviderConfig[];
  tokenBudget: number;
  preview: string | null;
  previewLoading: boolean;
  loading: boolean;
  error: string | null;
  fetchRecipe(projectId: string): Promise<void>;
  saveRecipe(
    projectId: string,
    providers: ProviderConfig[],
    tokenBudget: number
  ): Promise<void>;
  fetchPreview(projectId: string): Promise<void>;
  reset(): void;
}

export const useContextRecipeStore = create<ContextRecipeStore>((set) => ({
  providers: [],
  tokenBudget: 8000,
  preview: null,
  previewLoading: false,
  loading: false,
  error: null,

  fetchRecipe: async (projectId) => {
    set({ loading: true, error: null });
    const result = await apiGet<RecipeResponse>(`/api/${projectId}/context-recipes`);
    if (result.data !== null) {
      set({
        providers: result.data.providers,
        tokenBudget: result.data.tokenBudget,
        loading: false,
      });
    } else {
      set({ error: result.error, loading: false });
    }
  },

  saveRecipe: async (projectId, providers, tokenBudget) => {
    const result = await apiPut<RecipeResponse>(`/api/${projectId}/context-recipes`, {
      providers,
      tokenBudget,
    });
    if (result.data !== null) {
      set({ providers: result.data.providers, tokenBudget: result.data.tokenBudget });
    }
  },

  fetchPreview: async (projectId) => {
    set({ previewLoading: true });
    const result = await apiGet<{ content: string }>(
      `/api/${projectId}/context-recipes/preview`
    );
    if (result.data !== null) {
      set({ preview: result.data.content, previewLoading: false });
    } else {
      set({ previewLoading: false });
    }
  },

  reset: () =>
    set({
      providers: [],
      tokenBudget: 8000,
      preview: null,
      previewLoading: false,
      loading: false,
      error: null,
    }),
}));
