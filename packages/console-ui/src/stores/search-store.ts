import { create } from "zustand";
import { apiGet } from "../api/client";

export interface SearchResult {
  table: string;
  id: string;
  projectId: string;
  preview: string;
  createdAt?: string;
}

export interface SearchStore {
  query: string;
  results: SearchResult[];
  loading: boolean;
  error: string | null;
  activeFilters: string[];
  search(projectId: string, q: string): Promise<void>;
  setQuery(q: string): void;
  toggleFilter(table: string): void;
  reset(): void;
}

export const useSearchStore = create<SearchStore>((set, get) => ({
  query: "",
  results: [],
  loading: false,
  error: null,
  activeFilters: [],

  search: async (projectId, q) => {
    if (!q.trim()) {
      set({ results: [], loading: false });
      return;
    }
    set({ loading: true, error: null, query: q });
    const result = await apiGet<SearchResult[]>(
      `/api/${projectId}/search?q=${encodeURIComponent(q)}`
    );
    if (result.data !== null) {
      set({ results: result.data, loading: false });
    } else {
      set({ error: result.error, loading: false });
    }
  },

  setQuery: (q) => set({ query: q }),

  toggleFilter: (table) => {
    const { activeFilters } = get();
    if (activeFilters.includes(table)) {
      set({ activeFilters: activeFilters.filter((f) => f !== table) });
    } else {
      set({ activeFilters: [...activeFilters, table] });
    }
  },

  reset: () =>
    set({ query: "", results: [], loading: false, error: null, activeFilters: [] }),
}));
