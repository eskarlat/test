import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { useAutomationStore } from "../stores/automation-store";
import type { AutomationListItem, ExtensionCronJob } from "../types/automation";

// Mock modules
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
const { default: AutomationsPage } = await import("./automations");

function makeListItem(overrides: Partial<AutomationListItem> = {}): AutomationListItem {
  return {
    id: "auto-1",
    projectId: "proj-1",
    name: "Daily Review",
    enabled: true,
    scheduleType: "cron",
    scheduleCron: "0 9 * * 1-5",
    chainStepCount: 3,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeExtJob(overrides: Partial<ExtensionCronJob> = {}): ExtensionCronJob {
  return {
    id: "job-1",
    extensionName: "test-ext",
    name: "Nightly Sync",
    cron: "0 0 * * *",
    timezone: null,
    enabled: true,
    description: null,
    timeoutMs: null,
    lastRunAt: null,
    lastRunStatus: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function renderWithRouter(ui: React.ReactElement, initialEntry = "/proj-1/automations") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path=":projectId/automations" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AutomationsPage", () => {
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

  it("renders empty state when no automations", () => {
    renderWithRouter(<AutomationsPage />);

    expect(screen.getByText("No automations")).toBeTruthy();
    expect(screen.getByText(/Automations let you chain prompts together/)).toBeTruthy();
  });

  it("renders automation list", () => {
    useAutomationStore.setState({
      automations: [
        makeListItem({ id: "auto-1", name: "Daily Review" }),
        makeListItem({ id: "auto-2", name: "Nightly Deploy" }),
      ],
    });

    renderWithRouter(<AutomationsPage />);

    expect(screen.getByText("Daily Review")).toBeTruthy();
    expect(screen.getByText("Nightly Deploy")).toBeTruthy();
  });

  it("renders extension jobs section", () => {
    useAutomationStore.setState({
      extensionJobs: [
        makeExtJob({ id: "job-1", extensionName: "test-ext", name: "Nightly Sync" }),
      ],
    });

    renderWithRouter(<AutomationsPage />);

    expect(screen.getByText("Extension Jobs")).toBeTruthy();
    expect(screen.getByText(/Nightly Sync/)).toBeTruthy();
  });

  it("displays schedule and step count", () => {
    useAutomationStore.setState({
      automations: [
        makeListItem({ scheduleCron: "0 9 * * 1-5", chainStepCount: 3 }),
      ],
    });

    renderWithRouter(<AutomationsPage />);

    expect(screen.getByText("0 9 * * 1-5")).toBeTruthy();
    expect(screen.getByText("3 steps")).toBeTruthy();
  });

  it("displays last run info", () => {
    useAutomationStore.setState({
      automations: [
        makeListItem({
          lastRun: {
            status: "completed",
            startedAt: new Date().toISOString(),
            durationMs: 5000,
          },
        }),
      ],
    });

    renderWithRouter(<AutomationsPage />);

    expect(screen.getByText("Passed")).toBeTruthy();
  });

  it("renders loading skeleton", () => {
    useAutomationStore.setState({ loading: true });

    renderWithRouter(<AutomationsPage />);

    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });

  it("toggle calls store", async () => {
    const user = userEvent.setup();
    const toggleSpy = vi.fn().mockResolvedValue(undefined);
    useAutomationStore.setState({
      automations: [makeListItem({ id: "auto-1", enabled: true })],
      toggleAutomation: toggleSpy,
    });

    renderWithRouter(<AutomationsPage />);

    const toggle = screen.getByRole("switch", { name: /Disable automation/i });
    await user.click(toggle);

    expect(toggleSpy).toHaveBeenCalledWith("proj-1", "auto-1", false);
  });

  it("Run Now button calls trigger API", async () => {
    const user = userEvent.setup();
    const triggerSpy = vi.fn().mockResolvedValue("run-123");
    useAutomationStore.setState({
      automations: [makeListItem({ id: "auto-1", enabled: true })],
      triggerRun: triggerSpy,
    });

    renderWithRouter(<AutomationsPage />);

    const runBtn = screen.getByRole("button", { name: /Run Now/i });
    await user.click(runBtn);

    expect(triggerSpy).toHaveBeenCalledWith("proj-1", "auto-1");
  });
});
