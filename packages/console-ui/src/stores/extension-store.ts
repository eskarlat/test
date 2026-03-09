import { create } from "zustand";
import { persist } from "zustand/middleware";
import { BASE_URL } from "../api/client";

export interface MountedExtension {
  name: string;
  displayName?: string;
  version: string;
  status: string;
  error?: string;
  mcpTransport?: string;
  mcpStatus?: string;
  routeCount?: number;
  ui?: {
    pages: Array<{ id: string; label: string; path: string }>;
    bundle: string;
  };
  manifest?: {
    description?: string;
    settings?: {
      schema: Array<{
        key: string;
        type: string;
        required?: boolean;
        label?: string;
        description?: string;
        options?: string[] | { label: string; value: string }[];
        placeholder?: string;
        default?: string | number | boolean;
      }>;
    };
    permissions?: {
      database?: boolean;
      network?: string[];
      mcp?: boolean;
      hooks?: string[];
      vault?: string[];
      filesystem?: boolean;
    };
  };
  // Installed extension metadata (may come from extensions.json)
  source?: string;
  marketplace?: string;
  installedAt?: string;
  description?: string;
}

export interface ExtensionStore {
  extensions: Record<string, MountedExtension[]>; // keyed by projectId
  fetchExtensions: (projectId: string) => Promise<void>;
  getExtensionsForProject: (projectId: string) => MountedExtension[];
}

export const useExtensionStore = create<ExtensionStore>()(
  persist(
    (set, get) => ({
      extensions: {},

      fetchExtensions: async (projectId: string) => {
        try {
          const response = await fetch(
            `${BASE_URL}/api/${projectId}/extensions`
          );
          if (!response.ok) {
            return;
          }
          const extensions: MountedExtension[] = (await response.json()) as MountedExtension[];
          set((state) => ({
            extensions: { ...state.extensions, [projectId]: extensions },
          }));
        } catch {
          // Network error — keep cached data
        }
      },

      getExtensionsForProject: (projectId: string) => {
        return get().extensions[projectId] ?? [];
      },
    }),
    {
      name: "renre-kit-extension-store",
    }
  )
);
