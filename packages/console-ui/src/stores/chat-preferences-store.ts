import { create } from "zustand";
import { persist } from "zustand/middleware";

export type ToolDisplayMode = "compact" | "standard" | "verbose";

export interface ChatPreferencesState {
  toolDisplayMode: ToolDisplayMode;
  setToolDisplayMode: (mode: ToolDisplayMode) => void;
}

export const useChatPreferencesStore = create<ChatPreferencesState>()(
  persist(
    (set) => ({
      toolDisplayMode: "standard",
      setToolDisplayMode: (mode) => set({ toolDisplayMode: mode }),
    }),
    {
      name: "renre-chat-global-preferences",
      partialize: (state) => ({ toolDisplayMode: state.toolDisplayMode }),
    },
  ),
);
