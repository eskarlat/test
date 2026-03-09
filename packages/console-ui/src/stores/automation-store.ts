import { create } from "zustand";
import { apiGet, apiPost, apiPut, apiDelete } from "../api/client";
import { useSocketStore } from "../api/socket";
import type {
  Automation,
  AutomationListItem,
  AutomationRun,
  AutomationRunDetail,
  CreateAutomationInput,
  UpdateAutomationInput,
  ExtensionCronJob,
  ModelInfo,
  ToolCallLog,
  RunStartedEvent,
  RunCompletedEvent,
  StepStartedEvent,
  StepCompletedEvent,
  StepFailedEvent,
  ToolCalledEvent,
  MessageDeltaEvent,
  AutomationLogEvent,
} from "../types/automation";

export interface AutomationStore {
  automations: AutomationListItem[];
  extensionJobs: ExtensionCronJob[];
  models: ModelInfo[];
  loading: boolean;
  error: string | null;

  // Automation CRUD
  fetchAutomations: (projectId: string) => Promise<void>;
  createAutomation: (projectId: string, input: CreateAutomationInput) => Promise<Automation>;
  updateAutomation: (projectId: string, id: string, updates: UpdateAutomationInput) => Promise<Automation>;
  deleteAutomation: (projectId: string, id: string) => Promise<void>;
  toggleAutomation: (projectId: string, id: string, enabled: boolean) => Promise<void>;
  triggerRun: (projectId: string, id: string) => Promise<string>;

  // Extension jobs
  fetchExtensionJobs: (projectId: string) => Promise<void>;
  toggleExtensionJob: (projectId: string, jobId: string, enabled: boolean) => Promise<void>;

  // Models
  fetchModels: (projectId: string) => Promise<void>;

  // Socket.IO event handlers
  onRunStarted: (data: RunStartedEvent) => void;
  onRunCompleted: (data: RunCompletedEvent) => void;

  // Phase 9: Run history
  runs: AutomationRun[];
  activeRun: AutomationRunDetail | null;
  runLoading: boolean;
  fetchRuns: (projectId: string, automationId: string, opts?: { limit?: number; status?: string }) => Promise<void>;
  fetchRunDetails: (projectId: string, automationId: string, runId: string) => Promise<void>;
  cancelRun: (projectId: string, automationId: string, runId: string) => Promise<void>;

  // Phase 9: Socket.IO run-level events
  joinRunRoom: (runId: string) => void;
  leaveRunRoom: (runId: string) => void;
  onStepStarted: (data: StepStartedEvent) => void;
  onStepCompleted: (data: StepCompletedEvent) => void;
  onStepFailed: (data: StepFailedEvent) => void;
  onToolCalled: (data: ToolCalledEvent) => void;
  onMessageDelta: (data: MessageDeltaEvent) => void;
  onAutomationLog: (data: AutomationLogEvent) => void;
}

