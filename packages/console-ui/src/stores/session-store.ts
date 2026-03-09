import { create } from "zustand";
import { apiGet } from "../api/client";

export interface Session {
  id: string;
  projectId: string;
  agent: string;
  status: "active" | "ended";
  startedAt: string;
  endedAt?: string;
  summary?: string;
  promptCount: number;
  toolCount: number;
  errorCount: number;
}

export interface TimelineEvent {
  id: string;
  sessionId: string;
  eventType: "prompt" | "tool" | "error" | "subagent" | "hook" | "checkpoint";
  timestamp: string;
  data: Record<string, unknown>;
  parentEventId?: string;
}

export interface SessionFilter {
  agent: string | undefined;
  status: string | undefined;
  dateFrom: string | undefined;
  dateTo: string | undefined;
}

export interface SessionStore {
  sessions: Session[];
  activeSession: Session | null;
  timeline: TimelineEvent[];
  loading: boolean;
  error: string | null;
  filter: SessionFilter;
  fetchSessions(projectId: string): Promise<void>;
  fetchTimeline(projectId: string, sessionId: string): Promise<void>;
  setFilter(filter: Partial<SessionFilter>): void;
  reset(): void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  activeSession: null,
  timeline: [],
  loading: false,
  error: null,
  filter: { agent: undefined, status: undefined, dateFrom: undefined, dateTo: undefined },

  fetchSessions: async (projectId) => {
    set({ loading: true, error: null });
    const result = await apiGet<Session[]>(`/api/${projectId}/sessions`);
    if (result.data !== null) {
      set({ sessions: result.data, loading: false });
    } else {
      set({ error: result.error, loading: false });
    }
  },

  fetchTimeline: async (projectId, sessionId) => {
    set({ loading: true, error: null });
    const sessionResult = await apiGet<Session>(`/api/${projectId}/sessions/${sessionId}`);
    const timelineResult = await apiGet<{ items: Array<{ type: string; id: string; createdAt: string; data: Record<string, unknown>; parentEventId?: string }> }>(
      `/api/${projectId}/sessions/${sessionId}/timeline`
    );
    if (timelineResult.data !== null) {
      const items = timelineResult.data.items ?? [];
      const timeline: TimelineEvent[] = items.map((item) => {
        const ev: TimelineEvent = {
          id: item.id,
          sessionId,
          eventType: item.type as TimelineEvent["eventType"],
          timestamp: item.createdAt,
          data: item.data,
        };
        if (item.parentEventId) ev.parentEventId = item.parentEventId;
        return ev;
      });
      set({
        timeline,
        activeSession: sessionResult.data,
        loading: false,
      });
    } else {
      set({ error: timelineResult.error, loading: false });
    }
  },

  setFilter: (filter) =>
    set((state) => ({ filter: { ...state.filter, ...filter } })),

  reset: () =>
    set({
      sessions: [],
      activeSession: null,
      timeline: [],
      loading: false,
      error: null,
      filter: { agent: undefined, status: undefined, dateFrom: undefined, dateTo: undefined },
    }),
}));
