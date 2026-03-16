import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook } from "@testing-library/react";

// Mock all stores that events.ts imports
vi.mock("../stores/extension-store", () => ({
  useExtensionStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({ fetchExtensions: vi.fn().mockResolvedValue(undefined) }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

vi.mock("../stores/project-store", () => ({
  useProjectStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({
        fetchProjects: vi.fn().mockResolvedValue(undefined),
        activeProjectId: "proj-1",
      }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

vi.mock("../stores/notification-store", () => ({
  useNotificationStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({ addToast: vi.fn(), addEvent: vi.fn() }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

vi.mock("../stores/vault-store", () => ({
  useVaultStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({ fetchKeys: vi.fn().mockResolvedValue(undefined) }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

vi.mock("../stores/session-store", () => ({
  useSessionStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({
        fetchSessions: vi.fn().mockResolvedValue(undefined),
        activeSessionId: null,
        fetchTimeline: vi.fn().mockResolvedValue(undefined),
      }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

vi.mock("../stores/observation-store", () => ({
  useObservationStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({
        fetchObservations: vi.fn().mockResolvedValue(undefined),
      }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

vi.mock("../stores/error-store", () => ({
  useErrorStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({
        fetchPatterns: vi.fn().mockResolvedValue(undefined),
        fetchTrends: vi.fn().mockResolvedValue(undefined),
      }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

vi.mock("../stores/prompt-store", () => ({
  usePromptStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({
        fetchPrompts: vi.fn().mockResolvedValue(undefined),
      }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

vi.mock("../stores/tool-analytics-store", () => ({
  useToolAnalyticsStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({
        fetchAnalytics: vi.fn().mockResolvedValue(undefined),
      }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

vi.mock("../lib/extension-loader", () => ({
  invalidateExtensionModule: vi.fn(),
}));

// Mock socket store
const mockOn = vi.fn().mockReturnValue(undefined);
const mockOff = vi.fn();
const mockEmit = vi.fn();
const mockSocket = { on: mockOn, off: mockOff, emit: mockEmit };

vi.mock("./socket", () => ({
  useSocketStore: Object.assign(
    vi.fn((selector: (s: { socket: unknown; status: string }) => unknown) =>
      selector({ socket: mockSocket, status: "connected" }),
    ),
    {
      getState: () => ({ socket: mockSocket, status: "connected" }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

import { useSystemEvents, useProjectEvents } from "./events";

describe("api/events", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("useSystemEvents", () => {
    it("subscribes to system socket events when connected", () => {
      renderHook(() => useSystemEvents());
      // Should register multiple event listeners
      expect(mockOn).toHaveBeenCalled();
      const events = mockOn.mock.calls.map((call: unknown[]) => call[0]);
      expect(events).toContain("event-history");
      expect(events).toContain("extension:installed");
      expect(events).toContain("extension:removed");
      expect(events).toContain("project:registered");
    });
  });

  describe("useProjectEvents", () => {
    it("subscribes to project-specific events", () => {
      renderHook(() => useProjectEvents("proj-1"));
      expect(mockOn).toHaveBeenCalled();
      const events = mockOn.mock.calls.map((call: unknown[]) => call[0]);
      expect(events).toContain("session:started");
    });
  });
});
