import { create } from "zustand";
import { persist } from "zustand/middleware";
import { BASE_URL } from "../api/client";

export interface VaultStore {
  keys: string[];
  fetchKeys: () => Promise<void>;
}

export const useVaultStore = create<VaultStore>()(
  persist(
    (set) => ({
      keys: [],

      fetchKeys: async () => {
        try {
          const response = await fetch(
            `${BASE_URL}/api/vault/keys`
          );
          if (!response.ok) {
            return;
          }
          const data = (await response.json()) as string[] | { keys: string[] };
          const keys = Array.isArray(data) ? data : (data.keys ?? []);
          set({ keys });
        } catch {
          // Network error — keep cached data
        }
      },
    }),
    {
      name: "renre-kit-vault-store",
    }
  )
);
