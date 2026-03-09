import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { useAutomationStore } from "../../stores/automation-store";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: [], error: null, status: 200 }),
  apiPost: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  apiPut: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  apiDelete: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  BASE_URL: "http://localhost:42888",
}));

const mockEmit = vi.fn();
const mockOn = vi.fn();
const mockOff = vi.fn();

const mockSocket = { emit: mockEmit, on: mockOn, off: mockOff };

vi.mock("../../api/socket", () => ({
  useSocketStore: Object.assign(
    vi.fn((selector: (s: { socket: unknown }) => unknown) =>
      selector({ socket: mockSocket }),
    ),
    {
      getState: () => ({ socket: mockSocket }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

vi.mock("../../stores/notification-store", () => ({
  useNotificationStore: Object.assign(
    vi.fn((selector: (s: { addToast: () => void }) => unknown) =>
      selector({ addToast: vi.fn() }),
    ),
    {
      getState: () => ({ addToast: vi.fn() }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

// Must import lazily after mocks
const { LiveRunView } = await import("./LiveRunView");

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

const defaultProps = {
  runId: "run-123",
  projectId: "proj-1",
  automationId: "auto-1",
  onRunComplete: vi.fn(),
};

function renderLiveRunView(overrides: Partial<typeof defaultProps> = {}) {
  return render(<LiveRunView {...defaultProps} {...overrides} />);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("LiveRunView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAutomationStore.setState({
      automations: [],
      extensionJobs: [],
      models: [],
      loading: false,
      error: null,
      runs: [],
      activeRun: null,
      runLoading: false,
    });
  });

  it("joins room on mount", () => {
    renderLiveRunView();

    // joinRunRoom in the store calls socket.emit("automation:join", { runId })
    expect(mockEmit).toHaveBeenCalledWith("automation:join", { runId: "run-123" });
  });

  it("leaves room on unmount", () => {
    const { unmount } = renderLiveRunView();

    // Clear the join call
    mockEmit.mockClear();

    unmount();

    expect(mockEmit).toHaveBeenCalledWith("automation:leave", { runId: "run-123" });
  });

  it("registers event listeners on mount", () => {
    renderLiveRunView();

    const registeredEvents = mockOn.mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );

    const expectedEvents = [
      "automation:step-started",
      "automation:step-completed",
      "automation:step-failed",
      "automation:tool-called",
      "automation:message-delta",
      "automation:log",
      "automation:run-completed",
    ];

    for (const event of expectedEvents) {
      expect(registeredEvents).toContain(event);
    }
  });

  it("unregisters event listeners on unmount", () => {
    const { unmount } = renderLiveRunView();

    unmount();

    const unregisteredEvents = mockOff.mock.calls.map(
      (call: unknown[]) => call[0] as string,
    );

    const expectedEvents = [
      "automation:step-started",
      "automation:step-completed",
      "automation:step-failed",
      "automation:tool-called",
      "automation:message-delta",
      "automation:log",
      "automation:run-completed",
    ];

    for (const event of expectedEvents) {
      expect(unregisteredEvents).toContain(event);
    }
  });

  it("renders live run header", () => {
    renderLiveRunView();

    expect(screen.getByText("Live Run in Progress")).toBeTruthy();
  });

  it("renders cancel button", () => {
    renderLiveRunView();

    expect(screen.getByText("Cancel Run")).toBeTruthy();
  });

  it("renders activity log section", () => {
    renderLiveRunView();

    expect(screen.getByText("Activity Log")).toBeTruthy();
  });

  it("shows waiting message when no activity yet", () => {
    renderLiveRunView();

    expect(screen.getByText("Waiting for activity...")).toBeTruthy();
  });
});
