import { describe, it, expect, vi, beforeEach } from "vitest";
import { useVaultStore } from "./vault-store";

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

const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("vault-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVaultStore.setState({ keys: [] });
  });

  describe("initial state", () => {
    it("has empty keys", () => {
      expect(useVaultStore.getState().keys).toEqual([]);
    });
  });

  describe("fetchKeys", () => {
    it("populates keys from array response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ["API_KEY", "DB_PASSWORD", "SECRET_TOKEN"],
      });

      await useVaultStore.getState().fetchKeys();

      expect(mockFetch).toHaveBeenCalledWith("http://localhost:42888/api/vault/keys");
      expect(useVaultStore.getState().keys).toEqual(["API_KEY", "DB_PASSWORD", "SECRET_TOKEN"]);
    });

    it("populates keys from {keys: []} object response", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ keys: ["VAULT_SECRET", "GITHUB_TOKEN"] }),
      });

      await useVaultStore.getState().fetchKeys();

      expect(useVaultStore.getState().keys).toEqual(["VAULT_SECRET", "GITHUB_TOKEN"]);
    });

    it("keeps cached data on non-ok response", async () => {
      useVaultStore.setState({ keys: ["EXISTING_KEY"] });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      await useVaultStore.getState().fetchKeys();

      expect(useVaultStore.getState().keys).toEqual(["EXISTING_KEY"]);
    });

    it("keeps cached data on network error", async () => {
      useVaultStore.setState({ keys: ["CACHED_KEY"] });
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await useVaultStore.getState().fetchKeys();

      expect(useVaultStore.getState().keys).toEqual(["CACHED_KEY"]);
    });
  });
});
