import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";

const mockEmit = vi.fn();

vi.mock("../../api/socket", () => ({
  useSocketStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({ socket: { emit: mockEmit } }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

vi.mock("./ChatFileDiff", () => ({
  ChatFileDiff: ({ block }: { block: { fileName: string } }) => (
    <div data-testid="file-diff">{block.fileName}</div>
  ),
}));

import { ChatPermissionDialog } from "./ChatPermissionDialog";
import type { ConfirmationBlock } from "../../types/chat";

function createBlock(overrides: Partial<ConfirmationBlock> = {}): ConfirmationBlock {
  return {
    type: "confirmation",
    requestId: "req-1",
    permissionKind: "shell",
    title: "Run: npm test",
    message: "Execute npm test in project directory",
    status: "pending",
    ...overrides,
  } as ConfirmationBlock;
}

describe("ChatPermissionDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  it("renders pending permission with approve/deny buttons", () => {
    render(<ChatPermissionDialog block={createBlock()} />);
    expect(screen.getByText("Shell Command")).toBeTruthy();
    expect(screen.getByText("Run: npm test")).toBeTruthy();
    expect(screen.getByText("Execute npm test in project directory")).toBeTruthy();
    expect(screen.getByText("Approve")).toBeTruthy();
    expect(screen.getByText("Deny")).toBeTruthy();
  });

  it("shows approved state badge", () => {
    render(<ChatPermissionDialog block={createBlock({ status: "approved" })} />);
    expect(screen.getByText("Approved")).toBeTruthy();
    expect(screen.queryByText("Approve")).toBeNull();
    expect(screen.queryByText("Deny")).toBeNull();
  });

  it("shows denied state badge", () => {
    render(<ChatPermissionDialog block={createBlock({ status: "denied" })} />);
    expect(screen.getByText("Denied")).toBeTruthy();
  });

  it("emits approve decision on Approve click", () => {
    render(<ChatPermissionDialog block={createBlock()} />);
    fireEvent.click(screen.getByText("Approve"));
    expect(mockEmit).toHaveBeenCalledWith("chat:permission", {
      requestId: "req-1",
      decision: { kind: "approved" },
    });
  });

  it("emits deny decision on Deny click", () => {
    render(<ChatPermissionDialog block={createBlock()} />);
    fireEvent.click(screen.getByText("Deny"));
    expect(mockEmit).toHaveBeenCalledWith("chat:permission", {
      requestId: "req-1",
      decision: { kind: "denied-interactively-by-user" },
    });
  });

  it("shows countdown timer", () => {
    render(<ChatPermissionDialog block={createBlock()} />);
    expect(screen.getByText("30s")).toBeTruthy();
    act(() => { vi.advanceTimersByTime(1000); });
    expect(screen.getByText("29s")).toBeTruthy();
  });

  it("renders correct permission kind labels", () => {
    const { rerender } = render(<ChatPermissionDialog block={createBlock({ permissionKind: "write" })} />);
    expect(screen.getByText("Write File")).toBeTruthy();

    rerender(<ChatPermissionDialog block={createBlock({ permissionKind: "read" })} />);
    expect(screen.getByText("Read File")).toBeTruthy();

    rerender(<ChatPermissionDialog block={createBlock({ permissionKind: "mcp" })} />);
    expect(screen.getByText("MCP Tool")).toBeTruthy();
  });

  it("shows file diff for write permissions", () => {
    const block = createBlock({
      permissionKind: "write",
      title: "test.ts",
      diff: "--- a/test.ts\n+++ b/test.ts\n@@ -1 +1 @@\n-old\n+new",
    });
    render(<ChatPermissionDialog block={block} />);
    expect(screen.getByTestId("file-diff")).toBeTruthy();
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
