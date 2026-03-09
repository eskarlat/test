import { create } from "zustand";

export type ToastType = "success" | "error" | "warning" | "info";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

export interface UpdateInfo {
  name: string;
  current: string;
  latest: string;
}

export interface EventEntry {
  timestamp: string;
  event: string;
  payload: unknown;
}

export interface NotificationStore {
  toasts: Toast[];
  availableUpdates: UpdateInfo[];
  recentEvents: EventEntry[]; // last 50 SSE events for System Home recent activity
  addToast: (message: string, type?: ToastType) => void;
  removeToast: (id: string) => void;
  setAvailableUpdates: (updates: UpdateInfo[]) => void;
  addEvent: (event: EventEntry) => void;
}

function generateId(): string {
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return `${Date.now()}-${arr[0]!.toString(36)}`;
}

export const useNotificationStore = create<NotificationStore>()((set) => ({
  toasts: [],
  availableUpdates: [],
  recentEvents: [],

  addToast: (message, type = "info") =>
    set((state) => {
      const toast: Toast = { id: generateId(), message, type };
      // Keep max 5 toasts
      const toasts = [...state.toasts, toast].slice(-5);
      return { toasts };
    }),

  removeToast: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((t) => t.id !== id),
    })),

  setAvailableUpdates: (updates) => set({ availableUpdates: updates }),

  addEvent: (event) =>
    set((state) => {
      // Keep last 50 events
      const recentEvents = [event, ...state.recentEvents].slice(0, 50);
      return { recentEvents };
    }),
}));
