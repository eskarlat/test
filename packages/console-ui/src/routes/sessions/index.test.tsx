import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { useSessionStore, type Session } from "../../stores/session-store";

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

const { default: SessionListPage } = await import("./index");

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess-1",
    projectId: "proj-1",
    agent: "copilot-chat",
    status: "active",
    startedAt: "2026-01-01T00:00:00Z",
    promptCount: 5,
    toolCount: 3,
    errorCount: 0,
    ...overrides,
  };
}

function renderWithRouter(path = "/proj-1/sessions") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path=":projectId/sessions" element={<SessionListPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SessionListPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      sessions: [],
      loading: false,
      error: null,
      filter: { agent: undefined, status: undefined, dateFrom: undefined, dateTo: undefined },
      fetchSessions: () => Promise.resolve(),
      setFilter: (f) =>
        useSessionStore.setState((s) => ({ filter: { ...s.filter, ...f } })),
    });
  });

  it("renders page header", () => {
    renderWithRouter();
    const elements = screen.getAllByText("Sessions");
    expect(elements.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Agent session history and timelines")).toBeTruthy();
  });

  it("renders breadcrumbs", () => {
    renderWithRouter();
    expect(screen.getByText("Dashboard")).toBeTruthy();
  });

  it("shows loading state", () => {
    useSessionStore.setState({ loading: true });
    renderWithRouter();
    expect(screen.getByText("Loading sessions...")).toBeTruthy();
  });

  it("shows error state", () => {
    useSessionStore.setState({ error: "Server error", loading: false });
    renderWithRouter();
    expect(screen.getByText("Server error")).toBeTruthy();
  });

  it("shows empty state when no sessions", () => {
    renderWithRouter();
    expect(screen.getByText("No sessions found")).toBeTruthy();
  });

  it("renders session rows", () => {
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "sess-1" }),
        makeSession({ id: "sess-2", agent: "claude-code", status: "ended" }),
      ],
    });
    renderWithRouter();
    expect(screen.getByText("sess-1")).toBeTruthy();
    expect(screen.getByText("sess-2")).toBeTruthy();
  });

  it("shows session count", () => {
    useSessionStore.setState({
      sessions: [makeSession({ id: "sess-1" }), makeSession({ id: "sess-2" })],
    });
    renderWithRouter();
    expect(screen.getByText(/2 sessions/)).toBeTruthy();
  });

  it("renders filter inputs", () => {
    renderWithRouter();
    expect(screen.getByPlaceholderText("Filter by agent...")).toBeTruthy();
    expect(screen.getByText("All statuses")).toBeTruthy();
  });

  it("filters sessions by agent text", () => {
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "sess-1", agent: "copilot-chat" }),
        makeSession({ id: "sess-2", agent: "claude-code" }),
      ],
    });
    renderWithRouter();

    const input = screen.getByPlaceholderText("Filter by agent...");
    fireEvent.change(input, { target: { value: "claude" } });

    // Only sess-2 with claude-code should remain visible
    expect(screen.queryByText("sess-1")).toBeNull();
    expect(screen.getByText("sess-2")).toBeTruthy();
  });

  it("filters sessions by status", () => {
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "sess-1", status: "active" }),
        makeSession({ id: "sess-2", status: "ended" }),
      ],
    });
    renderWithRouter();

    const select = screen.getByDisplayValue("All statuses");
    fireEvent.change(select, { target: { value: "ended" } });

    expect(screen.queryByText("sess-1")).toBeNull();
    expect(screen.getByText("sess-2")).toBeTruthy();
  });

  it("shows session stats (prompts, tools, errors)", () => {
    useSessionStore.setState({
      sessions: [makeSession({ promptCount: 10, toolCount: 7, errorCount: 2 })],
    });
    renderWithRouter();
    expect(screen.getByText("10p")).toBeTruthy();
    expect(screen.getByText("7t")).toBeTruthy();
    expect(screen.getByText("2e")).toBeTruthy();
  });

  it("highlights error count when > 0", () => {
    useSessionStore.setState({
      sessions: [makeSession({ errorCount: 3 })],
    });
    renderWithRouter();
    const errorSpan = screen.getByText("3e");
    expect(errorSpan.className).toContain("text-red-500");
  });

  it("does not highlight error count when 0", () => {
    useSessionStore.setState({
      sessions: [makeSession({ errorCount: 0 })],
    });
    renderWithRouter();
    const errorSpan = screen.getByText("0e");
    expect(errorSpan.className).not.toContain("text-red-500");
  });

  it("renders Context expand button per session row", () => {
    useSessionStore.setState({
      sessions: [makeSession()],
    });
    renderWithRouter();
    expect(screen.getByText("Context")).toBeTruthy();
  });

  it("returns null when no projectId", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<SessionListPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("shows filtered count vs total when filter is active", () => {
    useSessionStore.setState({
      sessions: [
        makeSession({ id: "sess-1", agent: "copilot-chat" }),
        makeSession({ id: "sess-2", agent: "claude-code" }),
      ],
    });
    renderWithRouter();

    const input = screen.getByPlaceholderText("Filter by agent...");
    fireEvent.change(input, { target: { value: "copilot" } });

    expect(screen.getByText(/1 session/)).toBeTruthy();
    expect(screen.getByText(/2 total/)).toBeTruthy();
  });

  it("renders table header row", () => {
    useSessionStore.setState({
      sessions: [makeSession()],
    });
    renderWithRouter();
    expect(screen.getByText("Agent")).toBeTruthy();
    expect(screen.getByText("Session ID")).toBeTruthy();
    expect(screen.getByText("Status")).toBeTruthy();
  });
});
