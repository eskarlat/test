import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { useAutomationStore } from "../stores/automation-store";
import type { AutomationRun, AutomationListItem } from "../types/automation";

// ---------------------------------------------------------------------------
// Mock modules
// ---------------------------------------------------------------------------

vi.mock("../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: [], error: null, status: 200 }),
  apiPost: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  apiPut: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
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

vi.mock("../stores/notification-store", () => ({
  useNotificationStore: Object.assign(
    vi.fn((selector: (s: { addToast: () => void }) => unknown) => selector({ addToast: vi.fn() })),
    {
      getState: () => ({ addToast: vi.fn() }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

// Must import lazily after mocks
const { default: AutomationRunsPage } = await import("./automation-runs");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRun(overrides: Partial<AutomationRun> = {}): AutomationRun {
  return {
    id: "run-1",
    automationId: "auto-1",
    projectId: "proj-1",
    status: "completed",
    triggerType: "manual",
    startedAt: "2026-01-15T10:00:00Z",
    completedAt: "2026-01-15T10:05:00Z",
    durationMs: 300000,
    stepCount: 3,
    stepsCompleted: 3,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    ...overrides,
  };
}

function makeListItem(overrides: Partial<AutomationListItem> = {}): AutomationListItem {
  return {
    id: "auto-1",
    projectId: "proj-1",
    name: "Daily Review",
    enabled: true,
    scheduleType: "cron",
    chainStepCount: 3,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderWithRouter(ui: React.ReactElement, initialEntry = "/proj-1/automations/auto-1/runs") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path=":projectId/automations/:id/runs" element={ui} />
        <Route path=":projectId/automations/:id/runs/:runId" element={<div>Run Detail Page</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AutomationRunsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAutomationStore.setState({
      automations: [makeListItem()],
      extensionJobs: [],
      models: [],
      loading: false,
      error: null,
      runs: [],
      activeRun: null,
      runLoading: false,
    });
  });

  it("renders run list with multiple runs", () => {
    useAutomationStore.setState({
      runs: [
        makeRun({ id: "run-1", status: "completed" }),
        makeRun({ id: "run-2", status: "completed" }),
      ],
    });

    renderWithRouter(<AutomationRunsPage />);

    // The component renders "Run #{index}" where index is (sortedRuns.length - 1 - i)
    // For 2 runs: first card gets index 1 -> "Run #2", second card gets index 0 -> "Run #1"
    expect(screen.getByText("Run #2")).toBeTruthy();
    expect(screen.getByText("Run #1")).toBeTruthy();

    // Each run should have a Details button
    const detailButtons = screen.getAllByText("Details");
    expect(detailButtons).toHaveLength(2);
  });

  it("displays run status badges correctly for different statuses", () => {
    useAutomationStore.setState({
      runs: [
        makeRun({ id: "run-1", status: "completed" }),
        makeRun({ id: "run-2", status: "failed" }),
        makeRun({ id: "run-3", status: "cancelled" }),
      ],
    });

    renderWithRouter(<AutomationRunsPage />);

    // RunStatusBadge renders the label from runStatusConfig
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByText("Failed")).toBeTruthy();
    expect(screen.getByText("Cancelled")).toBeTruthy();
  });

  it("renders empty state when no runs", () => {
    useAutomationStore.setState({ runs: [] });

    renderWithRouter(<AutomationRunsPage />);

    expect(screen.getByText("No runs yet")).toBeTruthy();
    expect(
      screen.getByText("Trigger a manual run or wait for a scheduled run to appear here."),
    ).toBeTruthy();
  });

  it("renders loading skeleton when runLoading is true and runs are empty", () => {
    useAutomationStore.setState({ runLoading: true, runs: [] });

    renderWithRouter(<AutomationRunsPage />);

    // The RunListSkeleton renders Skeleton components that use animate-pulse
    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("displays status filter dropdown with all options", () => {
    renderWithRouter(<AutomationRunsPage />);

    const select = screen.getByRole("combobox");
    expect(select).toBeTruthy();

    // Verify all filter options are present
    const options = screen.getAllByRole("option");
    const optionLabels = options.map((o) => o.textContent);
    expect(optionLabels).toContain("All Statuses");
    expect(optionLabels).toContain("Running");
    expect(optionLabels).toContain("Completed");
    expect(optionLabels).toContain("Failed");
    expect(optionLabels).toContain("Cancelled");
    expect(optionLabels).toContain("Timed Out");
  });

  it("changes status filter on selection", async () => {
    const user = userEvent.setup();

    useAutomationStore.setState({
      runs: [makeRun({ id: "run-1", status: "completed" })],
    });

    renderWithRouter(<AutomationRunsPage />);

    const select = screen.getByRole("combobox");
    await user.selectOptions(select, "failed");

    // After selecting "failed", the select value should update
    expect((select as HTMLSelectElement).value).toBe("failed");
  });

  it("navigates to run detail when Details button is clicked", async () => {
    const user = userEvent.setup();

    useAutomationStore.setState({
      runs: [makeRun({ id: "run-1", status: "completed" })],
    });

    renderWithRouter(<AutomationRunsPage />);

    const detailsBtn = screen.getByText("Details");
    await user.click(detailsBtn);

    // After clicking, the router should navigate to the run detail route
    expect(screen.getByText("Run Detail Page")).toBeTruthy();
  });

  it("renders run metadata including duration, steps, and tokens", () => {
    useAutomationStore.setState({
      runs: [
        makeRun({
          id: "run-1",
          durationMs: 300000,
          stepCount: 3,
          stepsCompleted: 3,
          totalInputTokens: 1000,
          totalOutputTokens: 500,
        }),
      ],
    });

    renderWithRouter(<AutomationRunsPage />);

    // Duration: 300000ms = 5m 0s
    expect(screen.getByText("5m 0s")).toBeTruthy();
    // Steps: 3/3
    expect(screen.getByText("3/3")).toBeTruthy();
    // Tokens: 1000 + 500 = 1500
    expect(screen.getByText("1,500")).toBeTruthy();
  });

  it("renders trigger type label", () => {
    useAutomationStore.setState({
      runs: [
        makeRun({ id: "run-1", triggerType: "manual" }),
        makeRun({ id: "run-2", triggerType: "scheduled" }),
      ],
    });

    renderWithRouter(<AutomationRunsPage />);

    expect(screen.getByText("Manual")).toBeTruthy();
    expect(screen.getByText("Scheduled")).toBeTruthy();
  });

  it("renders header with Run History title", () => {
    renderWithRouter(<AutomationRunsPage />);

    expect(screen.getByText("Run History")).toBeTruthy();
  });

  it("renders back button and refresh button", () => {
    renderWithRouter(<AutomationRunsPage />);

    expect(screen.getByLabelText("Back to automations")).toBeTruthy();
    expect(screen.getByLabelText("Refresh runs")).toBeTruthy();
  });
});
