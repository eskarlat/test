import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { useAutomationStore } from "../stores/automation-store";
import type { AutomationRunDetail, AutomationListItem } from "../types/automation";

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
const { default: AutomationRunDetailPage } = await import("./automation-run-detail");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRunDetail(overrides: Partial<AutomationRunDetail> = {}): AutomationRunDetail {
  return {
    id: "run-1",
    automationId: "auto-1",
    projectId: "proj-1",
    status: "completed",
    triggerType: "manual",
    startedAt: "2026-01-15T10:00:00Z",
    completedAt: "2026-01-15T10:05:00Z",
    durationMs: 300000,
    stepCount: 2,
    stepsCompleted: 2,
    totalInputTokens: 1000,
    totalOutputTokens: 500,
    steps: [
      {
        stepId: "s1",
        stepName: "Gather Info",
        stepIndex: 0,
        status: "completed",
        startedAt: "2026-01-15T10:00:00Z",
        completedAt: "2026-01-15T10:02:00Z",
        durationMs: 120000,
        model: "claude-3-opus",
        resolvedPrompt: "Analyze the codebase",
        response: "Found 5 issues",
        inputTokens: 500,
        outputTokens: 200,
        toolCalls: [],
      },
      {
        stepId: "s2",
        stepName: "Write Report",
        stepIndex: 1,
        status: "completed",
        startedAt: "2026-01-15T10:02:00Z",
        completedAt: "2026-01-15T10:05:00Z",
        durationMs: 180000,
        model: "claude-3-sonnet",
        resolvedPrompt: "Write report from: {{prev.output}}",
        response: "# Report\n\nHere are the findings...",
        inputTokens: 500,
        outputTokens: 300,
        toolCalls: [
          {
            toolName: "read_file",
            source: "built-in" as const,
            arguments: { path: "/src/main.ts" },
            success: true,
            autoApproved: true,
            startedAt: "2026-01-15T10:03:00Z",
            durationMs: 50,
          },
        ],
      },
    ],
    ...overrides,
  };
}

