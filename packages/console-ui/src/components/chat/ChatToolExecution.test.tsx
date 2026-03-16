import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatToolExecution } from "./ChatToolExecution";
import { useChatPreferencesStore } from "../../stores/chat-preferences-store";
import type { ToolExecutionBlock } from "../../types/chat";

function makeBlock(overrides: Partial<ToolExecutionBlock> = {}): ToolExecutionBlock {
  return {
    type: "tool-execution",
    toolCallId: "tc-1",
    roundId: "r-1",
    toolName: "Read",
    arguments: { file_path: "src/index.ts" },
    status: "complete",
    result: { content: "line1\nline2\nline3" },
    duration: 12,
    isHistorical: false,
    ...overrides,
  };
}

describe("ChatToolExecution", () => {
  beforeEach(() => {
    useChatPreferencesStore.setState({ toolDisplayMode: "standard" });
  });

  it("renders in standard mode by default", () => {
    render(<ChatToolExecution block={makeBlock()} />);
    // Standard mode shows the tool name in a header
    expect(screen.getByText("Read")).toBeTruthy();
  });

  it("renders in compact mode", () => {
    useChatPreferencesStore.setState({ toolDisplayMode: "compact" });
    render(<ChatToolExecution block={makeBlock()} />);
    // Compact mode shows the intent string
    expect(screen.getByText(/Read .*index\.ts/)).toBeTruthy();
    // Shows duration
    expect(screen.getByText("12ms")).toBeTruthy();
  });

  it("renders in verbose mode", () => {
    useChatPreferencesStore.setState({ toolDisplayMode: "verbose" });
    render(<ChatToolExecution block={makeBlock()} />);
    // Verbose mode shows the tool name
    expect(screen.getByText("Read")).toBeTruthy();
    // Arguments section should be present and expanded
    expect(screen.getByText("Arguments")).toBeTruthy();
  });

  it("shows error in compact mode", () => {
    useChatPreferencesStore.setState({ toolDisplayMode: "compact" });
    const errorBlock = makeBlock({ status: "error", error: "File not found" });
    delete (errorBlock as Record<string, unknown>).result;
    render(
      <ChatToolExecution block={errorBlock} />,
    );
    expect(screen.getByText("File not found")).toBeTruthy();
  });

  it("shows result summary in compact mode", () => {
    useChatPreferencesStore.setState({ toolDisplayMode: "compact" });
    render(<ChatToolExecution block={makeBlock()} />);
    expect(screen.getByText("3 lines read")).toBeTruthy();
  });
});
