import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { useToolAnalyticsStore } from "../stores/tool-analytics-store";

// Mock API client
vi.mock("../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
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

// Mock recharts to avoid rendering issues in jsdom
vi.mock("recharts", () => ({
  BarChart: ({ children }: { children: React.ReactNode }) => <div data-testid="bar-chart">{children}</div>,
  Bar: () => <div />,
  XAxis: () => <div />,
  YAxis: () => <div />,
  Tooltip: () => <div />,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  CartesianGrid: () => <div />,
}));

const { default: ToolAnalyticsPage } = await import("./tools");

function renderWithRouter(path = "/proj-1/tools") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path=":projectId/tools" element={<ToolAnalyticsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ToolAnalyticsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Override fetch methods to be no-ops so useEffect doesn't overwrite state
    useToolAnalyticsStore.setState({
      analytics: null,
      warnings: [],
      loading: false,
      error: null,
      fetchAnalytics: () => Promise.resolve(),
      fetchWarnings: () => Promise.resolve(),
    });
  });

  it("renders page heading", () => {
    renderWithRouter();
    // "Tool Analytics" appears in breadcrumb and h1, use getAllByText
    const elements = screen.getAllByText("Tool Analytics");
    expect(elements.length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText("Usage statistics for tools used by AI agents"),
    ).toBeTruthy();
  });

  it("shows loading state", () => {
    useToolAnalyticsStore.setState({ loading: true });
    renderWithRouter();
    expect(screen.getByText("Loading tool analytics...")).toBeTruthy();
  });

  it("shows empty state when no analytics", () => {
    renderWithRouter();
    expect(screen.getByText("No tool analytics")).toBeTruthy();
    expect(
      screen.getByText("Tool usage data will appear here as agents use tools."),
    ).toBeTruthy();
  });

  it("shows error state", () => {
    useToolAnalyticsStore.setState({ error: "Fetch failed" });
    renderWithRouter();
    expect(screen.getByText("Fetch failed")).toBeTruthy();
  });

  it("renders stats cards when analytics available", async () => {
    useToolAnalyticsStore.setState({
      analytics: {
        totalCount: 150,
        successRate: 0.923,
        byTool: { file_edit: 80, bash: 50, read_file: 20 },
        fileHotspots: [],
        mostTouchedFiles: [],
      },
    });
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("Total Tool Uses")).toBeTruthy();
      expect(screen.getByText("150")).toBeTruthy();
      expect(screen.getByText("Success Rate")).toBeTruthy();
      expect(screen.getByText("92.3%")).toBeTruthy();
      expect(screen.getByText("Unique Tools")).toBeTruthy();
      expect(screen.getByText("3")).toBeTruthy();
    });
  });

  it("renders tool breakdown table", async () => {
    useToolAnalyticsStore.setState({
      analytics: {
        totalCount: 100,
        successRate: 0.95,
        byTool: { file_edit: 60, bash: 40 },
        fileHotspots: [],
        mostTouchedFiles: [],
      },
    });
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("Command Frequency")).toBeTruthy();
      expect(screen.getByText("file_edit")).toBeTruthy();
      expect(screen.getByText("bash")).toBeTruthy();
    });
  });

  it("renders warnings when present", async () => {
    useToolAnalyticsStore.setState({
      analytics: {
        totalCount: 50,
        successRate: 0.8,
        byTool: { bash: 50 },
        fileHotspots: [],
        mostTouchedFiles: [],
      },
      warnings: [
        {
          type: "excessive_retries",
          sessionId: "sess-1",
          detail: "Tool bash retried 5 times",
          createdAt: "2025-01-01T00:00:00Z",
        },
      ],
    });
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("Warnings (1)")).toBeTruthy();
      expect(screen.getByText("excessive_retries")).toBeTruthy();
      expect(screen.getByText("Tool bash retried 5 times")).toBeTruthy();
    });
  });

  it("renders file hotspots when present", async () => {
    useToolAnalyticsStore.setState({
      analytics: {
        totalCount: 50,
        successRate: 0.9,
        byTool: { file_edit: 50 },
        fileHotspots: [
          { filePath: "src/index.ts", count: 15 },
          { filePath: "src/utils.ts", count: 8 },
        ],
        mostTouchedFiles: [],
      },
    });
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("File Hotspots")).toBeTruthy();
      expect(screen.getByText("src/index.ts")).toBeTruthy();
      expect(screen.getByText("15")).toBeTruthy();
      expect(screen.getByText("src/utils.ts")).toBeTruthy();
      expect(screen.getByText("8")).toBeTruthy();
    });
  });

  it("renders breadcrumbs", () => {
    renderWithRouter();
    expect(screen.getByText("Dashboard")).toBeTruthy();
  });

  it("returns null when no projectId", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ToolAnalyticsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe("");
  });
});
