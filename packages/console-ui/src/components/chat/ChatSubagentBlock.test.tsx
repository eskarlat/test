import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../stores/chat-store", () => ({
  useChatStore: Object.assign(
    vi.fn(() => null),
    { getState: () => ({}), subscribe: vi.fn(), setState: vi.fn() },
  ),
}));

vi.mock("./ChatContentBlock", () => ({
  ChatContentBlock: ({ block }: { block: { type: string } }) => (
    <div data-testid="nested-block">{block.type}</div>
  ),
}));

import { ChatSubagentBlock } from "./ChatSubagentBlock";
import type { SubagentBlock } from "../../types/chat";

function createBlock(overrides: Partial<SubagentBlock> = {}): SubagentBlock {
  return {
    type: "subagent",
    agentId: "agent-1",
    agentDisplayName: "Research Agent",
    status: "running",
    ...overrides,
  } as SubagentBlock;
}

describe("ChatSubagentBlock", () => {
  it("renders running agent with name and status", () => {
    render(<ChatSubagentBlock block={createBlock()} />);
    expect(screen.getByText("Research Agent")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
    expect(screen.getByText("Agent working...")).toBeTruthy();
  });

  it("renders complete agent with status badge", () => {
    render(<ChatSubagentBlock block={createBlock({ status: "complete", duration: 5000 })} />);
    expect(screen.getByText("Complete")).toBeTruthy();
    expect(screen.getByText("5.0s")).toBeTruthy();
  });

  it("renders failed agent with error message", () => {
    render(<ChatSubagentBlock block={createBlock({ status: "failed", error: "Timeout exceeded" })} />);
    expect(screen.getByText("Failed")).toBeTruthy();
    // Failed agents start collapsed
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Timeout exceeded")).toBeTruthy();
  });

  it("shows description when provided", () => {
    render(<ChatSubagentBlock block={createBlock({ agentDescription: "Searching codebase" })} />);
    expect(screen.getByText("Searching codebase")).toBeTruthy();
  });

  it("toggles expansion on click", () => {
    render(<ChatSubagentBlock block={createBlock()} />);
    expect(screen.getByText("Agent working...")).toBeTruthy();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.queryByText("Agent working...")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Agent working...")).toBeTruthy();
  });

  it("renders nested blocks when expanded", () => {
    const block = createBlock({
      nestedBlocks: [
        { type: "text", content: "nested text" } as any,
      ],
    });
    render(<ChatSubagentBlock block={block} />);
    expect(screen.getByTestId("nested-block")).toBeTruthy();
  });

  it("starts collapsed when finished (complete)", () => {
    render(<ChatSubagentBlock block={createBlock({ status: "complete" })} />);
    // Complete agents start collapsed, so body should not be visible
    // The "Agent working..." text should not appear because it's collapsed
    expect(screen.queryByText("Agent working...")).toBeNull();
  });
});
