import { describe, it, expect, vi, beforeEach } from "vitest";
import { useWorktreeStore } from "./worktree-store";
import type { Worktree, WorktreeCreatedEvent, WorktreeStatusChangedEvent, WorktreeRemovedEvent, WorktreeErrorEvent, WorktreeCleanupEvent } from "../types/worktree";

// Mock the API client
vi.mock("../api/client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiDelete: vi.fn(),
  BASE_URL: "http://localhost:42888",
}));

import { apiGet, apiPost, apiDelete } from "../api/client";

const mockApiGet = vi.mocked(apiGet);
const mockApiPost = vi.mocked(apiPost);
const mockApiDelete = vi.mocked(apiDelete);

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: "wt-1",
    projectId: "proj-1",
    branch: "feature/test",
    path: "/tmp/worktrees/wt-1",
    status: "ready",
    cleanupPolicy: "always",
    createdBy: { type: "user" },
    createdAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("worktree-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store to initial state
    useWorktreeStore.setState({
      worktrees: [],
      totalDiskUsage: 0,
      worktreeCount: 0,
      loading: false,
      error: null,
    });
  });

  describe("fetchWorktrees", () => {
    it("sets worktrees from API response", async () => {
      const wts = [makeWorktree(), makeWorktree({ id: "wt-2", branch: "fix/bug" })];
      mockApiGet.mockResolvedValueOnce({ data: wts, error: null, status: 200 });

      await useWorktreeStore.getState().fetchWorktrees("proj-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/worktrees");
      expect(useWorktreeStore.getState().worktrees).toEqual(wts);
      expect(useWorktreeStore.getState().loading).toBe(false);
      expect(useWorktreeStore.getState().error).toBeNull();
    });

    it("sets error when API fails", async () => {
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Server error", status: 500 });

      await useWorktreeStore.getState().fetchWorktrees("proj-1");

      expect(useWorktreeStore.getState().worktrees).toEqual([]);
      expect(useWorktreeStore.getState().error).toBe("Server error");
      expect(useWorktreeStore.getState().loading).toBe(false);
    });
  });

  describe("fetchDiskUsage", () => {
    it("sets disk usage from API response", async () => {
      mockApiGet.mockResolvedValueOnce({
        data: { totalBytes: 1024 * 1024, count: 3 },
        error: null,
        status: 200,
      });

      await useWorktreeStore.getState().fetchDiskUsage("proj-1");

      expect(useWorktreeStore.getState().totalDiskUsage).toBe(1024 * 1024);
      expect(useWorktreeStore.getState().worktreeCount).toBe(3);
    });
  });

  describe("createWorktree", () => {
    it("adds the new worktree to the list", async () => {
      const newWt = makeWorktree({ id: "wt-new", branch: "feature/new" });
      mockApiPost.mockResolvedValueOnce({ data: newWt, error: null, status: 201 });

      const result = await useWorktreeStore.getState().createWorktree("proj-1", {
        branch: "feature/new",
        createBranch: true,
        cleanupPolicy: "always",
        createdBy: { type: "user" },
      });

      expect(result).toEqual(newWt);
      expect(useWorktreeStore.getState().worktrees).toHaveLength(1);
      expect(useWorktreeStore.getState().worktrees[0]!.id).toBe("wt-new");
    });

    it("throws on API error", async () => {
      mockApiPost.mockResolvedValueOnce({ data: null, error: "Branch already exists", status: 409 });

      await expect(
        useWorktreeStore.getState().createWorktree("proj-1", {
          branch: "feature/dup",
          cleanupPolicy: "always",
          createdBy: { type: "user" },
        }),
      ).rejects.toThrow("Branch already exists");
    });
  });

  describe("removeWorktree", () => {
    it("removes the worktree from the list", async () => {
      useWorktreeStore.setState({ worktrees: [makeWorktree({ id: "wt-1" }), makeWorktree({ id: "wt-2" })] });
      mockApiDelete.mockResolvedValueOnce({ data: { ok: true }, error: null, status: 200 });

      await useWorktreeStore.getState().removeWorktree("proj-1", "wt-1");

      expect(useWorktreeStore.getState().worktrees).toHaveLength(1);
      expect(useWorktreeStore.getState().worktrees[0]!.id).toBe("wt-2");
    });

    it("throws on API error", async () => {
      useWorktreeStore.setState({ worktrees: [makeWorktree()] });
      mockApiDelete.mockResolvedValueOnce({ data: null, error: "Not found", status: 404 });

      await expect(
        useWorktreeStore.getState().removeWorktree("proj-1", "wt-1"),
      ).rejects.toThrow("Not found");
    });
  });

  describe("triggerCleanup", () => {
    it("returns cleanup result and refreshes data", async () => {
      const result = { removed: 2, freedBytes: 2048 };
      mockApiPost.mockResolvedValueOnce({ data: result, error: null, status: 200 });
      // Mock for the subsequent fetchWorktrees and fetchDiskUsage calls
      mockApiGet.mockResolvedValue({ data: [], error: null, status: 200 });

      const cleanup = await useWorktreeStore.getState().triggerCleanup("proj-1");

      expect(cleanup).toEqual(result);
      expect(mockApiPost).toHaveBeenCalledWith("/api/proj-1/worktrees/cleanup", {});
    });
  });

  describe("socket event handlers", () => {
    it("onWorktreeCreated adds a worktree", () => {
      const wt = makeWorktree({ id: "wt-new" });
      const event: WorktreeCreatedEvent = { worktree: wt };

      useWorktreeStore.getState().onWorktreeCreated(event);

      expect(useWorktreeStore.getState().worktrees).toHaveLength(1);
      expect(useWorktreeStore.getState().worktrees[0]!.id).toBe("wt-new");
    });

    it("onWorktreeCreated deduplicates", () => {
      const wt = makeWorktree({ id: "wt-dup" });
      useWorktreeStore.setState({ worktrees: [wt] });

      useWorktreeStore.getState().onWorktreeCreated({ worktree: wt });

      expect(useWorktreeStore.getState().worktrees).toHaveLength(1);
    });

    it("onWorktreeStatusChanged updates the status", () => {
      useWorktreeStore.setState({ worktrees: [makeWorktree({ id: "wt-1", status: "creating" })] });
      const event: WorktreeStatusChangedEvent = {
        worktreeId: "wt-1",
        status: "ready",
        previousStatus: "creating",
      };

      useWorktreeStore.getState().onWorktreeStatusChanged(event);

      expect(useWorktreeStore.getState().worktrees[0]!.status).toBe("ready");
    });

    it("onWorktreeRemoved removes the worktree", () => {
      useWorktreeStore.setState({
        worktrees: [makeWorktree({ id: "wt-1" }), makeWorktree({ id: "wt-2" })],
      });
      const event: WorktreeRemovedEvent = { worktreeId: "wt-1" };

      useWorktreeStore.getState().onWorktreeRemoved(event);

      expect(useWorktreeStore.getState().worktrees).toHaveLength(1);
      expect(useWorktreeStore.getState().worktrees[0]!.id).toBe("wt-2");
    });

    it("onWorktreeError sets the worktree status to error", () => {
      useWorktreeStore.setState({ worktrees: [makeWorktree({ id: "wt-1", status: "creating" })] });
      const event: WorktreeErrorEvent = { worktreeId: "wt-1", error: "git error" };

      useWorktreeStore.getState().onWorktreeError(event);

      expect(useWorktreeStore.getState().worktrees[0]!.status).toBe("error");
    });

    it("onWorktreeCleanup decrements usage counters", () => {
      useWorktreeStore.setState({ totalDiskUsage: 5000, worktreeCount: 5 });
      const event: WorktreeCleanupEvent = { removed: 2, freedBytes: 2000 };

      useWorktreeStore.getState().onWorktreeCleanup(event);

      expect(useWorktreeStore.getState().totalDiskUsage).toBe(3000);
      expect(useWorktreeStore.getState().worktreeCount).toBe(3);
    });

    it("onWorktreeCleanup does not go below zero", () => {
      useWorktreeStore.setState({ totalDiskUsage: 500, worktreeCount: 1 });
      const event: WorktreeCleanupEvent = { removed: 3, freedBytes: 9999 };

      useWorktreeStore.getState().onWorktreeCleanup(event);

      expect(useWorktreeStore.getState().totalDiskUsage).toBe(0);
      expect(useWorktreeStore.getState().worktreeCount).toBe(0);
    });
  });
});
