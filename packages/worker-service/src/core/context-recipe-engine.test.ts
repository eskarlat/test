import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock logger
vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock db-manager
const mockGet = vi.fn();
const mockRun = vi.fn();
const mockPrepare = vi.fn().mockReturnValue({ get: mockGet, run: mockRun });

vi.mock("./db-manager.js", () => ({
  dbManager: {
    getConnection: () => ({
      prepare: mockPrepare,
    }),
  },
}));

// Mock all context providers
vi.mock("./context-providers/session-history-provider.js", () => ({
  sessionHistoryProvider: {
    id: "session-history",
    name: "Session History",
    description: "Session history",
    getContext: vi.fn().mockResolvedValue({ content: "session data", estimatedTokens: 10, itemCount: 1, truncated: false }),
  },
}));

vi.mock("./context-providers/observations-provider.js", () => ({
  observationsProvider: {
    id: "observations",
    name: "Observations",
    description: "Observations",
    getContext: vi.fn().mockResolvedValue({ content: "observations data", estimatedTokens: 10, itemCount: 1, truncated: false }),
  },
}));

vi.mock("./context-providers/git-history-provider.js", () => ({
  gitHistoryProvider: {
    id: "git-history",
    name: "Git History",
    description: "Git history",
    getContext: vi.fn().mockResolvedValue({ content: "git data", estimatedTokens: 10, itemCount: 1, truncated: false }),
  },
}));

vi.mock("./context-providers/error-patterns-provider.js", () => ({
  errorPatternsProvider: {
    id: "error-patterns",
    name: "Error Patterns",
    description: "Error patterns",
    getContext: vi.fn().mockResolvedValue({ content: "error data", estimatedTokens: 10, itemCount: 1, truncated: false }),
  },
}));

vi.mock("./context-providers/tool-rules-provider.js", () => ({
  toolRulesProvider: {
    id: "tool-rules",
    name: "Tool Rules",
    description: "Tool rules",
    getContext: vi.fn().mockResolvedValue({ content: "tool rules data", estimatedTokens: 10, itemCount: 1, truncated: false }),
  },
}));

vi.mock("./context-providers/extension-provider.js", () => ({
  extensionContextProvider: {
    id: "extension-context",
    name: "Extension Context",
    description: "Extension context",
    getContext: vi.fn().mockResolvedValue({ content: "extension data", estimatedTokens: 10, itemCount: 1, truncated: false }),
  },
}));

import {
  registerProvider,
  getRegisteredProviders,
  getRecipe,
  saveRecipe,
  resetRecipe,
  assemble,
  preview,
  registerBuiltInProviders,
  type ContextProvider,
  type Recipe,
} from "./context-recipe-engine.js";

