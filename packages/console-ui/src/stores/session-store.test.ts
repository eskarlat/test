import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the API client
vi.mock("../api/client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  BASE_URL: "http://localhost:42888",
}));

// Mock the socket store
vi.mock("../api/socket", () => ({
  useSocketStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({ socket: { emit: vi.fn() } }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

import { apiGet } from "../api/client";
import { useSessionStore } from "./session-store";
import type { Session, TimelineEvent, SessionFilter } from "./session-store";

const mockApiGet = vi.mocked(apiGet);

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    projectId: "proj-1",
    agent: "claude",
    status: "active",
    startedAt: "2026-01-01T00:00:00Z",
    promptCount: 5,
    toolCount: 3,
    errorCount: 0,
    ...overrides,
  };
}

const defaultFilter: SessionFilter = {
  agent: undefined,
  status: undefined,
  dateFrom: undefined,
  dateTo: undefined,
};

describe("session-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      sessions: [],
      activeSession: null,
      timeline: [],
      loading: false,
      error: null,
      filter: { ...defaultFilter },
    });
  });

  describe("fetchSessions", () => {
    it("populates sessions and sets loading false on success", async () => {
      const sessions = [makeSession(), makeSession({ id: "sess-2" })];
      mockApiGet.mockResolvedValueOnce({ data: sessions, error: null, status: 200 });

      await useSessionStore.getState().fetchSessions("proj-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/sessions");
      expect(useSessionStore.getState().sessions).toEqual(sessions);
      expect(useSessionStore.getState().loading).toBe(false);
      expect(useSessionStore.getState().error).toBeNull();
    });

    it("sets error message on failure", async () => {
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Server error", status: 500 });

      await useSessionStore.getState().fetchSessions("proj-1");

      expect(useSessionStore.getState().sessions).toEqual([]);
      expect(useSessionStore.getState().error).toBe("Server error");
      expect(useSessionStore.getState().loading).toBe(false);
    });
  });

  describe("fetchTimeline", () => {
    it("populates timeline and activeSession on success", async () => {
      const session = makeSession({ id: "sess-1" });
      const timelineItems = [
        { type: "prompt", id: "ev-1", createdAt: "2026-01-01T00:01:00Z", data: { text: "hello" } },
        { type: "tool", id: "ev-2", createdAt: "2026-01-01T00:02:00Z", data: { name: "bash" }, parentEventId: "ev-1" },
      ];
      mockApiGet.mockResolvedValueOnce({ data: session, error: null, status: 200 });
      mockApiGet.mockResolvedValueOnce({ data: { items: timelineItems }, error: null, status: 200 });

      await useSessionStore.getState().fetchTimeline("proj-1", "sess-1");

      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/sessions/sess-1");
      expect(mockApiGet).toHaveBeenCalledWith("/api/proj-1/sessions/sess-1/timeline");
      expect(useSessionStore.getState().activeSession).toEqual(session);
      expect(useSessionStore.getState().timeline).toHaveLength(2);
      expect(useSessionStore.getState().timeline[0]!.eventType).toBe("prompt");
      expect(useSessionStore.getState().timeline[1]!.parentEventId).toBe("ev-1");
      expect(useSessionStore.getState().loading).toBe(false);
    });

    it("sets error when timeline fetch fails", async () => {
      mockApiGet.mockResolvedValueOnce({ data: null, error: null, status: 200 });
      mockApiGet.mockResolvedValueOnce({ data: null, error: "Timeline not found", status: 404 });

      await useSessionStore.getState().fetchTimeline("proj-1", "sess-1");

      expect(useSessionStore.getState().error).toBe("Timeline not found");
      expect(useSessionStore.getState().loading).toBe(false);
    });
  });

  describe("setFilter", () => {
    it("merges partial filter", () => {
      useSessionStore.getState().setFilter({ agent: "claude" });

      expect(useSessionStore.getState().filter.agent).toBe("claude");
      expect(useSessionStore.getState().filter.status).toBeUndefined();
    });

    it("merges multiple filter fields", () => {
      useSessionStore.getState().setFilter({ agent: "claude", status: "active" });

      expect(useSessionStore.getState().filter.agent).toBe("claude");
      expect(useSessionStore.getState().filter.status).toBe("active");
    });
  });

  describe("reset", () => {
    it("clears all state", () => {
      useSessionStore.setState({
        sessions: [makeSession()],
        activeSession: makeSession(),
        timeline: [{ id: "ev-1", sessionId: "sess-1", eventType: "prompt", timestamp: "2026-01-01T00:00:00Z", data: {} }],
        loading: true,
        error: "some error",
        filter: { agent: "claude", status: "active", dateFrom: "2026-01-01", dateTo: "2026-02-01" },
      });

      useSessionStore.getState().reset();

      const state = useSessionStore.getState();
      expect(state.sessions).toEqual([]);
      expect(state.activeSession).toBeNull();
      expect(state.timeline).toEqual([]);
      expect(state.loading).toBe(false);
      expect(state.error).toBeNull();
      expect(state.filter).toEqual(defaultFilter);
    });
  });
});
