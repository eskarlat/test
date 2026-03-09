import { create } from "zustand";
import { apiGet, apiPost, apiDelete } from "../api/client";
import type {
  Worktree,
  CreateWorktreeInput,
  CleanupResult,
  WorktreeCreatedEvent,
  WorktreeStatusChangedEvent,
  WorktreeRemovedEvent,
  WorktreeErrorEvent,
  WorktreeCleanupEvent,
} from "../types/worktree";

interface DiskUsageResponse {
  totalBytes: number;
  count: number;
}

export interface WorktreeStore {
  worktrees: Worktree[];
  totalDiskUsage: number;
  worktreeCount: number;
  loading: boolean;
  error: string | null;

  fetchWorktrees: (projectId: string) => Promise<void>;
  fetchDiskUsage: (projectId: string) => Promise<void>;
  createWorktree: (projectId: string, opts: CreateWorktreeInput) => Promise<Worktree>;
  removeWorktree: (projectId: string, worktreeId: string) => Promise<void>;
  triggerCleanup: (projectId: string) => Promise<CleanupResult>;

  // Socket.IO event handlers
  onWorktreeCreated: (data: WorktreeCreatedEvent) => void;
  onWorktreeStatusChanged: (data: WorktreeStatusChangedEvent) => void;
  onWorktreeRemoved: (data: WorktreeRemovedEvent) => void;
  onWorktreeError: (data: WorktreeErrorEvent) => void;
  onWorktreeCleanup: (data: WorktreeCleanupEvent) => void;
}

export const useWorktreeStore = create<WorktreeStore>()((set, get) => ({
  worktrees: [],
  totalDiskUsage: 0,
  worktreeCount: 0,
  loading: false,
  error: null,

  fetchWorktrees: async (projectId) => {
    set({ loading: true, error: null });
    const res = await apiGet<Worktree[]>(`/api/${projectId}/worktrees`);
    if (res.data) {
      set({ worktrees: res.data, loading: false });
    } else {
      set({ error: res.error ?? "Failed to fetch worktrees", loading: false });
    }
  },

  fetchDiskUsage: async (projectId) => {
    const res = await apiGet<DiskUsageResponse>(`/api/${projectId}/worktrees/disk-usage`);
    if (res.data) {
      set({ totalDiskUsage: res.data.totalBytes, worktreeCount: res.data.count });
    }
  },

  createWorktree: async (projectId, opts) => {
    const res = await apiPost<Worktree>(`/api/${projectId}/worktrees`, opts);
    if (res.data) {
      set((s) => ({ worktrees: [res.data!, ...s.worktrees] }));
      return res.data;
    }
    throw new Error(res.error ?? "Failed to create worktree");
  },

  removeWorktree: async (projectId, worktreeId) => {
    const res = await apiDelete(`/api/${projectId}/worktrees/${worktreeId}`);
    if (res.error) {
      throw new Error(res.error);
    }
    set((s) => ({
      worktrees: s.worktrees.filter((w) => w.id !== worktreeId),
    }));
  },

  triggerCleanup: async (projectId) => {
    const res = await apiPost<CleanupResult>(`/api/${projectId}/worktrees/cleanup`, {});
    if (res.data) {
      // Refresh worktrees list after cleanup
      get().fetchWorktrees(projectId);
      get().fetchDiskUsage(projectId);
      return res.data;
    }
    throw new Error(res.error ?? "Cleanup failed");
  },

  // Socket.IO event handlers

  onWorktreeCreated: (data) => {
    set((s) => {
      // Avoid duplicates
      if (s.worktrees.some((w) => w.id === data.worktree.id)) {
        return {};
      }
      return { worktrees: [data.worktree, ...s.worktrees] };
    });
  },

  onWorktreeStatusChanged: (data) => {
    set((s) => ({
      worktrees: s.worktrees.map((w) =>
        w.id === data.worktreeId ? { ...w, status: data.status } : w,
      ),
    }));
  },

  onWorktreeRemoved: (data) => {
    set((s) => ({
      worktrees: s.worktrees.filter((w) => w.id !== data.worktreeId),
    }));
  },

  onWorktreeError: (data) => {
    set((s) => ({
      worktrees: s.worktrees.map((w) =>
        w.id === data.worktreeId ? { ...w, status: "error" as const } : w,
      ),
    }));
  },

  onWorktreeCleanup: (data) => {
    set((s) => ({
      totalDiskUsage: Math.max(0, s.totalDiskUsage - data.freedBytes),
      worktreeCount: Math.max(0, s.worktreeCount - data.removed),
    }));
  },
}));
