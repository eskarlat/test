import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { AutomationStatusBadge } from "./AutomationStatusBadge";
import { RunStatusBadge } from "./RunStatusBadge";
import { ModelSelector } from "./ModelSelector";
import { SectionHelp } from "./SectionHelp";
import { ChainTimeline } from "./ChainTimeline";
import { AutopilotDialog } from "./AutopilotDialog";
import { StepDetail } from "./StepDetail";
import type { StepExecution, ToolCallLog } from "../../types/automation";

describe("AutomationStatusBadge", () => {
  it.each([
    ["running", "RUNNING"],
    ["completed", "COMPLETED"],
    ["completed_with_warnings", "WARNINGS"],
    ["failed", "FAILED"],
    ["cancelled", "CANCELLED"],
    ["timed_out", "TIMED OUT"],
    ["pending", "PENDING"],
  ] as const)("renders %s status as %s", (status, label) => {
    render(<AutomationStatusBadge status={status} />);
    expect(screen.getByText(label)).toBeTruthy();
  });

  it("renders UNKNOWN for unknown status", () => {
    render(<AutomationStatusBadge status="other" />);
    expect(screen.getByText("UNKNOWN")).toBeTruthy();
  });
});

describe("RunStatusBadge", () => {
  it("renders run variant by default", () => {
    render(<RunStatusBadge status="completed" />);
    expect(screen.getByText("Completed")).toBeTruthy();
  });

  it("renders step variant", () => {
    render(<RunStatusBadge status="skipped" variant="step" />);
    expect(screen.getByText("Skipped")).toBeTruthy();
  });

  it("renders Unknown for unknown status", () => {
    render(<RunStatusBadge status="xyz" />);
    expect(screen.getByText("Unknown")).toBeTruthy();
  });

  it.each(["completed", "failed", "cancelled", "timed_out", "running", "pending"])(
    "renders run status %s",
    (status) => {
      const { container } = render(<RunStatusBadge status={status} />);
      expect(container.textContent).toBeTruthy();
    },
  );
});

describe("ModelSelector", () => {
  const models = [
    { id: "gpt-4", name: "GPT-4", capabilities: ["code", "reasoning"] },
    { id: "claude", name: "Claude", capabilities: ["code"] },
  ];

  it("renders select with models", () => {
    render(<ModelSelector models={models} value="" onChange={vi.fn()} />);
    expect(screen.getByText("Select a model")).toBeTruthy();
    expect(screen.getByText("GPT-4")).toBeTruthy();
    expect(screen.getByText("Claude")).toBeTruthy();
  });

  it("calls onChange when selection changes", () => {
    const onChange = vi.fn();
    render(<ModelSelector models={models} value="" onChange={onChange} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "gpt-4" } });
    expect(onChange).toHaveBeenCalledWith("gpt-4");
  });

  it("shows capability badges when a model is selected", () => {
    render(<ModelSelector models={models} value="gpt-4" onChange={vi.fn()} />);
    expect(screen.getByText("code")).toBeTruthy();
    expect(screen.getByText("reasoning")).toBeTruthy();
  });
});

describe("SectionHelp", () => {
  it("renders collapsed by default", () => {
    render(<SectionHelp title="Tips"><p>Some tips</p></SectionHelp>);
    expect(screen.getByText("Tips")).toBeTruthy();
    expect(screen.queryByText("Some tips")).toBeNull();
  });

  it("expands on click", () => {
    render(<SectionHelp title="Tips"><p>Some tips</p></SectionHelp>);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Some tips")).toBeTruthy();
  });

  it("collapses on second click", () => {
    render(<SectionHelp title="Tips"><p>Some tips</p></SectionHelp>);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("Some tips")).toBeNull();
  });
});

