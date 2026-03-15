import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

// Mock API client
const mockApiGet = vi.fn();
vi.mock("../api/client", () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
  apiPost: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  apiDelete: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
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

// jsdom doesn't implement scrollIntoView
Element.prototype.scrollIntoView = vi.fn();

const { default: LogsPage } = await import("./logs");

function renderWithRouter(path = "/proj-1/logs") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path=":projectId/logs" element={<LogsPage />} />
        <Route path="logs" element={<LogsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("LogsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockResolvedValue({ data: null, error: null, status: 200 });
  });

  it("renders page heading", () => {
    renderWithRouter();
    expect(screen.getByText("Logs")).toBeTruthy();
  });

  it("shows loading state initially", () => {
    mockApiGet.mockReturnValue(new Promise(() => {})); // never resolves
    renderWithRouter();
    expect(screen.getByText("Loading logs...")).toBeTruthy();
  });

  it("shows project-specific description when projectId present", () => {
    renderWithRouter("/proj-1/logs");
    expect(screen.getByText("Logs for project proj-1")).toBeTruthy();
  });

  it("renders log entries after loading", async () => {
    mockApiGet.mockResolvedValue({
      data: [
        { timestamp: "2025-01-01T00:00:00Z", level: "info", source: "worker", message: "Server started" },
        { timestamp: "2025-01-01T00:01:00Z", level: "error", source: "ext-a", message: "Connection failed" },
      ],
      error: null,
      status: 200,
    });
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("2 of 2 entries")).toBeTruthy();
    });
  });

  it("shows error state", async () => {
    mockApiGet.mockResolvedValue({
      data: null,
      error: "Network error",
      status: 500,
    });
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeTruthy();
    });
  });

  it("renders refresh button", () => {
    renderWithRouter();
    expect(screen.getByLabelText("Refresh logs")).toBeTruthy();
  });

  it("renders auto-scroll checkbox", () => {
    renderWithRouter();
    expect(screen.getByText("Auto-scroll")).toBeTruthy();
  });

  it("shows 0 entries when logs are empty", async () => {
    mockApiGet.mockResolvedValue({ data: [], error: null, status: 200 });
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("0 of 0 entries")).toBeTruthy();
    });
  });
});