describe("context-recipe-engine", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockReturnValue(undefined);
    mockRun.mockReturnValue(undefined);
  });

  describe("registerProvider / getRegisteredProviders", () => {
    it("registers and retrieves a provider", () => {
      const provider: ContextProvider = {
        id: "test-provider",
        name: "Test Provider",
        description: "A test provider",
        getContext: vi.fn().mockResolvedValue({ content: "test", estimatedTokens: 5, itemCount: 1, truncated: false }),
      };
      registerProvider(provider);
      const providers = getRegisteredProviders();
      const found = providers.find((p) => p.id === "test-provider");
      expect(found).toBeDefined();
      expect(found!.name).toBe("Test Provider");
    });
  });

  describe("registerBuiltInProviders", () => {
    it("registers all built-in providers", () => {
      registerBuiltInProviders();
      const providers = getRegisteredProviders();
      const ids = providers.map((p) => p.id);
      expect(ids).toContain("session-history");
      expect(ids).toContain("observations");
      expect(ids).toContain("git-history");
      expect(ids).toContain("error-patterns");
      expect(ids).toContain("tool-rules");
      expect(ids).toContain("extension-context");
    });
  });

  describe("getRecipe", () => {
    it("returns default recipe when no saved recipe", () => {
      mockGet.mockReturnValue(undefined);
      const recipe = getRecipe("proj-1");
      expect(recipe.providers.length).toBeGreaterThan(0);
      expect(recipe.providers[0]!.providerId).toBe("session-history");
    });

    it("returns saved recipe from database", () => {
      const savedRecipe: Recipe = {
        providers: [
          { providerId: "observations", enabled: true, config: {} },
        ],
      };
      mockGet.mockReturnValue({ recipe: JSON.stringify(savedRecipe) });
      const recipe = getRecipe("proj-1");
      expect(recipe.providers).toHaveLength(1);
      expect(recipe.providers[0]!.providerId).toBe("observations");
    });

    it("returns default recipe on DB error", () => {
      mockPrepare.mockImplementationOnce(() => { throw new Error("db error"); });
      const recipe = getRecipe("proj-1");
      expect(recipe.providers.length).toBeGreaterThan(0);
    });
  });

  describe("saveRecipe", () => {
    it("saves recipe to database", () => {
      const recipe: Recipe = {
        providers: [{ providerId: "session-history", enabled: true, config: {} }],
      };
      saveRecipe("proj-1", recipe);
      expect(mockRun).toHaveBeenCalledWith(
        "proj-1",
        expect.stringContaining("session-history"),
        expect.any(String),
      );
    });
  });

  describe("resetRecipe", () => {
    it("deletes recipe from database", () => {
      resetRecipe("proj-1");
      expect(mockRun).toHaveBeenCalledWith("proj-1");
    });
  });

  describe("assemble", () => {
    beforeEach(() => {
      // Register the providers that the default recipe references
      registerBuiltInProviders();
    });

    it("assembles context from enabled providers", async () => {
      mockGet.mockReturnValue(undefined); // use default recipe
      const result = await assemble("proj-1", 4000);
      expect(result.content).toBeTruthy();
      expect(result.totalTokens).toBeGreaterThan(0);
      expect(result.providers.length).toBeGreaterThan(0);
    });

    it("skips disabled providers", async () => {
      const recipe: Recipe = {
        providers: [
          { providerId: "session-history", enabled: false, config: {} },
          { providerId: "observations", enabled: true, config: {} },
        ],
      };
      mockGet.mockReturnValue({ recipe: JSON.stringify(recipe) });
      const result = await assemble("proj-1", 4000);
      const providerIds = result.providers.map((p) => p.id);
      expect(providerIds).not.toContain("session-history");
    });

    it("respects token budget", async () => {
      const recipe: Recipe = {
        providers: [
          { providerId: "session-history", enabled: true, config: {} },
        ],
      };
      mockGet.mockReturnValue({ recipe: JSON.stringify(recipe) });
      const result = await assemble("proj-1", 1);
      // With budget of 1, content should be truncated
      expect(result.totalTokens).toBeLessThanOrEqual(2); // small tolerance
    });

    it("handles unknown provider gracefully", async () => {
      const recipe: Recipe = {
        providers: [
          { providerId: "non-existent-provider", enabled: true, config: {} },
        ],
      };
      mockGet.mockReturnValue({ recipe: JSON.stringify(recipe) });
      const result = await assemble("proj-1", 4000);
      expect(result.content).toBe("");
      expect(result.totalTokens).toBe(0);
    });

    it("handles provider error gracefully", async () => {
      const failingProvider: ContextProvider = {
        id: "failing-provider",
        name: "Failing",
        description: "Always fails",
        getContext: vi.fn().mockRejectedValue(new Error("provider error")),
      };
      registerProvider(failingProvider);

      const recipe: Recipe = {
        providers: [
          { providerId: "failing-provider", enabled: true, config: {} },
        ],
      };
      mockGet.mockReturnValue({ recipe: JSON.stringify(recipe) });
      const result = await assemble("proj-1", 4000);
      // Should not throw, returns empty content for failed provider
      expect(result.content).toBe("");
    });
  });

  describe("preview", () => {
    beforeEach(() => {
      registerBuiltInProviders();
    });

    it("returns assembled context plus recipe", async () => {
      mockGet.mockReturnValue(undefined);
      const result = await preview("proj-1", 4000);
      expect(result.content).toBeTruthy();
      expect(result.recipe).toBeDefined();
      expect(result.recipe.providers.length).toBeGreaterThan(0);
    });
  });
});
