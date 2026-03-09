import { create } from "zustand";
import { useSocketStore } from "../api/socket";

export type ConnectionStatus = "connected" | "reconnecting" | "disconnected";

export interface ConnectionStore {
  status: ConnectionStatus;
  reconnectAttempts: number;
}

export const useConnectionStore = create<ConnectionStore>()(() => ({
  status: "disconnected",
  reconnectAttempts: 0,
}));

// Sync socket store → connection store
useSocketStore.subscribe((state) => {
  let status: ConnectionStatus;
  if (state.status === "connected") {
    status = "connected";
  } else if (state.status === "disconnected") {
    status = "disconnected";
  } else {
    status = "reconnecting";
  }
  useConnectionStore.setState({
    status,
    reconnectAttempts: state.reconnectAttempts,
  });
});
