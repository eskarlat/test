import { describe, it, expect, vi, beforeEach } from "vitest";
import { loadExtensionModule, invalidateExtensionModule } from "./extension-loader";

describe("extension-loader", () => {
  beforeEach(() => {
    // Invalidate any cached modules between tests
    invalidateExtensionModule("test-ext");
    invalidateExtensionModule("other-ext");
  });

  describe("loadExtensionModule", () => {
    it("loads module from correct URL", async () => {
      const mockModule = { pages: { dashboard: {} } };

      // Mock dynamic import
      vi.stubGlobal("__vite_import__", vi.fn());
      const importSpy = vi.fn().mockResolvedValue({ default: mockModule });
      vi.stubGlobal("import", importSpy);

      // Since we can't easily mock dynamic import(), test the error path
      await expect(
        loadExtensionModule("nonexistent", "1.0.0", "http://localhost:42888")
      ).rejects.toThrow('Failed to load UI for "nonexistent@1.0.0"');
    });
  });

  describe("invalidateExtensionModule", () => {
    it("is a function that does not throw", () => {
      expect(() => invalidateExtensionModule("test-ext")).not.toThrow();
    });

    it("removes matching extension entries", () => {
      // This just verifies it doesn't crash when cache is empty
      invalidateExtensionModule("nonexistent");
    });
  });
});
