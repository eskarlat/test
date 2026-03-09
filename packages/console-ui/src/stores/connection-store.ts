import { create } from "zustand";

export interface ConnectionStore {
  status: "connected" | "reconnecting" | "disconnected";
  lastConnectedAt: string | null;
  reconnectAttempts: number;
  setStatus: (status: "connected" | "reconnecting" | "disconnected") => void;
  incrementReconnectAttempts: () => void;
  resetReconnectAttempts: () => void;
}

export const useConnectionStore = create<ConnectionStore>()((set) => ({
  status: "connected",
  lastConnectedAt: null,
  reconnectAttempts: 0,
  setStatus: (status) =>
    set((state) => ({
      status,
      lastConnectedAt:
        status === "connected" ? new Date().toISOString() : state.lastConnectedAt,
    })),
  incrementReconnectAttempts: () =>
    set((state) => ({ reconnectAttempts: state.reconnectAttempts + 1 })),
  resetReconnectAttempts: () => set({ reconnectAttempts: 0 }),
}));
