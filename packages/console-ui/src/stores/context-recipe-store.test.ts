import { describe, it, expect, vi, beforeEach } from "vitest";
import { useContextRecipeStore } from "./context-recipe-store";
import type { ProviderConfig } from "./context-recipe-store";

// Mock the API client
vi.mock("../api/client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  BASE_URL: "http://localhost:42888",
}));

// Mock the socket store
vi.mock("../api/socket", () => ({
  useSocketStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({ socket: { emit: vi.fn() } }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

import { apiGet, apiPut } from "../api/client";

const mockApiGet = vi.mocked(apiGet);
const mockApiPut = vi.mocked(apiPut);

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "provider-1",
    name: "Session Memory",
    description: "Includes session memory context",
    enabled: true,
    estimatedTokens: 2000,
    config: {},
    ...overrides,
  };
}

describe("context-recipe-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useContextRecipeStore.setState({
      providers: [],
      tokenBudget: 8000,
      preview: null,
      previewLoading: false,
      loading: false,
      error: null,
    });
  });

  describe("initial state", () => {
    it("has empty providers and default token budget", () => {
      const state = useContextRecipeStore.getState();
      expect(state.providers).toEqual([]);
      expect(state.tokenBudget).toBe(8000);
      expect(state.preview).toBeNull();
      expect(state.previewLoading).toBe(false);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });
  });

  describe("fetchRecipe", () => {
    it("sets providers and tokenBudget on success", async () => {
      const providers = [makeProvider(), makeProvider({ id: "provider-2", name: "Observations" })];
      mockApiGet.mockResolvedValueOnce({
        data: { providers, tokenBudget: 12000 },
        error: null,
        status: 200,
      });

      await useContextRecipeStore.getState().fetchRecipe("proj-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/context-recipes");
      expect(useContextRecipeStore.getState().providers).toEqual(providers);
      expect(useContextRecipeStore.getState().tokenBudget).toBe(12000);
      expect(useContextRecipeStore.getState().loading).toBe(false);
      expect(useContextRecipeStore.getState().error).toBeNull();
    });

    it("sets error when API fails", async () => {
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Server error", status: 500 });

      await useContextRecipeStore.getState().fetchRecipe("proj-1");

      expect(useContextRecipeStore.getState().providers).toEqual([]);
      expect(useContextRecipeStore.getState().error).toBe("Server error");
      expect(useContextRecipeStore.getState().loading).toBe(false);
    });
  });

  describe("saveRecipe", () => {
    it("updates providers and tokenBudget on success", async () => {
      const providers = [makeProvider({ enabled: false })];
      mockApiPut.mockResolvedValueOnce({
        data: { providers, tokenBudget: 6000 },
        error: null,
        status: 200,
      });

      await useContextRecipeStore.getState().saveRecipe("proj-1", providers, 6000);

      expect(mockApiPut).toHaveBeenCalledWith("/api/proj-1/context-recipes", {
        providers,
        tokenBudget: 6000,
      });
      expect(useContextRecipeStore.getState().providers).toEqual(providers);
      expect(useContextRecipeStore.getState().tokenBudget).toBe(6000);
    });

    it("does not update state on API failure", async () => {
      useContextRecipeStore.setState({ providers: [makeProvider()], tokenBudget: 8000 });
      mockApiPut.mockResolvedValueOnce({ data: null, error: "Bad request", status: 400 });

      await useContextRecipeStore.getState().saveRecipe("proj-1", [], 4000);

      expect(useContextRecipeStore.getState().providers).toHaveLength(1);
      expect(useContextRecipeStore.getState().tokenBudget).toBe(8000);
    });
  });

  describe("fetchPreview", () => {
    it("sets preview content on success", async () => {
      mockApiGet.mockResolvedValueOnce({
        data: { content: "# Context Preview\nSession memory..." },
        error: null,
        status: 200,
      });

      await useContextRecipeStore.getState().fetchPreview("proj-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/context-recipes/preview");
      expect(useContextRecipeStore.getState().preview).toBe("# Context Preview\nSession memory...");
      expect(useContextRecipeStore.getState().previewLoading).toBe(false);
    });

    it("clears previewLoading on API failure", async () => {
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Not found", status: 404 });

      await useContextRecipeStore.getState().fetchPreview("proj-1");

      expect(useContextRecipeStore.getState().preview).toBeNull();
      expect(useContextRecipeStore.getState().previewLoading).toBe(false);
    });
  });

  describe("reset", () => {
    it("clears all state to defaults", () => {
      useContextRecipeStore.setState({
        providers: [makeProvider()],
        tokenBudget: 12000,
        preview: "some preview",
        previewLoading: true,
        loading: true,
        error: "some error",
      });

      useContextRecipeStore.getState().reset();

      const state = useContextRecipeStore.getState();
      expect(state.providers).toEqual([]);
      expect(state.tokenBudget).toBe(8000);
      expect(state.preview).toBeNull();
      expect(state.previewLoading).toBe(false);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
    });
  });
});
