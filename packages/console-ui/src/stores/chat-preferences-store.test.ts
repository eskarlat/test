import { describe, it, expect, beforeEach } from "vitest";
import { useChatPreferencesStore } from "./chat-preferences-store";

describe("chat-preferences-store", () => {
  beforeEach(() => {
    useChatPreferencesStore.setState({ toolDisplayMode: "standard" });
  });

  it("defaults to standard mode", () => {
    expect(useChatPreferencesStore.getState().toolDisplayMode).toBe("standard");
  });

  it("allows switching to compact mode", () => {
    useChatPreferencesStore.getState().setToolDisplayMode("compact");
    expect(useChatPreferencesStore.getState().toolDisplayMode).toBe("compact");
  });

  it("allows switching to verbose mode", () => {
    useChatPreferencesStore.getState().setToolDisplayMode("verbose");
    expect(useChatPreferencesStore.getState().toolDisplayMode).toBe("verbose");
  });

  it("cycles through all modes", () => {
    const store = useChatPreferencesStore.getState();
    store.setToolDisplayMode("compact");
    expect(useChatPreferencesStore.getState().toolDisplayMode).toBe("compact");
    store.setToolDisplayMode("verbose");
    expect(useChatPreferencesStore.getState().toolDisplayMode).toBe("verbose");
    store.setToolDisplayMode("standard");
    expect(useChatPreferencesStore.getState().toolDisplayMode).toBe("standard");
  });
});
