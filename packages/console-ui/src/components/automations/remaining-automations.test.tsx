import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

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

vi.mock("./ExtensionJobLogsModal", () => ({
  ExtensionJobLogsModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="logs-modal">Logs Modal</div> : null,
}));

vi.mock("./AutopilotDialog", () => ({
  AutopilotDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="autopilot-dialog">Autopilot Dialog</div> : null,
}));

// ---------------------------------------------------------------------------
// Imports (must be after mocks)
// ---------------------------------------------------------------------------

import { useAutomationStore } from "../../stores/automation-store";
import type {
  StepExecution,
  AutomationListItem,
  PromptStep,
  ExtensionCronJob,
} from "../../types/automation";

const { StepDetail } = await import("./StepDetail");
const { AutomationCard } = await import("./AutomationCard");
const { PromptStepEditor } = await import("./PromptStepEditor");
const { ExtensionJobCard } = await import("./ExtensionJobCard");

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

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

// ===========================================================================
// StepDetail
// ===========================================================================

describe("StepDetail", () => {
  function makeStep(overrides: Partial<StepExecution> = {}): StepExecution {
    return {
      stepId: "step-1",
      stepName: "Analyze Code",
      stepIndex: 0,
      status: "completed",
      model: "claude-3.5-sonnet",
      toolCalls: [],
      startedAt: "2024-01-01T00:00:00Z",
      completedAt: "2024-01-01T00:01:00Z",
      durationMs: 60000,
      inputTokens: 1000,
      outputTokens: 500,
      ...overrides,
    };
  }

  it("renders step header with name and index", () => {
    render(<StepDetail step={makeStep()} index={0} />);
    expect(screen.getByText("Analyze Code")).toBeTruthy();
    expect(screen.getByText("#1")).toBeTruthy();
  });

  it("renders duration", () => {
    render(<StepDetail step={makeStep()} index={0} />);
    expect(screen.getByText("1m 0s")).toBeTruthy();
  });

  it("expands when defaultExpanded is true", () => {
    render(<StepDetail step={makeStep({ resolvedPrompt: "Do something" })} index={0} defaultExpanded />);
    // Prompt tab should be visible by default
    expect(screen.getByText("Prompt")).toBeTruthy();
    expect(screen.getByText("Response")).toBeTruthy();
    expect(screen.getByText("Tools (0)")).toBeTruthy();
    expect(screen.getByText("Debug")).toBeTruthy();
  });

  it("shows resolved prompt in prompt tab when expanded", () => {
    render(<StepDetail step={makeStep({ resolvedPrompt: "Please analyze the code" })} index={0} defaultExpanded />);
    expect(screen.getByText("Resolved Prompt:")).toBeTruthy();
    expect(screen.getByText("Please analyze the code")).toBeTruthy();
  });

  it("expands on click", async () => {
    const user = userEvent.setup();
    render(<StepDetail step={makeStep({ resolvedPrompt: "Test prompt" })} index={0} />);
    await user.click(screen.getByText("Analyze Code"));
    expect(screen.getByText("Prompt")).toBeTruthy();
  });

  it("shows model info in prompt tab", () => {
    render(<StepDetail step={makeStep()} index={0} defaultExpanded />);
    expect(screen.getByText("claude-3.5-sonnet")).toBeTruthy();
  });

  it("shows response tab content", async () => {
    const user = userEvent.setup();
    render(<StepDetail step={makeStep({ response: "Here is the analysis" })} index={0} defaultExpanded />);
    await user.click(screen.getByText("Response"));
    expect(screen.getByText("Here is the analysis")).toBeTruthy();
  });

  it("shows 'No response available' when response is empty", async () => {
    const user = userEvent.setup();
    const stepNoResponse = makeStep();
    delete stepNoResponse.response;
    render(<StepDetail step={stepNoResponse} index={0} defaultExpanded />);
    await user.click(screen.getByText("Response"));
    expect(screen.getByText("No response available.")).toBeTruthy();
  });

  it("shows tools tab with tool count", () => {
    const step = makeStep({
      toolCalls: [
        { toolName: "readFile", source: "built-in", arguments: {}, success: true, startedAt: "2024-01-01T00:00:00Z", durationMs: 100 },
      ],
    });
    render(<StepDetail step={step} index={0} defaultExpanded />);
    expect(screen.getByText("Tools (1)")).toBeTruthy();
  });

  it("shows 'No tool calls' when tools tab is empty", async () => {
    const user = userEvent.setup();
    render(<StepDetail step={makeStep()} index={0} defaultExpanded />);
    await user.click(screen.getByText("Tools (0)"));
    expect(screen.getByText("No tool calls in this step.")).toBeTruthy();
  });

  it("shows debug tab with step info", async () => {
    const user = userEvent.setup();
    render(<StepDetail step={makeStep()} index={0} defaultExpanded />);
    await user.click(screen.getByText("Debug"));
    expect(screen.getByText("Step Index:")).toBeTruthy();
    expect(screen.getByText("Duration:")).toBeTruthy();
  });

  it("shows error in debug tab", async () => {
    const user = userEvent.setup();
    render(<StepDetail step={makeStep({ error: "Something went wrong" })} index={0} defaultExpanded />);
    await user.click(screen.getByText("Debug"));
    expect(screen.getByText("Error Details")).toBeTruthy();
    expect(screen.getByText("Something went wrong")).toBeTruthy();
  });
});

