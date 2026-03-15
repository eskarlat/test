import { describe, it, expect, beforeEach } from "vitest";
import { eventBus, type WorkerEvent, type WorkerEventType } from "./event-bus.js";

describe("EventBus", () => {
  beforeEach(() => {
    // Clear the internal buffer by removing all listeners and draining history
    // Since the class isn't exported, we work with the singleton.
    // We can't fully reset the buffer, but we can remove listeners.
    eventBus.removeAllListeners();
  });

  it("publish emits events that listeners receive", () => {
    const received: WorkerEvent[] = [];
    eventBus.on("event", (evt: WorkerEvent) => {
      received.push(evt);
    });

    eventBus.publish("project:registered", { projectId: "p1" });

    expect(received).toHaveLength(1);
    expect(received[0].type).toBe("project:registered");
    expect(received[0].payload).toEqual({ projectId: "p1" });
    expect(received[0].timestamp).toBeTruthy();
  });

  it("publish creates a valid ISO timestamp", () => {
    const received: WorkerEvent[] = [];
    eventBus.on("event", (evt: WorkerEvent) => received.push(evt));

    eventBus.publish("extension:mounted", { name: "test-ext" });

    const ts = received[0].timestamp;
    expect(new Date(ts).toISOString()).toBe(ts);
  });

  it("getHistory returns published events", () => {
    const beforeCount = eventBus.getHistory().length;

    eventBus.publish("extension:installed", { name: "ext-1" });
    eventBus.publish("extension:mounted", { name: "ext-1" });

    const history = eventBus.getHistory();
    expect(history.length).toBe(beforeCount + 2);

    const last2 = history.slice(-2);
    expect(last2[0].type).toBe("extension:installed");
    expect(last2[1].type).toBe("extension:mounted");
  });

  it("getHistory returns a copy, not a reference to the internal buffer", () => {
    eventBus.publish("vault:updated", { key: "secret" });

    const history1 = eventBus.getHistory();
    const history2 = eventBus.getHistory();

    expect(history1).not.toBe(history2);
    expect(history1).toEqual(history2);
  });

  it("ring buffer caps at 100 events", () => {
    // Publish enough events to exceed the buffer
    const startSize = eventBus.getHistory().length;
    const needed = 100 - startSize + 10; // Overflow by 10

    for (let i = 0; i < needed; i++) {
      eventBus.publish("tool:used", { index: i });
    }

    const history = eventBus.getHistory();
    expect(history.length).toBe(100);

    // The oldest events should have been dropped, the newest should be present
    const lastEvent = history[history.length - 1];
    expect(lastEvent.payload.index).toBe(needed - 1);
  });

  it("non-event emissions do not add to the buffer", () => {
    const before = eventBus.getHistory().length;
    eventBus.emit("some-other-event", { random: true });
    const after = eventBus.getHistory().length;
    expect(after).toBe(before);
  });

  it("multiple listeners all receive the same event", () => {
    const received1: WorkerEvent[] = [];
    const received2: WorkerEvent[] = [];
    eventBus.on("event", (evt: WorkerEvent) => received1.push(evt));
    eventBus.on("event", (evt: WorkerEvent) => received2.push(evt));

    eventBus.publish("session:started", { sessionId: "s1" });

    expect(received1).toHaveLength(1);
    expect(received2).toHaveLength(1);
    expect(received1[0]).toBe(received2[0]);
  });
});
