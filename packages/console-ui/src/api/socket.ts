import { create } from "zustand";
import { io, type Socket } from "socket.io-client";

export type SocketStatus = "connecting" | "connected" | "reconnecting" | "disconnected";

export interface SocketState {
  socket: Socket | null;
  status: SocketStatus;
  reconnectAttempts: number;

  connect: (baseUrl: string) => void;
  disconnect: () => void;
}

export const useSocketStore = create<SocketState>()((set, get) => ({
  socket: null,
  status: "disconnected",
  reconnectAttempts: 0,

  connect: (baseUrl: string) => {
    const existing = get().socket;
    if (existing) {
      existing.disconnect();
    }

    set({ status: "connecting" });

    const socket = io(baseUrl, {
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });

    socket.on("connect", () => {
      set({ status: "connected", reconnectAttempts: 0 });
    });

    socket.on("disconnect", () => {
      set({ status: "reconnecting" });
    });

    socket.io.on("reconnect_attempt", () => {
      set((state) => ({ reconnectAttempts: state.reconnectAttempts + 1 }));
    });

    socket.io.on("reconnect_failed", () => {
      set({ status: "disconnected" });
    });

    socket.io.on("reconnect", () => {
      set({ status: "connected", reconnectAttempts: 0 });
    });

    set({ socket });
  },

  disconnect: () => {
    const { socket } = get();
    if (socket) {
      socket.disconnect();
    }
    set({ socket: null, status: "disconnected", reconnectAttempts: 0 });
  },
}));
