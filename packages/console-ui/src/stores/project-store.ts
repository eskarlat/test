import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ActiveProject {
  id: string;
  name: string;
  path: string;
  extensionCount: number;
  mountedExtensions: Array<{ name: string; version: string; status: string }>;
}

export interface ProjectStore {
  activeProjectId: string | null;
  projects: ActiveProject[];
  workerPort: number;
  setActiveProject: (id: string | null) => void;
  fetchProjects: () => Promise<void>;
}

export const useProjectStore = create<ProjectStore>()(
  persist(
    (set, get) => ({
      activeProjectId: null,
      projects: [],
      workerPort: 42888,

      setActiveProject: (id) => set({ activeProjectId: id }),

      fetchProjects: async () => {
        const { workerPort } = get();
        try {
          const response = await fetch(`http://localhost:${workerPort}/api/projects`);
          if (!response.ok) {
            return;
          }
          const projects: ActiveProject[] = (await response.json()) as ActiveProject[];
          set((state) => {
            // Validate stored activeProjectId still exists
            const validId =
              state.activeProjectId !== null &&
              projects.some((p) => p.id === state.activeProjectId)
                ? state.activeProjectId
                : (projects[0]?.id ?? null);
            return { projects, activeProjectId: validId };
          });
        } catch {
          // Network error — keep cached data
        }
      },
    }),
    {
      name: "renre-kit-project-store",
      partialize: (state) => ({
        activeProjectId: state.activeProjectId,
        projects: state.projects,
        workerPort: state.workerPort,
      }),
    }
  )
);
