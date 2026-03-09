import { create } from "zustand";
import { apiGet, apiPost, apiPut, apiDelete } from "../api/client";

export interface Observation {
  id: string;
  projectId: string;
  content: string;
  category: string;
  confidence: number;
  source: string;
  active: boolean;
  injectionCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ObservationFilter {
  category: string | undefined;
  confidence: string | undefined;
  source: string | undefined;
  showArchived: boolean | undefined;
}

export interface ObservationStore {
  observations: Observation[];
  loading: boolean;
  error: string | null;
  filter: ObservationFilter;
  fetchObservations(projectId: string): Promise<void>;
  createObservation(
    projectId: string,
    data: { content: string; category: string }
  ): Promise<void>;
  updateObservation(
    projectId: string,
    id: string,
    data: Partial<Observation>
  ): Promise<void>;
  deleteObservation(projectId: string, id: string): Promise<void>;
  setFilter(filter: Partial<ObservationFilter>): void;
  reset(): void;
}

export const useObservationStore = create<ObservationStore>((set, get) => ({
  observations: [],
  loading: false,
  error: null,
  filter: { category: undefined, confidence: undefined, source: undefined, showArchived: undefined },

  fetchObservations: async (projectId) => {
    // Only show loading spinner on initial load, not on SSE-triggered refetches
    const isInitialLoad = get().observations.length === 0;
    if (isInitialLoad) {
      set({ loading: true, error: null });
    }
    const result = await apiGet<Observation[]>(`/api/${projectId}/observations?active=false`);
    if (result.data !== null) {
      set({ observations: result.data, loading: false, error: null });
    } else {
      set({ error: result.error, loading: false });
    }
  },

  createObservation: async (projectId, data) => {
    const result = await apiPost<Observation>(`/api/${projectId}/observations`, data);
    if (result.data !== null) {
      set((state) => ({ observations: [result.data!, ...state.observations] }));
    }
  },

  updateObservation: async (projectId, id, data) => {
    const result = await apiPut<Observation>(`/api/${projectId}/observations/${id}`, data);
    if (result.data !== null) {
      set((state) => ({
        observations: state.observations.map((o) => (o.id === id ? result.data! : o)),
      }));
    }
  },

  deleteObservation: async (projectId, id) => {
    const result = await apiDelete<Observation>(`/api/${projectId}/observations/${id}`);
    if (result.data !== null) {
      // Hard delete — remove from list
      set((state) => ({
        observations: state.observations.filter((o) => o.id !== id),
      }));
    }
  },

  setFilter: (filter) =>
    set((state) => ({ filter: { ...state.filter, ...filter } })),

  reset: () =>
    set({
      observations: [],
      loading: false,
      error: null,
      filter: { category: undefined, confidence: undefined, source: undefined, showArchived: undefined },
    }),
}));
