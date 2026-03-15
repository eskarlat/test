import { describe, it, expect, vi, beforeEach } from "vitest";
import { useExtensionStore } from "./extension-store";
import type { MountedExtension } from "./extension-store";

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

function makeExtension(overrides: Partial<MountedExtension> = {}): MountedExtension {
  return {
    name: "test-ext",
    version: "1.0.0",
    status: "mounted",
    ...overrides,
  };
}

describe("extension-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useExtensionStore.setState({ extensions: {} });
  });

  describe("initial state", () => {
    it("has empty extensions", () => {
      expect(useExtensionStore.getState().extensions).toEqual({});
    });
  });

  describe("fetchExtensions", () => {
    it("populates extensions for projectId", async () => {
      const exts = [
        makeExtension({ name: "ext-a" }),
        makeExtension({ name: "ext-b", version: "2.0.0" }),
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => exts,
      });

      await useExtensionStore.getState().fetchExtensions("proj-1");

      expect(mockFetch).toHaveBeenCalledWith("http://localhost:42888/api/proj-1/extensions");
      expect(useExtensionStore.getState().extensions["proj-1"]).toEqual(exts);
    });

    it("preserves extensions for other projects", async () => {
      useExtensionStore.setState({
        extensions: { "proj-other": [makeExtension({ name: "other-ext" })] },
      });
      const exts = [makeExtension({ name: "new-ext" })];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => exts,
      });

      await useExtensionStore.getState().fetchExtensions("proj-1");

      expect(useExtensionStore.getState().extensions["proj-other"]).toHaveLength(1);
      expect(useExtensionStore.getState().extensions["proj-1"]).toEqual(exts);
    });

    it("keeps cached data on non-ok response", async () => {
      useExtensionStore.setState({
        extensions: { "proj-1": [makeExtension()] },
      });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      await useExtensionStore.getState().fetchExtensions("proj-1");

      expect(useExtensionStore.getState().extensions["proj-1"]).toHaveLength(1);
    });

    it("keeps cached data on network error", async () => {
      useExtensionStore.setState({
        extensions: { "proj-1": [makeExtension()] },
      });
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await useExtensionStore.getState().fetchExtensions("proj-1");

      expect(useExtensionStore.getState().extensions["proj-1"]).toHaveLength(1);
    });
  });

  describe("getExtensionsForProject", () => {
    it("returns extensions for an existing project", () => {
      const exts = [makeExtension({ name: "ext-a" })];
      useExtensionStore.setState({ extensions: { "proj-1": exts } });

      const result = useExtensionStore.getState().getExtensionsForProject("proj-1");

      expect(result).toEqual(exts);
    });

    it("returns empty array for unknown project", () => {
      const result = useExtensionStore.getState().getExtensionsForProject("unknown-proj");

      expect(result).toEqual([]);
    });
  });
});