describe("ChainTimeline", () => {
  it("returns null for empty steps", () => {
    const { container } = render(<ChainTimeline steps={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders steps with duration", () => {
    const steps = [
      { stepId: "s1", stepName: "Build", status: "completed", durationMs: 2000 },
      { stepId: "s2", stepName: "Test", status: "failed", durationMs: 5000 },
    ];
    render(<ChainTimeline steps={steps as any} />);
    expect(screen.getAllByText("Build").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Test").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("2.0s").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("5.0s").length).toBeGreaterThanOrEqual(1);
  });

  it("renders steps without duration (equal widths)", () => {
    const steps = [
      { stepId: "s1", stepName: "Step A", status: "pending" },
      { stepId: "s2", stepName: "Step B", status: "running" },
    ];
    render(<ChainTimeline steps={steps as any} />);
    expect(screen.getAllByText("Step A").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Step B").length).toBeGreaterThanOrEqual(1);
  });

  it("formats minute durations", () => {
    const steps = [
      { stepId: "s1", stepName: "Long", status: "completed", durationMs: 125000 },
    ];
    render(<ChainTimeline steps={steps as any} />);
    expect(screen.getAllByText("2m 5s").length).toBeGreaterThanOrEqual(1);
  });

  it("formats millisecond durations", () => {
    const steps = [
      { stepId: "s1", stepName: "Fast", status: "completed", durationMs: 500 },
    ];
    render(<ChainTimeline steps={steps as any} />);
    expect(screen.getAllByText("500ms").length).toBeGreaterThanOrEqual(1);
  });
});

describe("AutopilotDialog", () => {
  it("renders nothing when not open", () => {
    const { container } = render(
      <AutopilotDialog open={false} onConfirm={vi.fn()} onCancel={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders dialog when open", () => {
    render(<AutopilotDialog open={true} onConfirm={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByText("Enable Autopilot Mode")).toBeTruthy();
    expect(screen.getByText("Enable Autopilot")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("calls onConfirm when confirm button clicked", () => {
    const onConfirm = vi.fn();
    render(<AutopilotDialog open={true} onConfirm={onConfirm} onCancel={vi.fn()} />);
    fireEvent.click(screen.getByText("Enable Autopilot"));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("calls onCancel when cancel button clicked", () => {
    const onCancel = vi.fn();
    render(<AutopilotDialog open={true} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("calls onCancel on Escape key", () => {
    const onCancel = vi.fn();
    render(<AutopilotDialog open={true} onConfirm={vi.fn()} onCancel={onCancel} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// StepDetail
// ---------------------------------------------------------------------------

function makeToolCall(overrides: Partial<ToolCallLog> = {}): ToolCallLog {
  return {
    toolName: "read_file",
    source: "built-in",
    arguments: { path: "/src/index.ts" },
    success: true,
    startedAt: "2024-06-01T10:00:00Z",
    durationMs: 150,
    ...overrides,
  };
}

function makeStep(overrides: Partial<StepExecution> = {}): StepExecution {
  return {
    stepId: "step-1",
    stepName: "Build Project",
    stepIndex: 0,
    status: "completed",
    startedAt: "2024-06-01T10:00:00Z",
    completedAt: "2024-06-01T10:00:05Z",
    durationMs: 5000,
    model: "gpt-4",
    resolvedPrompt: "Build the project",
    response: "Done building",
    inputTokens: 100,
    outputTokens: 200,
    toolCalls: [],
    ...overrides,
  };
}

describe("StepDetail", () => {
  it("renders collapsed by default", () => {
    render(<StepDetail step={makeStep()} index={0} />);
    expect(screen.getByText("Build Project")).toBeInTheDocument();
    expect(screen.getByText("#1")).toBeInTheDocument();
    // Tabs should not be visible when collapsed
    expect(screen.queryByText("Prompt")).not.toBeInTheDocument();
  });

  it("renders expanded when defaultExpanded is true", () => {
    render(<StepDetail step={makeStep()} index={0} defaultExpanded />);
    expect(screen.getByText("Prompt")).toBeInTheDocument();
    expect(screen.getByText("Response")).toBeInTheDocument();
    expect(screen.getByText("Tools (0)")).toBeInTheDocument();
    expect(screen.getByText("Debug")).toBeInTheDocument();
  });

  it("expands on click", () => {
    render(<StepDetail step={makeStep()} index={0} />);
    fireEvent.click(screen.getByText("Build Project"));
    expect(screen.getByText("Prompt")).toBeInTheDocument();
  });

  it("collapses on second click", () => {
    render(<StepDetail step={makeStep()} index={0} />);
    fireEvent.click(screen.getByText("Build Project"));
    expect(screen.getByText("Prompt")).toBeInTheDocument();
    fireEvent.click(screen.getByText("Build Project"));
    expect(screen.queryByText("Prompt")).not.toBeInTheDocument();
  });

  it("shows step duration", () => {
    render(<StepDetail step={makeStep({ durationMs: 5000 })} index={0} />);
    expect(screen.getByText("5.0s")).toBeInTheDocument();
  });

  it("shows step duration in minutes", () => {
    render(<StepDetail step={makeStep({ durationMs: 125000 })} index={0} />);
    expect(screen.getByText("2m 5s")).toBeInTheDocument();
  });

  it("shows step duration in milliseconds", () => {
    render(<StepDetail step={makeStep({ durationMs: 500 })} index={0} />);
    expect(screen.getByText("500ms")).toBeInTheDocument();
  });

  it("shows dash for undefined duration", () => {
    render(<StepDetail step={makeStep({ durationMs: undefined })} index={0} />);
    expect(screen.getByText("-")).toBeInTheDocument();
  });

  it("shows step index correctly", () => {
    render(<StepDetail step={makeStep()} index={2} />);
    expect(screen.getByText("#3")).toBeInTheDocument();
  });

  // ---- Prompt tab ----
  it("shows resolved prompt in Prompt tab", () => {
    render(<StepDetail step={makeStep()} index={0} defaultExpanded />);
    expect(screen.getByText("Resolved Prompt:")).toBeInTheDocument();
    expect(screen.getByText("Build the project")).toBeInTheDocument();
  });

  it("shows system prompt in Prompt tab", () => {
    render(<StepDetail step={makeStep({ systemPrompt: "You are a build assistant" })} index={0} defaultExpanded />);
    expect(screen.getByText("System Prompt:")).toBeInTheDocument();
    expect(screen.getByText("You are a build assistant")).toBeInTheDocument();
  });

  it("shows model in Prompt tab", () => {
    render(<StepDetail step={makeStep()} index={0} defaultExpanded />);
    expect(screen.getByText("gpt-4")).toBeInTheDocument();
  });

  it("shows reasoning effort when provided", () => {
    render(<StepDetail step={makeStep({ reasoningEffort: "high" })} index={0} defaultExpanded />);
    expect(screen.getByText("high")).toBeInTheDocument();
  });

  // ---- Response tab ----
  it("shows response text in Response tab", () => {
    render(<StepDetail step={makeStep()} index={0} defaultExpanded />);
    fireEvent.click(screen.getByText("Response"));
    expect(screen.getByText("Done building")).toBeInTheDocument();
  });

  it("shows 'no response' when response is missing", () => {
    render(<StepDetail step={makeStep({ response: undefined })} index={0} defaultExpanded />);
    fireEvent.click(screen.getByText("Response"));
    expect(screen.getByText("No response available.")).toBeInTheDocument();
  });

  it("shows token counts in Response tab", () => {
    render(<StepDetail step={makeStep()} index={0} defaultExpanded />);
    fireEvent.click(screen.getByText("Response"));
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("200")).toBeInTheDocument();
  });

  // ---- Tools tab ----
  it("shows tool calls count in tab", () => {
    const step = makeStep({ toolCalls: [makeToolCall(), makeToolCall({ toolName: "write_file" })] });
    render(<StepDetail step={step} index={0} defaultExpanded />);
    expect(screen.getByText("Tools (2)")).toBeInTheDocument();
  });

  it("shows 'no tool calls' when empty", () => {
    render(<StepDetail step={makeStep()} index={0} defaultExpanded />);
    fireEvent.click(screen.getByText("Tools (0)"));
    expect(screen.getByText("No tool calls in this step.")).toBeInTheDocument();
  });

  it("renders tool call rows with names", () => {
    const step = makeStep({
      toolCalls: [
        makeToolCall({ toolName: "read_file", success: true }),
        makeToolCall({ toolName: "write_file", success: false, error: "Permission denied" }),
      ],
    });
    render(<StepDetail step={step} index={0} defaultExpanded />);
    fireEvent.click(screen.getByText("Tools (2)"));
    expect(screen.getByText("read_file")).toBeInTheDocument();
    expect(screen.getByText("write_file")).toBeInTheDocument();
    expect(screen.getByText("OK")).toBeInTheDocument();
    expect(screen.getByText("FAIL")).toBeInTheDocument();
  });

  it("shows tool source badges", () => {
    const step = makeStep({
      toolCalls: [
        makeToolCall({ source: "built-in" }),
        makeToolCall({ toolName: "custom_tool", source: "extension" }),
        makeToolCall({ toolName: "mcp_tool", source: "mcp" }),
      ],
    });
    render(<StepDetail step={step} index={0} defaultExpanded />);
    fireEvent.click(screen.getByText("Tools (3)"));
    expect(screen.getByText("Built-in")).toBeInTheDocument();
    expect(screen.getByText("Extension")).toBeInTheDocument();
    expect(screen.getByText("MCP")).toBeInTheDocument();
  });

  it("shows AUTOPILOT badge for auto-approved tools", () => {
    const step = makeStep({
      toolCalls: [makeToolCall({ autoApproved: true })],
    });
    render(<StepDetail step={step} index={0} defaultExpanded />);
    fireEvent.click(screen.getByText("Tools (1)"));
    expect(screen.getByText("AUTOPILOT")).toBeInTheDocument();
  });

  it("shows DENIED badge for failed tools with error", () => {
    const step = makeStep({
      toolCalls: [makeToolCall({ success: false, error: "Blocked by policy" })],
    });
    render(<StepDetail step={step} index={0} defaultExpanded />);
    fireEvent.click(screen.getByText("Tools (1)"));
    expect(screen.getByText("DENIED")).toBeInTheDocument();
  });

  it("expands tool call row to show details", () => {
    const step = makeStep({
      toolCalls: [makeToolCall({ toolName: "read_file", result: "file contents" })],
    });
    render(<StepDetail step={step} index={0} defaultExpanded />);
    fireEvent.click(screen.getByText("Tools (1)"));
    // Click on tool row to expand
    fireEvent.click(screen.getByText("read_file"));
    expect(screen.getByText("Arguments")).toBeInTheDocument();
    expect(screen.getByText("Result")).toBeInTheDocument();
  });

  it("shows tool error in expanded detail", () => {
    const step = makeStep({
      toolCalls: [makeToolCall({ success: false, error: "File not found" })],
    });
    render(<StepDetail step={step} index={0} defaultExpanded />);
    fireEvent.click(screen.getByText("Tools (1)"));
    fireEvent.click(screen.getByText("read_file"));
    expect(screen.getByText("File not found")).toBeInTheDocument();
  });

  // ---- Debug tab ----
  it("shows debug info in Debug tab", () => {
    render(<StepDetail step={makeStep()} index={0} defaultExpanded />);
    fireEvent.click(screen.getByText("Debug"));
    expect(screen.getAllByText("gpt-4").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("0").length).toBeGreaterThanOrEqual(1); // step index
  });

  it("shows step error in Debug tab", () => {
    render(<StepDetail step={makeStep({ error: "Step execution failed" })} index={0} defaultExpanded />);
    fireEvent.click(screen.getByText("Debug"));
    expect(screen.getByText("Error Details")).toBeInTheDocument();
    expect(screen.getByText("Step execution failed")).toBeInTheDocument();
  });

  it("shows auto-approved count in Debug tab", () => {
    const step = makeStep({
      toolCalls: [
        makeToolCall({ autoApproved: true }),
        makeToolCall({ autoApproved: true }),
        makeToolCall({ autoApproved: false }),
      ],
    });
    render(<StepDetail step={step} index={0} defaultExpanded />);
    fireEvent.click(screen.getByText("Debug"));
    // "Auto-approved Tools" label with value "2"
    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
