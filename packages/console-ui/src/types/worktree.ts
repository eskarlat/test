// Worktree type definitions — Phase 7

export type WorktreeStatus = "creating" | "ready" | "in_use" | "completed" | "error" | "removing";
export type CleanupPolicy = "always" | "on_success" | "never" | "ttl";

export interface WorktreeCreator {
  type: "automation" | "chat" | "user";
  automationId?: string;
  automationRunId?: string;
  chatSessionId?: string;
}

export interface Worktree {
  id: string;
  projectId: string;
  branch: string;
  baseBranch?: string;
  path: string;
  status: WorktreeStatus;
  cleanupPolicy: CleanupPolicy;
  createdBy: WorktreeCreator;
  metadata?: Record<string, string>;
  diskUsageBytes?: number;
  ttlMs?: number;
  expiresAt?: string;
  createdAt: string;
  lastAccessedAt?: string;
}

export interface CreateWorktreeInput {
  branch?: string;
  createBranch?: boolean;
  baseBranch?: string;
  cleanupPolicy: CleanupPolicy;
  createdBy: WorktreeCreator;
  ttlMs?: number;
  metadata?: Record<string, string>;
}

export interface CleanupResult {
  removed: number;
  freedBytes: number;
}

// Socket.IO event payloads

export interface WorktreeCreatedEvent {
  worktree: Worktree;
}

export interface WorktreeStatusChangedEvent {
  worktreeId: string;
  status: WorktreeStatus;
  previousStatus: WorktreeStatus;
}

export interface WorktreeRemovedEvent {
  worktreeId: string;
}

export interface WorktreeErrorEvent {
  worktreeId: string;
  error: string;
}

export interface WorktreeCleanupEvent {
  removed: number;
  freedBytes: number;
}
