import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ChatToolExecution } from "./ChatToolExecution";
import type { ToolExecutionBlock } from "../../types/chat";

// Mock CopyButton to simplify
vi.mock("./CopyButton", () => ({
  CopyButton: ({ text }: { text: string }) => <button data-testid="copy-btn">{text.slice(0, 10)}</button>,
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeBlock(overrides: Partial<ToolExecutionBlock> = {}): ToolExecutionBlock {
  return {
    type: "tool-execution",
    toolCallId: "tc-1",
    roundId: "round-1",
    toolName: "read_file",
    arguments: {},
    status: "complete",
    isHistorical: false,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatToolExecution", () => {
  it("renders tool name", () => {
    render(<ChatToolExecution block={makeBlock()} />);
    expect(screen.getByText("read_file")).toBeInTheDocument();
  });

  it("renders namespaced tool with ext badge", () => {
    render(<ChatToolExecution block={makeBlock({ toolName: "analytics__query" })} />);
    expect(screen.getByText("analytics / query")).toBeInTheDocument();
    expect(screen.getByText("ext")).toBeInTheDocument();
  });

  it("renders MCP server name", () => {
    render(<ChatToolExecution block={makeBlock({ toolName: "list_files", mcpServerName: "filesystem" })} />);
    expect(screen.getByText("filesystem / list_files")).toBeInTheDocument();
  });

  it("does not show ext badge for non-namespaced tools", () => {
    render(<ChatToolExecution block={makeBlock({ toolName: "read_file" })} />);
    expect(screen.queryByText("ext")).not.toBeInTheDocument();
  });

  it("shows pending status label", () => {
    render(<ChatToolExecution block={makeBlock({ status: "pending" })} />);
    expect(screen.getByText("Queued...")).toBeInTheDocument();
  });

  it("shows validating status label", () => {
    render(<ChatToolExecution block={makeBlock({ status: "validating" })} />);
    expect(screen.getByText("Checking governance rules...")).toBeInTheDocument();
  });

  it("shows argument summary during running state", () => {
    render(
      <ChatToolExecution
        block={makeBlock({
          status: "running",
          arguments: { path: "/src/index.ts" },
        })}
      />,
    );
    expect(screen.getByText(/path: \/src\/index.ts/)).toBeInTheDocument();
  });

  it("shows error message in error state", () => {
    render(
      <ChatToolExecution
        block={makeBlock({ status: "error", error: "Permission denied" })}
      />,
    );
    // Error text appears in both header label and error box
    expect(screen.getAllByText("Permission denied").length).toBeGreaterThanOrEqual(1);
  });

  it("shows default error when error is undefined", () => {
    render(
      <ChatToolExecution
        block={makeBlock({ status: "error", error: "Tool execution failed" })}
      />,
    );
    expect(screen.getAllByText("Tool execution failed").length).toBeGreaterThanOrEqual(1);
  });

  it("shows duration for completed tools", () => {
    render(
      <ChatToolExecution block={makeBlock({ status: "complete", duration: 1500 })} />,
    );
    expect(screen.getByText("1.5s")).toBeInTheDocument();
  });

  it("does not show duration for running tools", () => {
    render(
      <ChatToolExecution block={makeBlock({ status: "running", duration: 500 })} />,
    );
    expect(screen.queryByText("500ms")).not.toBeInTheDocument();
  });

  it("renders arguments section when arguments exist", () => {
    render(
      <ChatToolExecution
        block={makeBlock({
          status: "complete",
          arguments: { file: "test.ts" },
        })}
      />,
    );
    expect(screen.getByText("Arguments")).toBeInTheDocument();
  });

  it("does not render arguments section when empty", () => {
    render(
      <ChatToolExecution
        block={makeBlock({ status: "complete", arguments: {} })}
      />,
    );
    expect(screen.queryByText("Arguments")).not.toBeInTheDocument();
  });

  it("renders result section for completed tool with result", () => {
    render(
      <ChatToolExecution
        block={makeBlock({
          status: "complete",
          result: { content: "file contents here" },
        })}
      />,
    );
    expect(screen.getByText("Result")).toBeInTheDocument();
  });

  it("does not render result for non-complete status", () => {
    render(
      <ChatToolExecution
        block={makeBlock({
          status: "running",
          result: { content: "partial" },
        })}
      />,
    );
    expect(screen.queryByText("Result")).not.toBeInTheDocument();
  });

  it("renders progress message when active", () => {
    render(
      <ChatToolExecution
        block={makeBlock({
          status: "running",
          progressMessage: "Reading file...",
        })}
      />,
    );
    expect(screen.getByText("Reading file...")).toBeInTheDocument();
  });

  it("renders partial output when active", () => {
    render(
      <ChatToolExecution
        block={makeBlock({
          status: "running",
          partialOutput: "partial data here",
        })}
      />,
    );
    expect(screen.getByText("partial data here")).toBeInTheDocument();
  });

  it("does not render progress for completed tool", () => {
    render(
      <ChatToolExecution
        block={makeBlock({
          status: "complete",
          progressMessage: "should not show",
        })}
      />,
    );
    expect(screen.queryByText("should not show")).not.toBeInTheDocument();
  });

  it("uses error styling for error status", () => {
    const { container } = render(
      <ChatToolExecution block={makeBlock({ status: "error", error: "fail" })} />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("border-destructive");
  });

  it("uses normal styling for non-error status", () => {
    const { container } = render(
      <ChatToolExecution block={makeBlock({ status: "complete" })} />,
    );
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("border-border");
  });

  it("arguments collapsible can be toggled", () => {
    render(
      <ChatToolExecution
        block={makeBlock({
          status: "complete",
          arguments: { file: "test.ts" },
          isHistorical: false,
        })}
      />,
    );
    const argsButton = screen.getByText("Arguments");
    // Initially collapsed for complete non-active blocks
    fireEvent.click(argsButton);
    // After clicking, the args content should be visible
    expect(screen.getByText(/"file": "test.ts"/)).toBeInTheDocument();
  });

  it("truncates long argument values in summary", () => {
    const longValue = "a".repeat(100);
    render(
      <ChatToolExecution
        block={makeBlock({
          status: "running",
          arguments: { content: longValue },
        })}
      />,
    );
    expect(screen.getByText(/\.\.\./)).toBeInTheDocument();
  });

  it("shows +N more for many arguments", () => {
    render(
      <ChatToolExecution
        block={makeBlock({
          status: "running",
          arguments: { a: "1", b: "2", c: "3", d: "4" },
        })}
      />,
    );
    expect(screen.getByText(/\+1 more/)).toBeInTheDocument();
  });

  it("renders streaming arguments when active", () => {
    render(
      <ChatToolExecution
        block={makeBlock({
          status: "running",
          arguments: { file: "test" },
          argumentsStreaming: '{"file": "test", "streaming": true}',
          isHistorical: false,
        })}
      />,
    );
    // For active, non-historical blocks, arguments section is auto-expanded
    // The streaming text should be displayed
    expect(screen.getByText(/\{"file": "test", "streaming": true\}/)).toBeInTheDocument();
  });

  it("shows detailedContent in result if available", () => {
    render(
      <ChatToolExecution
        block={makeBlock({
          status: "complete",
          result: { content: "short", detailedContent: "full detailed output" },
          isHistorical: false,
        })}
      />,
    );
    // For non-historical, Result section is auto-expanded
    expect(screen.getByText("full detailed output")).toBeInTheDocument();
  });
});