export const useAutomationStore = create<AutomationStore>()((set, _get) => ({
  automations: [],
  extensionJobs: [],
  models: [],
  loading: false,
  error: null,

  // Phase 9 state
  runs: [],
  activeRun: null,
  runLoading: false,

  // ---------- Automation CRUD ----------

  fetchAutomations: async (projectId) => {
    set({ loading: true, error: null });
    const res = await apiGet<AutomationListItem[]>(`/api/${projectId}/automations`);
    if (res.data) {
      set({ automations: res.data, loading: false });
    } else {
      set({ error: res.error ?? "Failed to fetch automations", loading: false });
    }
  },

  createAutomation: async (projectId, input) => {
    const res = await apiPost<Automation>(`/api/${projectId}/automations`, input);
    if (res.data) {
      // Add to list as a list item
      const item: AutomationListItem = {
        id: res.data.id,
        projectId: res.data.projectId,
        name: res.data.name,
        enabled: res.data.enabled,
        scheduleType: res.data.schedule.type,
        chainStepCount: res.data.chain.length,
        createdAt: res.data.createdAt,
        updatedAt: res.data.updatedAt,
      };
      if (res.data.description) {
        item.description = res.data.description;
      }
      if (res.data.schedule.cron) {
        item.scheduleCron = res.data.schedule.cron;
      }
      set((s) => ({ automations: [item, ...s.automations] }));
      return res.data;
    }
    throw new Error(res.error ?? "Failed to create automation");
  },

  updateAutomation: async (projectId, id, updates) => {
    const res = await apiPut<Automation>(`/api/${projectId}/automations/${id}`, updates);
    if (res.data) {
      const updated = res.data;
      set((s) => ({
        automations: s.automations.map((a) => {
          if (a.id !== id) return a;
          const item: AutomationListItem = {
            ...a,
            name: updated.name,
            enabled: updated.enabled,
            scheduleType: updated.schedule.type,
            chainStepCount: updated.chain.length,
            updatedAt: updated.updatedAt,
          };
          if (updated.description) {
            item.description = updated.description;
          }
          if (updated.schedule.cron) {
            item.scheduleCron = updated.schedule.cron;
          }
          return item;
        }),
      }));
      return res.data;
    }
    throw new Error(res.error ?? "Failed to update automation");
  },

  deleteAutomation: async (projectId, id) => {
    const res = await apiDelete(`/api/${projectId}/automations/${id}`);
    if (res.error && res.status !== 204) {
      throw new Error(res.error);
    }
    set((s) => ({
      automations: s.automations.filter((a) => a.id !== id),
    }));
  },

  toggleAutomation: async (projectId, id, enabled) => {
    const res = await apiPost<{ ok: true }>(`/api/${projectId}/automations/${id}/toggle`, { enabled });
    if (res.error) {
      throw new Error(res.error ?? "Failed to toggle automation");
    }
    set((s) => ({
      automations: s.automations.map((a) =>
        a.id === id ? { ...a, enabled } : a,
      ),
    }));
  },

  triggerRun: async (projectId, id) => {
    const res = await apiPost<{ runId: string }>(`/api/${projectId}/automations/${id}/trigger`, {});
    if (res.data) {
      return res.data.runId;
    }
    throw new Error(res.error ?? "Failed to trigger run");
  },

  // ---------- Extension Jobs ----------

  fetchExtensionJobs: async (projectId) => {
    const res = await apiGet<ExtensionCronJob[]>(`/api/${projectId}/ext-cron`);
    if (res.data) {
      set({ extensionJobs: res.data });
    }
  },

  toggleExtensionJob: async (projectId, jobId, enabled) => {
    const res = await apiPost<{ id: string; enabled: boolean }>(
      `/api/${projectId}/ext-cron/${jobId}/toggle`,
      { enabled },
    );
    if (res.error) {
      throw new Error(res.error ?? "Failed to toggle extension job");
    }
    set((s) => ({
      extensionJobs: s.extensionJobs.map((j) =>
        j.id === jobId ? { ...j, enabled } : j,
      ),
    }));
  },

  // ---------- Models ----------

  fetchModels: async (projectId) => {
    const res = await apiGet<ModelInfo[]>(`/api/${projectId}/automations/models`);
    if (res.data) {
      set({ models: res.data });
    }
  },

  // ---------- Socket.IO event handlers ----------

  onRunStarted: (data) => {
    set((s) => ({
      automations: s.automations.map((a) => {
        if (a.id !== data.automationId) return a;
        return {
          ...a,
          lastRun: {
            status: "running",
            startedAt: new Date().toISOString(),
            durationMs: null,
          },
        };
      }),
    }));
  },

  onRunCompleted: (data) => {
    set((s) => ({
      automations: s.automations.map((a) => {
        if (a.id !== data.automationId) return a;
        return {
          ...a,
          lastRun: {
            status: data.status,
            startedAt: a.lastRun?.startedAt ?? new Date().toISOString(),
            durationMs: data.durationMs,
          },
        };
      }),
    }));
  },

  // ---------- Phase 9: Run history ----------

  fetchRuns: async (projectId, automationId, opts) => {
    set({ runLoading: true });
    const params = new URLSearchParams();
    if (opts?.limit != null) {
      params.set("limit", String(opts.limit));
    }
    if (opts?.status) {
      params.set("status", opts.status);
    }
    const query = params.toString();
    const suffix = query ? "?" + query : "";
    const path = `/api/${projectId}/automations/${automationId}/runs` + suffix;
    const res = await apiGet<AutomationRun[]>(path);
    if (res.data) {
      set({ runs: res.data, runLoading: false });
    } else {
      set({ runLoading: false });
    }
  },

  fetchRunDetails: async (projectId, automationId, runId) => {
    set({ runLoading: true });
    const res = await apiGet<AutomationRunDetail>(
      `/api/${projectId}/automations/${automationId}/runs/${runId}`,
    );
    if (res.data) {
      set({ activeRun: res.data, runLoading: false });
    } else {
      set({ runLoading: false });
    }
  },

  cancelRun: async (projectId, automationId, runId) => {
    const res = await apiPost<{ ok: true }>(
      `/api/${projectId}/automations/${automationId}/runs/${runId}/cancel`,
      {},
    );
    if (res.error) {
      throw new Error(res.error ?? "Failed to cancel run");
    }
    // Update local state
    set((s) => ({
      runs: s.runs.map((r) =>
        r.id === runId ? { ...r, status: "cancelled" as const } : r,
      ),
      activeRun: s.activeRun?.id === runId
        ? { ...s.activeRun, status: "cancelled" as const }
        : s.activeRun,
    }));
  },

  // ---------- Phase 9: Socket.IO run-level events ----------

  joinRunRoom: (runId) => {
    const socket = useSocketStore.getState().socket;
    socket?.emit("automation:join", { runId });
  },

  leaveRunRoom: (runId) => {
    const socket = useSocketStore.getState().socket;
    socket?.emit("automation:leave", { runId });
  },

  onStepStarted: (data) => {
    set((s) => {
      if (!s.activeRun || s.activeRun.id !== data.runId) return s;
      const steps = s.activeRun.steps.map((step) => {
        if (step.stepId !== data.stepId) return step;
        return { ...step, status: "running" as const, startedAt: new Date().toISOString() };
      });
      return { activeRun: { ...s.activeRun, steps } };
    });
  },

  onStepCompleted: (data) => {
    set((s) => {
      if (!s.activeRun || s.activeRun.id !== data.runId) return s;
      const steps = s.activeRun.steps.map((step) => {
        if (step.stepId !== data.stepId) return step;
        return {
          ...step,
          status: data.status,
          durationMs: data.durationMs,
          completedAt: new Date().toISOString(),
        };
      });
      const completedCount = steps.filter((st) => st.status === "completed" || st.status === "skipped").length;
      return {
        activeRun: { ...s.activeRun, steps, stepsCompleted: completedCount },
      };
    });
  },

  onStepFailed: (data) => {
    set((s) => {
      if (!s.activeRun || s.activeRun.id !== data.runId) return s;
      const steps = s.activeRun.steps.map((step) => {
        if (step.stepId !== data.stepId) return step;
        return {
          ...step,
          status: "failed" as const,
          error: data.error,
          completedAt: new Date().toISOString(),
        };
      });
      return { activeRun: { ...s.activeRun, steps } };
    });
  },

  onToolCalled: (data) => {
    set((s) => {
      if (!s.activeRun || s.activeRun.id !== data.runId) return s;
      const steps = s.activeRun.steps.map((step) => {
        if (step.stepId !== data.stepId) return step;
        const newTool: ToolCallLog = {
          toolName: data.toolName,
          source: data.source,
          arguments: {},
          success: data.success,
          startedAt: new Date().toISOString(),
          durationMs: data.durationMs,
        };
        if (data.autoApproved != null) {
          newTool.autoApproved = data.autoApproved;
        }
        return { ...step, toolCalls: [...step.toolCalls, newTool] };
      });
      return { activeRun: { ...s.activeRun, steps } };
    });
  },

  onMessageDelta: (data) => {
    set((s) => {
      if (!s.activeRun || s.activeRun.id !== data.runId) return s;
      const steps = s.activeRun.steps.map((step) => {
        if (step.stepId !== data.stepId) return step;
        return { ...step, response: (step.response ?? "") + data.deltaContent };
      });
      return { activeRun: { ...s.activeRun, steps } };
    });
  },

  onAutomationLog: (_data) => {
    // Log events are handled directly by the LiveRunView component's local state.
    // No store update needed for log messages.
  },
}));