// ===========================================================================
// AutomationCard
// ===========================================================================

describe("AutomationCard", () => {
  function makeAutomation(overrides: Partial<AutomationListItem> = {}): AutomationListItem {
    return {
      id: "auto-1",
      projectId: "proj-1",
      name: "Daily Report",
      description: "Generate daily summary",
      enabled: true,
      scheduleType: "cron",
      scheduleCron: "0 9 * * *",
      chainStepCount: 3,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      ...overrides,
    };
  }

  it("renders automation name", () => {
    render(
      <MemoryRouter>
        <AutomationCard automation={makeAutomation()} projectId="proj-1" />
      </MemoryRouter>,
    );
    expect(screen.getByText("Daily Report")).toBeTruthy();
  });

  it("renders description", () => {
    render(
      <MemoryRouter>
        <AutomationCard automation={makeAutomation()} projectId="proj-1" />
      </MemoryRouter>,
    );
    expect(screen.getByText("Generate daily summary")).toBeTruthy();
  });

  it("renders step count", () => {
    render(
      <MemoryRouter>
        <AutomationCard automation={makeAutomation()} projectId="proj-1" />
      </MemoryRouter>,
    );
    expect(screen.getByText("3 steps")).toBeTruthy();
  });

  it("renders singular step count", () => {
    render(
      <MemoryRouter>
        <AutomationCard automation={makeAutomation({ chainStepCount: 1 })} projectId="proj-1" />
      </MemoryRouter>,
    );
    expect(screen.getByText("1 step")).toBeTruthy();
  });

  it("renders schedule info for cron", () => {
    render(
      <MemoryRouter>
        <AutomationCard automation={makeAutomation()} projectId="proj-1" />
      </MemoryRouter>,
    );
    expect(screen.getByText("0 9 * * *")).toBeTruthy();
  });

  it("renders 'Manual trigger only' for manual schedule", () => {
    render(
      <MemoryRouter>
        <AutomationCard automation={(() => { const a = makeAutomation({ scheduleType: "manual" }); delete a.scheduleCron; return a; })()} projectId="proj-1" />
      </MemoryRouter>,
    );
    expect(screen.getByText("Manual trigger only")).toBeTruthy();
  });

  it("renders Run Now button", () => {
    render(
      <MemoryRouter>
        <AutomationCard automation={makeAutomation()} projectId="proj-1" />
      </MemoryRouter>,
    );
    expect(screen.getByText("Run Now")).toBeTruthy();
  });

  it("renders Edit button", () => {
    render(
      <MemoryRouter>
        <AutomationCard automation={makeAutomation()} projectId="proj-1" />
      </MemoryRouter>,
    );
    expect(screen.getByText("Edit")).toBeTruthy();
  });

  it("renders toggle switch", () => {
    render(
      <MemoryRouter>
        <AutomationCard automation={makeAutomation()} projectId="proj-1" />
      </MemoryRouter>,
    );
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  it("shows 'Never run' when no lastRun", () => {
    render(
      <MemoryRouter>
        <AutomationCard automation={makeAutomation()} projectId="proj-1" />
      </MemoryRouter>,
    );
    expect(screen.getByText("Never run")).toBeTruthy();
  });

  it("shows last run status when available", () => {
    render(
      <MemoryRouter>
        <AutomationCard
          automation={makeAutomation({
            lastRun: { status: "completed", startedAt: new Date().toISOString(), durationMs: 5000 },
          })}
          projectId="proj-1"
        />
      </MemoryRouter>,
    );
    expect(screen.getByText("Passed")).toBeTruthy();
  });

  it("disables Run Now button when automation is disabled", () => {
    render(
      <MemoryRouter>
        <AutomationCard automation={makeAutomation({ enabled: false })} projectId="proj-1" />
      </MemoryRouter>,
    );
    const runBtn = screen.getByText("Run Now").closest("button");
    expect(runBtn?.disabled).toBe(true);
  });

  it("renders more actions button", () => {
    render(
      <MemoryRouter>
        <AutomationCard automation={makeAutomation()} projectId="proj-1" />
      </MemoryRouter>,
    );
    expect(screen.getByLabelText("More actions")).toBeTruthy();
  });
});

// ===========================================================================
// PromptStepEditor
// ===========================================================================

describe("PromptStepEditor", () => {
  function makeStep(overrides: Partial<PromptStep> = {}): PromptStep {
    return {
      id: "step-1",
      name: "Analyze",
      prompt: "Do analysis",
      model: "model-1",
      tools: { builtIn: true, extensions: "all", mcp: "all" },
      onError: "stop",
      ...overrides,
    };
  }

  const models = [
    { id: "model-1", name: "Claude 3.5 Sonnet" },
    { id: "model-2", name: "GPT-4" },
  ];

  it("renders step header with index and name", () => {
    render(<PromptStepEditor step={makeStep()} index={0} models={models} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("Step 1: Analyze")).toBeTruthy();
  });

  it("renders step name input field", () => {
    render(<PromptStepEditor step={makeStep()} index={0} models={models} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByDisplayValue("Analyze")).toBeTruthy();
  });

  it("renders prompt textarea", () => {
    render(<PromptStepEditor step={makeStep()} index={0} models={models} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByDisplayValue("Do analysis")).toBeTruthy();
  });

  it("renders collapse and remove buttons", () => {
    render(<PromptStepEditor step={makeStep()} index={0} models={models} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByLabelText("Collapse step")).toBeTruthy();
    expect(screen.getByLabelText("Remove step")).toBeTruthy();
  });

  it("calls onRemove when remove button clicked", async () => {
    const user = userEvent.setup();
    const onRemove = vi.fn();
    render(<PromptStepEditor step={makeStep()} index={0} models={models} onChange={vi.fn()} onRemove={onRemove} />);
    await user.click(screen.getByLabelText("Remove step"));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("collapses body when collapse button clicked", async () => {
    const user = userEvent.setup();
    render(<PromptStepEditor step={makeStep()} index={0} models={models} onChange={vi.fn()} onRemove={vi.fn()} />);
    await user.click(screen.getByLabelText("Collapse step"));
    // After collapsing, the prompt textarea should be hidden
    expect(screen.queryByDisplayValue("Do analysis")).toBeNull();
  });

  it("shows (unnamed) for steps without name", () => {
    render(<PromptStepEditor step={makeStep({ name: "" })} index={0} models={models} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("Step 1: (unnamed)")).toBeTruthy();
  });

  it("renders error strategy selector", () => {
    render(<PromptStepEditor step={makeStep()} index={0} models={models} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("Error Handling")).toBeTruthy();
  });

  it("renders tool access fieldset", () => {
    render(<PromptStepEditor step={makeStep()} index={0} models={models} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("Tool Access")).toBeTruthy();
    expect(screen.getByText("Built-in tools")).toBeTruthy();
  });

  it("renders output format radio buttons", () => {
    render(<PromptStepEditor step={makeStep()} index={0} models={models} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("Output Format")).toBeTruthy();
    expect(screen.getByText("Text")).toBeTruthy();
    expect(screen.getByText("JSON")).toBeTruthy();
  });

  it("renders reasoning effort selector", () => {
    render(<PromptStepEditor step={makeStep()} index={0} models={models} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("Reasoning Effort")).toBeTruthy();
  });

  it("renders timeout field", () => {
    render(<PromptStepEditor step={makeStep()} index={0} models={models} onChange={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("Timeout (seconds)")).toBeTruthy();
  });
});

// ===========================================================================
// ExtensionJobCard
// ===========================================================================

describe("ExtensionJobCard", () => {
  function makeJob(overrides: Partial<ExtensionCronJob> = {}): ExtensionCronJob {
    return {
      id: "job-1",
      extensionName: "my-extension",
      name: "Sync Data",
      cron: "*/5 * * * *",
      timezone: null,
      enabled: true,
      description: "Syncs data every 5 minutes",
      timeoutMs: null,
      lastRunAt: null,
      lastRunStatus: null,
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
      ...overrides,
    };
  }

  it("renders extension name and job name", () => {
    render(<ExtensionJobCard job={makeJob()} projectId="proj-1" />);
    expect(screen.getByText("my-extension: Sync Data")).toBeTruthy();
  });

  it("renders cron schedule", () => {
    render(<ExtensionJobCard job={makeJob()} projectId="proj-1" />);
    expect(screen.getByText("*/5 * * * *")).toBeTruthy();
  });

  it("renders description", () => {
    render(<ExtensionJobCard job={makeJob()} projectId="proj-1" />);
    expect(screen.getByText("Syncs data every 5 minutes")).toBeTruthy();
  });

  it("shows 'Never run' when no last run", () => {
    render(<ExtensionJobCard job={makeJob()} projectId="proj-1" />);
    expect(screen.getByText("Never run")).toBeTruthy();
  });

  it("shows last run status when available", () => {
    render(
      <ExtensionJobCard
        job={makeJob({
          lastRunAt: new Date().toISOString(),
          lastRunStatus: "completed",
        })}
        projectId="proj-1"
      />,
    );
    expect(screen.getByText("completed")).toBeTruthy();
  });

  it("renders toggle switch", () => {
    render(<ExtensionJobCard job={makeJob()} projectId="proj-1" />);
    expect(screen.getByRole("switch")).toBeTruthy();
  });

  it("renders Logs button", () => {
    render(<ExtensionJobCard job={makeJob()} projectId="proj-1" />);
    expect(screen.getByText("Logs")).toBeTruthy();
  });

  it("opens logs modal when Logs clicked", async () => {
    const user = userEvent.setup();
    render(<ExtensionJobCard job={makeJob()} projectId="proj-1" />);
    await user.click(screen.getByText("Logs"));
    expect(screen.getByTestId("logs-modal")).toBeTruthy();
  });

  it("toggle has correct aria-label for enabled state", () => {
    render(<ExtensionJobCard job={makeJob({ enabled: true })} projectId="proj-1" />);
    expect(screen.getByLabelText("Pause job")).toBeTruthy();
  });

  it("toggle has correct aria-label for disabled state", () => {
    render(<ExtensionJobCard job={makeJob({ enabled: false })} projectId="proj-1" />);
    expect(screen.getByLabelText("Resume job")).toBeTruthy();
  });
});
