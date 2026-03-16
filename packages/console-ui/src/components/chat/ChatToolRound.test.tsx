import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("../../stores/chat-store", () => ({
  useChatStore: Object.assign(
    vi.fn(() => null),
    { getState: () => ({}), subscribe: vi.fn(), setState: vi.fn() },
  ),
}));

vi.mock("./ChatToolExecution", () => ({
  ChatToolExecution: ({ block }: { block: { toolName: string } }) => (
    <div data-testid="tool-exec">{block.toolName}</div>
  ),
}));

import { groupToolRounds, ChatToolRound } from "./ChatToolRound";
import type { ContentBlock, ToolExecutionBlock, ToolRound } from "../../types/chat";

function toolBlock(name: string, roundId: string, status = "complete"): ToolExecutionBlock {
  return {
    type: "tool-execution",
    toolCallId: `call-${name}`,
    toolName: name,
    roundId,
    status,
    arguments: {},
    isHistorical: false,
  } as ToolExecutionBlock;
}

describe("groupToolRounds", () => {
  it("groups adjacent tool-execution blocks with same roundId", () => {
    const blocks: ContentBlock[] = [
      toolBlock("read", "r1"),
      toolBlock("write", "r1"),
    ];
    const result = groupToolRounds(blocks);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("tool-round");
    expect((result[0] as ToolRound).tools).toHaveLength(2);
  });

  it("creates separate rounds for different roundIds", () => {
    const blocks: ContentBlock[] = [
      toolBlock("read", "r1"),
      toolBlock("write", "r2"),
    ];
    const result = groupToolRounds(blocks);
    expect(result).toHaveLength(2);
    expect((result[0] as ToolRound).tools).toHaveLength(1);
    expect((result[1] as ToolRound).tools).toHaveLength(1);
  });

  it("preserves non-tool blocks between rounds", () => {
    const blocks: ContentBlock[] = [
      toolBlock("read", "r1"),
      { type: "text", content: "hello" } as ContentBlock,
      toolBlock("write", "r2"),
    ];
    const result = groupToolRounds(blocks);
    expect(result).toHaveLength(3);
    expect(result[0]!.type).toBe("tool-round");
    expect(result[1]!.type).toBe("text");
    expect(result[2]!.type).toBe("tool-round");
  });

  it("returns empty array for empty input", () => {
    expect(groupToolRounds([])).toHaveLength(0);
  });

  it("wraps single tool as tool-round", () => {
    const blocks: ContentBlock[] = [toolBlock("read", "r1")];
    const result = groupToolRounds(blocks);
    expect(result).toHaveLength(1);
    expect(result[0]!.type).toBe("tool-round");
    expect((result[0] as ToolRound).tools).toHaveLength(1);
  });

  it("handles mixed block types", () => {
    const blocks: ContentBlock[] = [
      { type: "text", content: "start" } as ContentBlock,
      toolBlock("a", "r1"),
      toolBlock("b", "r1"),
      { type: "reasoning", content: "thinking" } as ContentBlock,
      toolBlock("c", "r2"),
      { type: "text", content: "end" } as ContentBlock,
    ];
    const result = groupToolRounds(blocks);
    expect(result).toHaveLength(5);
    expect(result[0]!.type).toBe("text");
    expect(result[1]!.type).toBe("tool-round");
    expect((result[1] as ToolRound).tools).toHaveLength(2);
    expect(result[2]!.type).toBe("reasoning");
    expect(result[3]!.type).toBe("tool-round");
    expect(result[4]!.type).toBe("text");
  });
});

describe("ChatToolRound", () => {
  it("renders single tool directly", () => {
    const round: ToolRound = {
      type: "tool-round",
      roundId: "r1",
      tools: [toolBlock("read", "r1")],
    };
    render(<ChatToolRound round={round} />);
    expect(screen.getByText("read")).toBeTruthy();
  });

  it("renders multi-tool round with header", () => {
    const round: ToolRound = {
      type: "tool-round",
      roundId: "r1",
      tools: [toolBlock("read", "r1"), toolBlock("write", "r1")],
    };
    render(<ChatToolRound round={round} />);
    expect(screen.getByText("Ran 2 tools")).toBeTruthy();
    expect(screen.getByText("2/2 complete")).toBeTruthy();
  });

  it("shows running header when tools are active", () => {
    const round: ToolRound = {
      type: "tool-round",
      roundId: "r1",
      tools: [toolBlock("read", "r1", "running"), toolBlock("write", "r1", "pending")],
    };
    render(<ChatToolRound round={round} />);
    expect(screen.getByText("Running 2 tools")).toBeTruthy();
  });

  it("toggles expansion on multi-tool round", () => {
    const round: ToolRound = {
      type: "tool-round",
      roundId: "r1",
      tools: [toolBlock("read", "r1"), toolBlock("write", "r1")],
    };
    render(<ChatToolRound round={round} />);
    expect(screen.getAllByTestId("tool-exec")).toHaveLength(2);
    fireEvent.click(screen.getByText("Ran 2 tools"));
    expect(screen.queryAllByTestId("tool-exec")).toHaveLength(0);
  });
});
