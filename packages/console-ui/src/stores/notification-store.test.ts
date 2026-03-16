import { describe, it, expect, vi, beforeEach } from "vitest";
import { useNotificationStore } from "./notification-store";
import type { UpdateInfo, EventEntry } from "./notification-store";

describe("notification-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useNotificationStore.setState({
      toasts: [],
      availableUpdates: [],
      recentEvents: [],
    });
  });

  describe("addToast", () => {
    it("adds a toast with generated id", () => {
      useNotificationStore.getState().addToast("Something happened");

      const toasts = useNotificationStore.getState().toasts;
      expect(toasts).toHaveLength(1);
      expect(toasts[0]!.message).toBe("Something happened");
      expect(toasts[0]!.type).toBe("info");
      expect(toasts[0]!.id).toBeTruthy();
    });

    it("uses specified type", () => {
      useNotificationStore.getState().addToast("Error!", "error");

      expect(useNotificationStore.getState().toasts[0]!.type).toBe("error");
    });

    it("caps at 5 toasts", () => {
      for (let i = 0; i < 7; i++) {
        useNotificationStore.getState().addToast(`Toast ${i}`);
      }

      const toasts = useNotificationStore.getState().toasts;
      expect(toasts).toHaveLength(5);
      // Should keep the last 5 (indices 2-6)
      expect(toasts[0]!.message).toBe("Toast 2");
      expect(toasts[4]!.message).toBe("Toast 6");
    });
  });

  describe("removeToast", () => {
    it("removes specific toast by id", () => {
      useNotificationStore.getState().addToast("First");
      useNotificationStore.getState().addToast("Second");

      const toasts = useNotificationStore.getState().toasts;
      const firstId = toasts[0]!.id;

      useNotificationStore.getState().removeToast(firstId);

      const remaining = useNotificationStore.getState().toasts;
      expect(remaining).toHaveLength(1);
      expect(remaining[0]!.message).toBe("Second");
    });

    it("does nothing for non-existent id", () => {
      useNotificationStore.getState().addToast("First");

      useNotificationStore.getState().removeToast("non-existent");

      expect(useNotificationStore.getState().toasts).toHaveLength(1);
    });
  });

  describe("setAvailableUpdates", () => {
    it("sets available updates", () => {
      const updates: UpdateInfo[] = [
        { name: "ext-a", current: "1.0.0", latest: "2.0.0" },
        { name: "ext-b", current: "0.5.0", latest: "1.0.0" },
      ];

      useNotificationStore.getState().setAvailableUpdates(updates);

      expect(useNotificationStore.getState().availableUpdates).toEqual(updates);
    });
  });

  describe("addEvent", () => {
    it("prepends event to recentEvents", () => {
      const event1: EventEntry = { timestamp: "2026-01-01T00:00:00Z", event: "session:start", payload: {} };
      const event2: EventEntry = { timestamp: "2026-01-01T00:01:00Z", event: "tool:use", payload: { tool: "bash" } };

      useNotificationStore.getState().addEvent(event1);
      useNotificationStore.getState().addEvent(event2);

      const events = useNotificationStore.getState().recentEvents;
      expect(events).toHaveLength(2);
      expect(events[0]!.event).toBe("tool:use");
      expect(events[1]!.event).toBe("session:start");
    });

    it("caps at 50 events", () => {
      for (let i = 0; i < 55; i++) {
        useNotificationStore.getState().addEvent({
          timestamp: `2026-01-01T00:${String(i).padStart(2, "0")}:00Z`,
          event: `event-${i}`,
          payload: {},
        });
      }

      const events = useNotificationStore.getState().recentEvents;
      expect(events).toHaveLength(50);
      // Most recent should be first
      expect(events[0]!.event).toBe("event-54");
    });
  });
});
