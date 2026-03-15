import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { useErrorStore } from "../stores/error-store";

// Mock API client
vi.mock("../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  apiPut: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  BASE_URL: "http://localhost:42888",
}));

vi.mock("../api/socket", () => ({
  useSocketStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({ socket: null }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

const { default: ErrorsPage } = await import("./errors");

function renderWithRouter(path = "/proj-1/errors") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path=":projectId/errors" element={<ErrorsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ErrorsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Override fetch methods to be no-ops so useEffect doesn't overwrite state
    useErrorStore.setState({
      patterns: [],
      trends: [],
      loading: false,
      error: null,
      fetchPatterns: () => Promise.resolve(),
      fetchTrends: () => Promise.resolve(),
    });
  });

  it("renders page header", () => {
    renderWithRouter();
    expect(screen.getByText("Error Patterns")).toBeTruthy();
    expect(
      screen.getByText("Recurring errors detected across agent sessions"),
    ).toBeTruthy();
  });

  it("shows loading state", () => {
    useErrorStore.setState({ loading: true });
    renderWithRouter();
    expect(screen.getByText("Loading error patterns...")).toBeTruthy();
  });

  it("shows empty state when no patterns", () => {
    renderWithRouter();
    expect(screen.getByText("No error patterns")).toBeTruthy();
    expect(
      screen.getByText(
        "Error patterns will appear here when the hook system detects recurring errors.",
      ),
    ).toBeTruthy();
  });

  it("renders error patterns list", async () => {
    useErrorStore.setState({
      patterns: [
        {
          id: "err-1",
          projectId: "proj-1",
          fingerprint: "abc123",
          messageTemplate: "TypeError: Cannot read property 'x'",
          occurrenceCount: 5,
          sessionCount: 2,
          status: "active" as const,
          firstSeenAt: "2025-01-01T00:00:00Z",
          lastSeenAt: "2025-01-02T00:00:00Z",
          toolName: "file_edit",
        },
      ],
      trends: [],
      loading: false,
      error: null,
    });
    renderWithRouter();
    await waitFor(() => {
      expect(
        screen.getByText("TypeError: Cannot read property 'x'"),
      ).toBeTruthy();
      expect(screen.getByText("5 occurrences")).toBeTruthy();
      expect(screen.getByText("2 sessions")).toBeTruthy();
      expect(screen.getByText("file_edit")).toBeTruthy();
    });
  });

  it("shows error state", () => {
    useErrorStore.setState({ error: "Failed to fetch", loading: false });
    renderWithRouter();
    expect(screen.getByText("Failed to fetch")).toBeTruthy();
  });

  it("renders trend chart when trend data exists", () => {
    useErrorStore.setState({
      patterns: [
        {
          id: "err-1",
          projectId: "proj-1",
          fingerprint: "abc123",
          messageTemplate: "Error A",
          occurrenceCount: 1,
          sessionCount: 1,
          status: "active" as const,
          firstSeenAt: "2025-01-01T00:00:00Z",
          lastSeenAt: "2025-01-02T00:00:00Z",
        },
      ],
      trends: [
        { date: "2025-01-01", count: 3 },
        { date: "2025-01-02", count: 5 },
      ],
      loading: false,
      error: null,
    });
    renderWithRouter();
    expect(screen.getByText("Error Trend")).toBeTruthy();
    expect(screen.getByText("7d")).toBeTruthy();
    expect(screen.getByText("30d")).toBeTruthy();
  });

  it("renders breadcrumbs", () => {
    renderWithRouter();
    expect(screen.getByText("Dashboard")).toBeTruthy();
  });

  it("returns null when no projectId", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ErrorsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe("");
  });
});