function makeListItem(): AutomationListItem {
  return {
    id: "auto-1",
    projectId: "proj-1",
    name: "Daily Review",
    enabled: true,
    scheduleType: "cron",
    chainStepCount: 2,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function renderWithRouter(ui: React.ReactElement, initialEntry = "/proj-1/automations/auto-1/runs/run-1") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path=":projectId/automations/:id/runs/:runId" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AutomationRunDetailPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAutomationStore.setState({
      automations: [makeListItem()],
      extensionJobs: [],
      models: [],
      loading: false,
      error: null,
      runs: [],
      activeRun: makeRunDetail(),
      runLoading: false,
      // Prevent the component's useEffect from calling the real store actions
      // which would overwrite activeRun with the mocked apiGet response
      fetchRunDetails: vi.fn().mockResolvedValue(undefined),
      cancelRun: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("renders run header with status badge", () => {
    renderWithRouter(<AutomationRunDetailPage />);

    // The header renders "Run #<first8chars> — <automationName>"
    // Since automationName is fetched via apiGet (mocked to return []), the name
    // part won't appear, but the run number portion should.
    expect(screen.getByText(/Run #run-1/)).toBeTruthy();

    // Status badge should show "Completed" (may appear multiple times in the UI)
    expect(screen.getAllByText("Completed").length).toBeGreaterThanOrEqual(1);

    // Duration should appear (300000ms = 5m 0s)
    expect(screen.getAllByText("5m 0s").length).toBeGreaterThanOrEqual(1);
  });

  it("renders step names in steps section", () => {
    renderWithRouter(<AutomationRunDetailPage />);

    // The Steps section heading
    expect(screen.getByText("Steps")).toBeTruthy();

    // Step names rendered in the StepDetail collapsible headers (may also appear in timeline)
    expect(screen.getAllByText("Gather Info").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Write Report").length).toBeGreaterThanOrEqual(1);
  });

  it("renders chain timeline with step labels", () => {
    renderWithRouter(<AutomationRunDetailPage />);

    // The Chain Timeline heading
    expect(screen.getByText("Chain Timeline")).toBeTruthy();

    // The ChainTimeline component renders step names as labels below the bar.
    // Both step names should appear in the timeline section as well as the steps section.
    // We verify at least the heading is there, confirming the timeline renders.
    const allGatherInfo = screen.getAllByText("Gather Info");
    expect(allGatherInfo.length).toBeGreaterThanOrEqual(2); // timeline label + step detail

    const allWriteReport = screen.getAllByText("Write Report");
    expect(allWriteReport.length).toBeGreaterThanOrEqual(2);
  });

  it("renders worktree info section when worktree data is present", () => {
    useAutomationStore.setState({
      activeRun: makeRunDetail({
        worktree: {
          worktreeId: "wt-1",
          path: "/tmp/worktrees/auto-1", // eslint-disable-line sonarjs/publicly-writable-directories
          branch: "auto/daily-review",
          status: "cleaned_up",
        },
      }),
    });

    renderWithRouter(<AutomationRunDetailPage />);

    // Worktree section heading
    expect(screen.getByText("Worktree")).toBeTruthy();

    // Branch and path values
    expect(screen.getByText("auto/daily-review")).toBeTruthy();
    expect(screen.getByText("/tmp/worktrees/auto-1")).toBeTruthy();

    // Status label mapped from "cleaned_up" -> "Cleaned Up"
    expect(screen.getByText("Cleaned Up")).toBeTruthy();
  });

  it("renders loading skeleton when runLoading is true and activeRun is null", () => {
    useAutomationStore.setState({
      activeRun: null,
      runLoading: true,
    });

    const { container } = renderWithRouter(<AutomationRunDetailPage />);

    // DetailSkeleton renders multiple Skeleton components with animate-pulse
    const skeletons = container.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("renders cancel button for running runs", () => {
    useAutomationStore.setState({
      activeRun: makeRunDetail({ status: "running" }),
    });

    renderWithRouter(<AutomationRunDetailPage />);

    // The CancelRunButton renders a button with "Cancel Run" text
    const cancelButtons = screen.getAllByText("Cancel Run");
    expect(cancelButtons.length).toBeGreaterThanOrEqual(1);

    // Status badge should show "Running"
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it("cancel button calls cancelRun store action", async () => {
    const user = userEvent.setup();
    const cancelSpy = vi.fn().mockResolvedValue(undefined);
    useAutomationStore.setState({
      activeRun: makeRunDetail({ status: "running" }),
      cancelRun: cancelSpy,
    });

    renderWithRouter(<AutomationRunDetailPage />);

    // Click the CancelRunButton in the header (not the LiveRunView one)
    const cancelButtons = screen.getAllByText("Cancel Run");
    await user.click(cancelButtons[0]!);

    expect(cancelSpy).toHaveBeenCalledWith("proj-1", "auto-1", "run-1");
  });

  it("does not render cancel button for completed runs", () => {
    useAutomationStore.setState({
      activeRun: makeRunDetail({ status: "completed" }),
    });

    renderWithRouter(<AutomationRunDetailPage />);

    // There should be no Cancel Run button for completed runs
    expect(screen.queryByText("Cancel Run")).toBeNull();
  });

  it("renders run not found state when activeRun is null and not loading", () => {
    useAutomationStore.setState({
      activeRun: null,
      runLoading: false,
    });

    renderWithRouter(<AutomationRunDetailPage />);

    expect(screen.getByText("Run not found")).toBeTruthy();
    expect(screen.getByText(/This run may have been deleted/)).toBeTruthy();
  });

  it("renders final output section for completed runs", () => {
    renderWithRouter(<AutomationRunDetailPage />);

    // The last step's response is "# Report\n\nHere are the findings..."
    // FinalOutputSection renders this in a <pre> tag
    expect(screen.getByText("Final Output")).toBeTruthy();
  });

  it("renders error section when run has an error", () => {
    useAutomationStore.setState({
      activeRun: makeRunDetail({
        status: "failed",
        error: "Step 2 timed out after 30s",
      }),
    });

    renderWithRouter(<AutomationRunDetailPage />);

    expect(screen.getByText("Run Error")).toBeTruthy();
    expect(screen.getByText("Step 2 timed out after 30s")).toBeTruthy();
  });

  it("step detail tabs switch correctly", async () => {
    const user = userEvent.setup();

    // Use a single step so it auto-expands (defaultExpanded = true when steps.length === 1)
    useAutomationStore.setState({
      activeRun: makeRunDetail({
        steps: [
          {
            stepId: "s1",
            stepName: "Gather Info",
            stepIndex: 0,
            status: "completed",
            startedAt: "2026-01-15T10:00:00Z",
            completedAt: "2026-01-15T10:02:00Z",
            durationMs: 120000,
            model: "claude-3-opus",
            resolvedPrompt: "Analyze the codebase",
            response: "Found 5 issues",
            inputTokens: 500,
            outputTokens: 200,
            toolCalls: [
              {
                toolName: "read_file",
                source: "built-in" as const,
                arguments: { path: "/src/main.ts" },
                success: true,
                autoApproved: true,
                startedAt: "2026-01-15T10:01:00Z",
                durationMs: 50,
              },
            ],
          },
        ],
        stepCount: 1,
        stepsCompleted: 1,
      }),
    });

    renderWithRouter(<AutomationRunDetailPage />);

    // With a single step, it is auto-expanded; the Prompt tab is active by default
    expect(screen.getAllByText("Analyze the codebase").length).toBeGreaterThanOrEqual(1);

    // Switch to Response tab
    const responseTab = screen.getByRole("button", { name: "Response" });
    await user.click(responseTab);
    expect(screen.getAllByText("Found 5 issues").length).toBeGreaterThanOrEqual(1);

    // Switch to Tools tab
    const toolsTab = screen.getByRole("button", { name: "Tools (1)" });
    await user.click(toolsTab);
    expect(screen.getAllByText("read_file").length).toBeGreaterThanOrEqual(1);

    // Switch to Debug tab
    const debugTab = screen.getByRole("button", { name: "Debug" });
    await user.click(debugTab);
    expect(screen.getAllByText("claude-3-opus").length).toBeGreaterThanOrEqual(1);
  });
});
