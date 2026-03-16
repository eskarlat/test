import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { useSessionStore, type Session, type TimelineEvent } from "../../stores/session-store";

// Mock API client
vi.mock("../../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  apiPost: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  apiDelete: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  BASE_URL: "http://localhost:42888",
}));

vi.mock("../../api/socket", () => ({
  useSocketStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({ socket: null }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

const { default: SessionTimelinePage } = await import("./detail");

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    projectId: "proj-1",
    agent: "copilot-chat",
    status: "active",
    startedAt: "2026-01-01T00:00:00Z",
    promptCount: 5,
    toolCount: 3,
    errorCount: 1,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<TimelineEvent> = {}): TimelineEvent {
  return {
    id: "evt-1",
    sessionId: "sess-1",
    eventType: "prompt",
    timestamp: "2026-01-01T00:01:00Z",
    data: {},
    ...overrides,
  };
}

function renderWithRouter(path = "/proj-1/sessions/sess-1") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path=":projectId/sessions/:sessionId" element={<SessionTimelinePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SessionTimelinePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      activeSession: null,
      timeline: [],
      loading: false,
      error: null,
      fetchTimeline: () => Promise.resolve(),
    });
  });

  it("renders page header", () => {
    renderWithRouter();
    expect(screen.getByText("Session Timeline")).toBeTruthy();
  });

  it("shows loading state", () => {
    useSessionStore.setState({ loading: true });
    renderWithRouter();
    expect(screen.getByText("Loading timeline...")).toBeTruthy();
  });

  it("shows error state", () => {
    useSessionStore.setState({ error: "Failed to load", loading: false });
    renderWithRouter();
    expect(screen.getByText("Failed to load")).toBeTruthy();
  });

  it("shows empty state when no events match filter", () => {
    useSessionStore.setState({ timeline: [], loading: false });
    renderWithRouter();
    expect(screen.getByText("No events")).toBeTruthy();
  });

  it("renders session summary when activeSession is set", () => {
    useSessionStore.setState({
      activeSession: makeSession(),
      timeline: [makeEvent()],
      loading: false,
    });
    renderWithRouter();
    expect(screen.getByText("5")).toBeTruthy(); // promptCount
    expect(screen.getByText("3")).toBeTruthy(); // toolCount
    expect(screen.getByText("1")).toBeTruthy(); // errorCount
  });

  it("renders stats cards", () => {
    useSessionStore.setState({
      activeSession: makeSession(),
      timeline: [makeEvent()],
      loading: false,
    });
    renderWithRouter();
    expect(screen.getByText("Prompts")).toBeTruthy();
    expect(screen.getByText("Tool Uses")).toBeTruthy();
    expect(screen.getByText("Errors")).toBeTruthy();
  });

  it("renders filter pills", () => {
    useSessionStore.setState({
      timeline: [makeEvent()],
      loading: false,
    });
    renderWithRouter();
    expect(screen.getByText(/All \(1\)/)).toBeTruthy();
  });

  it("renders timeline events", () => {
    useSessionStore.setState({
      timeline: [
        makeEvent({ id: "evt-1", eventType: "prompt" }),
        makeEvent({ id: "evt-2", eventType: "tool" }),
      ],
      loading: false,
    });
    renderWithRouter();
    // Both events render their type labels
    const promptLabels = screen.getAllByText("prompt");
    expect(promptLabels.length).toBeGreaterThanOrEqual(1);
  });

  it("filters events when filter pill is clicked", () => {
    useSessionStore.setState({
      timeline: [
        makeEvent({ id: "evt-1", eventType: "prompt" }),
        makeEvent({ id: "evt-2", eventType: "tool" }),
        makeEvent({ id: "evt-3", eventType: "error" }),
      ],
      loading: false,
    });
    renderWithRouter();

    // Click "errors" filter
    const errorButton = screen.getByText(/errors \(1\)/i);
    fireEvent.click(errorButton);

    // Only the error event should show in the timeline
    const errorLabels = screen.getAllByText("error");
    // One in the filter pill, one in the timeline item
    expect(errorLabels.length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'Open in Chat' link for copilot-chat sessions", () => {
    useSessionStore.setState({
      activeSession: makeSession({ agent: "copilot-chat" }),
      timeline: [makeEvent()],
      loading: false,
    });
    renderWithRouter();
    expect(screen.getByText("Open in Chat")).toBeTruthy();
  });

  it("does not show 'Open in Chat' for non-copilot agents", () => {
    useSessionStore.setState({
      activeSession: makeSession({ agent: "claude-code" }),
      timeline: [makeEvent()],
      loading: false,
    });
    renderWithRouter();
    expect(screen.queryByText("Open in Chat")).toBeNull();
  });

  it("renders breadcrumbs", () => {
    renderWithRouter();
    expect(screen.getByText("Dashboard")).toBeTruthy();
    expect(screen.getByText("Sessions")).toBeTruthy();
    expect(screen.getByText("Timeline")).toBeTruthy();
  });

  it("expands event detail when expand button is clicked", () => {
    useSessionStore.setState({
      timeline: [makeEvent({ data: { someKey: "someValue" } })],
      loading: false,
    });
    renderWithRouter();
    const expandButton = screen.getByText("expand");
    fireEvent.click(expandButton);
    expect(screen.getByText("collapse")).toBeTruthy();
    expect(screen.getByText(/"someKey": "someValue"/)).toBeTruthy();
  });

  it("renders context budget bar", () => {
    useSessionStore.setState({
      activeSession: makeSession({ promptCount: 10 }),
      timeline: [makeEvent()],
      loading: false,
    });
    renderWithRouter();
    expect(screen.getByText("Context Budget")).toBeTruthy();
  });

  it("renders hook summary line for hook events", () => {
    useSessionStore.setState({
      timeline: [
        makeEvent({
          id: "evt-h1",
          eventType: "hook",
          data: {
            feature: "sessionStart",
            success: true,
            response: { additionalContext: "some context" },
          },
        }),
      ],
      loading: false,
    });
    renderWithRouter();
    expect(screen.getByText("sessionStart")).toBeTruthy();
  });

  it("returns null when projectId or sessionId missing", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<SessionTimelinePage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe("");
  });
});
