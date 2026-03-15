import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  apiPost: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
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

// Mock sub-components used by ChatMessageList -> ChatMessage -> ChatContentBlock
vi.mock("./ChatMessage", () => ({
  ChatMessage: ({ message }: { message: { id: string; role: string; blocks: unknown[] } }) => (
    <div data-testid={`message-${message.id}`}>{message.role}: {message.blocks.length} blocks</div>
  ),
}));

vi.mock("./ChatNewMessageIndicator", () => ({
  ChatNewMessageIndicator: ({ onClick }: { onClick: () => void }) => (
    <button data-testid="new-msg-indicator" onClick={onClick}>New messages</button>
  ),
}));

vi.mock("./ChatToolRound", () => ({
  ChatToolRound: () => <div data-testid="tool-round" />,
  groupToolRounds: (blocks: unknown[]) => blocks,
}));

vi.mock("./ChatContentBlock", () => ({
  ChatContentBlock: ({ block }: { block: { type: string } }) => (
    <div data-testid={`content-block-${block.type}`} />
  ),
}));

vi.mock("./CopyButton", () => ({
  CopyButton: ({ text }: { text: string }) => (
    <button data-testid="copy-button" aria-label="Copy content">{text.slice(0, 10)}</button>
  ),
}));

// react-markdown mock
vi.mock("react-markdown", () => ({
  default: ({ children }: { children: string }) => <div data-testid="markdown">{children}</div>,
}));

vi.mock("remark-gfm", () => ({
  default: {},
}));

// Mock @tanstack/react-virtual
vi.mock("@tanstack/react-virtual", () => ({
  useVirtualizer: () => ({
    getTotalSize: () => 500,
    getVirtualItems: () => [],
    measureElement: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Imports (must be after mocks)
// ---------------------------------------------------------------------------

import { useChatStore } from "../../stores/chat-store";
import type {
  ChatMessage as ChatMessageType,
  FileDiffBlock,
  ToolExecutionBlock,
  SubagentBlock,
  ReasoningBlock,
  TerminalBlock,
  ConfirmationBlock,
  PermissionRequest,
  InputRequest,
  ElicitationRequest,
} from "../../types/chat";

const { ChatMessageList } = await import("./ChatMessageList");
const { ChatElicitationDialog } = await import("./ChatElicitationDialog");
const { ChatFileDiff } = await import("./ChatFileDiff");
const { ChatPermissionDialog } = await import("./ChatPermissionDialog");
const { ChatPermissionBanner } = await import("./ChatPermissionBanner");
const { ChatSubagentBlock } = await import("./ChatSubagentBlock");
const { ChatTextBlock } = await import("./ChatTextBlock");
const { ChatToolExecution } = await import("./ChatToolExecution");
const { ChatReasoningBlock } = await import("./ChatReasoningBlock");
const { ChatTerminalBlock } = await import("./ChatTerminalBlock");
const { ChatSessionList } = await import("./ChatSessionList");
const { ChatContextBar } = await import("./ChatContextBar");
const { ChatModelSelector } = await import("./ChatModelSelector");
const { ChatInputDialog } = await import("./ChatInputDialog");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  useChatStore.setState({
    sessions: [],
    sessionsFetched: true,
    activeSessionId: null,
    models: [{ id: "model-1", name: "Test Model", supportsReasoning: true, supportsVision: false, supportedReasoningEfforts: ["low", "medium", "high"] }],
    selectedModel: "model-1",
    selectedEffort: "medium",
    messages: new Map(),
    isStreaming: false,
    streamingContent: "",
    streamingReasoning: "",
    isUserScrolledUp: false,
    hasNewMessages: false,
    autopilot: false,
    contextWindowPct: 0,
    ttftMs: null,
    bridgeStatus: "ready",
    pendingPermission: null,
    pendingInput: null,
    pendingElicitation: null,
    setUserScrolledUp: vi.fn(),
    scrollToBottom: vi.fn(),
    reviseTo: vi.fn(),
    respondToPermission: vi.fn(),
    respondToInput: vi.fn(),
    respondToElicitation: vi.fn(),
    setAutopilot: vi.fn(),
    setModel: vi.fn(),
    setEffort: vi.fn(),
    deleteSession: vi.fn(),
    renameSession: vi.fn(),
  });
});

// ===========================================================================
// ChatMessageList
// ===========================================================================

describe("ChatMessageList", () => {
  beforeEach(() => {
    // jsdom doesn't implement scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
  });

  it("renders empty when no messages", () => {
    const { container } = render(<ChatMessageList sessionId="s1" />);
    expect(container.querySelector("[aria-hidden]")).toBeTruthy();
  });

  it("renders messages for the given session", () => {
    const msgs: ChatMessageType[] = [
      { id: "m1", role: "user", blocks: [{ type: "text", content: "hello" }], timestamp: "2024-01-01T00:00:00Z", isStreaming: false },
      { id: "m2", role: "assistant", blocks: [{ type: "text", content: "hi" }], timestamp: "2024-01-01T00:00:01Z", isStreaming: false },
    ];
    useChatStore.setState({ messages: new Map([["s1", msgs]]) });
    render(<ChatMessageList sessionId="s1" />);
    expect(screen.getByTestId("message-m1")).toBeTruthy();
    expect(screen.getByTestId("message-m2")).toBeTruthy();
  });
});

// ===========================================================================
// ChatElicitationDialog
// ===========================================================================

describe("ChatElicitationDialog", () => {
  const request: ElicitationRequest = {
    requestId: "elicit-1",
    schema: {
      properties: {
        name: { type: "string", description: "Your name" },
        count: { type: "number" },
        agree: { type: "boolean" },
      },
      required: ["name"],
    },
    message: "Please fill in the form",
  };

  it("renders header with Input Required label", () => {
    render(<ChatElicitationDialog request={request} />);
    expect(screen.getByText("Input Required")).toBeTruthy();
  });

  it("renders message text", () => {
    render(<ChatElicitationDialog request={request} />);
    expect(screen.getByText("Please fill in the form")).toBeTruthy();
  });

  it("renders form fields from schema", () => {
    render(<ChatElicitationDialog request={request} />);
    expect(screen.getByText("name")).toBeTruthy();
    expect(screen.getByText("count")).toBeTruthy();
  });

  it("renders submit button", () => {
    render(<ChatElicitationDialog request={request} />);
    expect(screen.getByText("Submit")).toBeTruthy();
  });

  it("renders enum field as select", () => {
    const enumRequest: ElicitationRequest = {
      requestId: "e2",
      schema: {
        properties: {
          color: { type: "string", enum: ["red", "blue", "green"] },
        },
      },
    };
    render(<ChatElicitationDialog request={enumRequest} />);
    expect(screen.getByText("red")).toBeTruthy();
    expect(screen.getByText("blue")).toBeTruthy();
  });

  it("renders array field with checkboxes", () => {
    const arrayRequest: ElicitationRequest = {
      requestId: "e3",
      schema: {
        properties: {
          fruits: { type: "array", items: { enum: ["apple", "banana"] } },
        },
      },
    };
    render(<ChatElicitationDialog request={arrayRequest} />);
    expect(screen.getByText("apple")).toBeTruthy();
    expect(screen.getByText("banana")).toBeTruthy();
  });
});

// ===========================================================================
// ChatFileDiff
// ===========================================================================

describe("ChatFileDiff", () => {
  it("renders skeleton when isDone is false", () => {
    const block: FileDiffBlock = {
      type: "file-diff",
      fileName: "test.ts",
      diff: "",
      isNewFile: false,
      edits: [],
      isDone: false,
    };
    render(<ChatFileDiff block={block} />);
    expect(screen.getByText(/Editing test.ts/)).toBeTruthy();
  });

  it("renders file name when isDone is true", () => {
    const block: FileDiffBlock = {
      type: "file-diff",
      fileName: "src/app.ts",
      diff: "@@ -1,3 +1,3 @@\n context\n-old\n+new",
      isNewFile: false,
      edits: [],
      isDone: true,
    };
    render(<ChatFileDiff block={block} />);
    expect(screen.getAllByText("src/app.ts").length).toBeGreaterThanOrEqual(1);
  });

  it("shows 'new' badge for new files", () => {
    const block: FileDiffBlock = {
      type: "file-diff",
      fileName: "new-file.ts",
      diff: "",
      newFileContents: "const x = 1;\n",
      isNewFile: true,
      edits: [],
      isDone: true,
    };
    render(<ChatFileDiff block={block} />);
    expect(screen.getByText("new")).toBeTruthy();
  });

  it("renders diff lines", () => {
    const block: FileDiffBlock = {
      type: "file-diff",
      fileName: "test.ts",
      diff: "@@ -1,2 +1,2 @@\n-removed line\n+added line",
      isNewFile: false,
      edits: [],
      isDone: true,
    };
    render(<ChatFileDiff block={block} />);
    expect(screen.getByText("removed line")).toBeTruthy();
    expect(screen.getByText("added line")).toBeTruthy();
  });

  it("renders intention if provided", () => {
    const block: FileDiffBlock = {
      type: "file-diff",
      fileName: "test.ts",
      diff: "@@ -1,1 +1,1 @@\n-old\n+new",
      intention: "Fix the bug",
      isNewFile: false,
      edits: [],
      isDone: true,
    };
    render(<ChatFileDiff block={block} />);
    expect(screen.getByText("Fix the bug")).toBeTruthy();
  });
});

// ===========================================================================
// ChatPermissionDialog
// ===========================================================================

describe("ChatPermissionDialog", () => {
  it("renders pending permission with title and message", () => {
    const block: ConfirmationBlock = {
      type: "confirmation",
      requestId: "req-1",
      title: "Run npm install",
      message: "Execute shell command?",
      permissionKind: "shell",
      status: "pending",
    };
    render(<ChatPermissionDialog block={block} />);
    expect(screen.getByText("Shell Command")).toBeTruthy();
    expect(screen.getByText("Run npm install")).toBeTruthy();
    expect(screen.getByText("Execute shell command?")).toBeTruthy();
  });

  it("renders approve/deny buttons for pending status", () => {
    const block: ConfirmationBlock = {
      type: "confirmation",
      requestId: "req-2",
      title: "Write file",
      message: "Write to test.ts?",
      permissionKind: "write",
      status: "pending",
    };
    render(<ChatPermissionDialog block={block} />);
    expect(screen.getByText("Approve")).toBeTruthy();
    expect(screen.getByText("Deny")).toBeTruthy();
  });

  it("shows Approved badge when status is approved", () => {
    const block: ConfirmationBlock = {
      type: "confirmation",
      requestId: "req-3",
      title: "Read file",
      message: "Read test.ts?",
      permissionKind: "read",
      status: "approved",
    };
    render(<ChatPermissionDialog block={block} />);
    expect(screen.getByText("Approved")).toBeTruthy();
  });

  it("shows Denied badge when status is denied", () => {
    const block: ConfirmationBlock = {
      type: "confirmation",
      requestId: "req-4",
      title: "MCP call",
      message: "Allow?",
      permissionKind: "mcp",
      status: "denied",
    };
    render(<ChatPermissionDialog block={block} />);
    expect(screen.getByText("Denied")).toBeTruthy();
  });
});

// ===========================================================================
// ChatPermissionBanner
// ===========================================================================

describe("ChatPermissionBanner", () => {
  const request: PermissionRequest = {
    requestId: "perm-1",
    title: "Execute command",
    message: "Run test suite?",
    permissionKind: "shell",
  };

  it("renders permission title and message", () => {
    render(<ChatPermissionBanner request={request} />);
    expect(screen.getByText("Execute command")).toBeTruthy();
    expect(screen.getByText("Run test suite?")).toBeTruthy();
  });

  it("renders Allow, Deny, and Allow All buttons", () => {
    render(<ChatPermissionBanner request={request} />);
    expect(screen.getByText("Allow")).toBeTruthy();
    expect(screen.getByText("Deny")).toBeTruthy();
    expect(screen.getByText("Allow All")).toBeTruthy();
  });

  it("shows countdown timer", () => {
    render(<ChatPermissionBanner request={request} />);
    expect(screen.getByText("30s")).toBeTruthy();
  });
});

// ===========================================================================
// ChatSubagentBlock
// ===========================================================================

describe("ChatSubagentBlock", () => {
  it("renders running subagent", () => {
    const block: SubagentBlock = {
      type: "subagent",
      toolCallId: "tc-1",
      agentName: "code-agent",
      agentDisplayName: "Code Agent",
      status: "running",
    };
    render(<ChatSubagentBlock block={block} />);
    expect(screen.getByText("Code Agent")).toBeTruthy();
    expect(screen.getByText("Running")).toBeTruthy();
  });

  it("renders completed subagent", () => {
    const block: SubagentBlock = {
      type: "subagent",
      toolCallId: "tc-2",
      agentName: "code-agent",
      agentDisplayName: "Code Agent",
      status: "complete",
      duration: 5000,
    };
    render(<ChatSubagentBlock block={block} />);
    expect(screen.getByText("Complete")).toBeTruthy();
  });

  it("renders failed subagent with error", () => {
    const block: SubagentBlock = {
      type: "subagent",
      toolCallId: "tc-3",
      agentName: "code-agent",
      agentDisplayName: "Code Agent",
      status: "failed",
      error: "Agent crashed",
    };
    render(<ChatSubagentBlock block={block} />);
    expect(screen.getByText("Failed")).toBeTruthy();
    // Failed subagents start collapsed, need to expand to see error
  });

  it("shows agent description when provided", () => {
    const block: SubagentBlock = {
      type: "subagent",
      toolCallId: "tc-4",
      agentName: "agent",
      agentDisplayName: "My Agent",
      agentDescription: "Helpful assistant",
      status: "running",
    };
    render(<ChatSubagentBlock block={block} />);
    expect(screen.getByText("Helpful assistant")).toBeTruthy();
  });

  it("shows running indicator when no nested blocks", () => {
    const block: SubagentBlock = {
      type: "subagent",
      toolCallId: "tc-5",
      agentName: "agent",
      agentDisplayName: "Agent",
      status: "running",
    };
    render(<ChatSubagentBlock block={block} />);
    expect(screen.getByText("Agent working...")).toBeTruthy();
  });
});

// ===========================================================================
// ChatTextBlock
// ===========================================================================

describe("ChatTextBlock", () => {
  it("renders markdown text content", () => {
    render(<ChatTextBlock content="Hello **world**" />);
    expect(screen.getByTestId("markdown")).toBeTruthy();
    expect(screen.getByText("Hello **world**")).toBeTruthy();
  });
});

// ===========================================================================
// ChatToolExecution
// ===========================================================================

describe("ChatToolExecution", () => {
  it("renders running tool with name", () => {
    const block: ToolExecutionBlock = {
      type: "tool-execution",
      toolCallId: "tc-1",
      roundId: "r-1",
      toolName: "readFile",
      arguments: { path: "/src/app.ts" },
      status: "running",
      isHistorical: false,
    };
    render(<ChatToolExecution block={block} />);
    expect(screen.getByText("readFile")).toBeTruthy();
  });

  it("renders completed tool", () => {
    const block: ToolExecutionBlock = {
      type: "tool-execution",
      toolCallId: "tc-2",
      roundId: "r-1",
      toolName: "writeFile",
      arguments: {},
      status: "complete",
      result: { content: "Done" },
      duration: 1200,
      isHistorical: false,
    };
    render(<ChatToolExecution block={block} />);
    expect(screen.getByText("writeFile")).toBeTruthy();
  });

  it("renders error tool with error message", () => {
    const block: ToolExecutionBlock = {
      type: "tool-execution",
      toolCallId: "tc-3",
      roundId: "r-1",
      toolName: "bash",
      arguments: {},
      status: "error",
      error: "Command not found",
      isHistorical: false,
    };
    render(<ChatToolExecution block={block} />);
    expect(screen.getAllByText("Command not found").length).toBeGreaterThanOrEqual(1);
  });

  it("renders namespaced extension tool with ext badge", () => {
    const block: ToolExecutionBlock = {
      type: "tool-execution",
      toolCallId: "tc-4",
      roundId: "r-1",
      toolName: "myExt__doThing",
      arguments: {},
      status: "running",
      isHistorical: false,
    };
    render(<ChatToolExecution block={block} />);
    expect(screen.getByText("ext")).toBeTruthy();
    expect(screen.getByText("myExt / doThing")).toBeTruthy();
  });

  it("renders MCP server tool name", () => {
    const block: ToolExecutionBlock = {
      type: "tool-execution",
      toolCallId: "tc-5",
      roundId: "r-1",
      toolName: "search",
      mcpServerName: "brave",
      arguments: {},
      status: "complete",
      isHistorical: false,
    };
    render(<ChatToolExecution block={block} />);
    expect(screen.getByText("brave / search")).toBeTruthy();
  });

  it("shows Queued status for pending", () => {
    const block: ToolExecutionBlock = {
      type: "tool-execution",
      toolCallId: "tc-6",
      roundId: "r-1",
      toolName: "tool",
      arguments: {},
      status: "pending",
      isHistorical: false,
    };
    render(<ChatToolExecution block={block} />);
    expect(screen.getByText("Queued...")).toBeTruthy();
  });
});

// ===========================================================================
// ChatReasoningBlock
// ===========================================================================

describe("ChatReasoningBlock", () => {
  it("renders Thinking label", () => {
    const block: ReasoningBlock = {
      type: "reasoning",
      content: "Analyzing the code...",
      collapsed: false,
    };
    render(<ChatReasoningBlock block={block} isStreaming={false} />);
    expect(screen.getByText("Thinking")).toBeTruthy();
  });

  it("shows Thinking... when streaming with no content", () => {
    const block: ReasoningBlock = {
      type: "reasoning",
      content: "",
      collapsed: false,
    };
    render(<ChatReasoningBlock block={block} isStreaming={true} />);
    expect(screen.getByText("Thinking...")).toBeTruthy();
  });

  it("shows token count when provided", () => {
    const block: ReasoningBlock = {
      type: "reasoning",
      content: "thinking...",
      tokens: 1500,
      collapsed: false,
    };
    render(<ChatReasoningBlock block={block} isStreaming={false} />);
    expect(screen.getByText("1,500 tokens")).toBeTruthy();
  });

  it("expands to show content when clicked", async () => {
    const user = userEvent.setup();
    const block: ReasoningBlock = {
      type: "reasoning",
      content: "Deep analysis of the problem",
      collapsed: false,
    };
    render(<ChatReasoningBlock block={block} isStreaming={false} />);
    await user.click(screen.getByText("Thinking"));
    expect(screen.getByText("Deep analysis of the problem")).toBeTruthy();
  });
});

// ===========================================================================
// ChatTerminalBlock
// ===========================================================================

describe("ChatTerminalBlock", () => {
  it("renders terminal text", () => {
    const block: TerminalBlock = {
      type: "terminal",
      text: "npm test\nAll tests passed",
    };
    render(<ChatTerminalBlock block={block} />);
    expect(screen.getByText(/npm test/)).toBeTruthy();
  });

  it("shows cwd when provided", () => {
    const block: TerminalBlock = {
      type: "terminal",
      text: "ls",
      cwd: "/home/user/project",
    };
    render(<ChatTerminalBlock block={block} />);
    expect(screen.getByText("/home/user/project")).toBeTruthy();
  });

  it("shows 'terminal' when no cwd", () => {
    const block: TerminalBlock = {
      type: "terminal",
      text: "hello",
    };
    render(<ChatTerminalBlock block={block} />);
    expect(screen.getByText("terminal")).toBeTruthy();
  });

  it("shows exit code badge", () => {
    const block: TerminalBlock = {
      type: "terminal",
      text: "failed command",
      exitCode: 1,
    };
    render(<ChatTerminalBlock block={block} />);
    expect(screen.getByText("exit 1")).toBeTruthy();
  });

  it("shows green exit code for 0", () => {
    const block: TerminalBlock = {
      type: "terminal",
      text: "success",
      exitCode: 0,
    };
    render(<ChatTerminalBlock block={block} />);
    expect(screen.getByText("exit 0")).toBeTruthy();
  });

  it("has a copy button", () => {
    const block: TerminalBlock = {
      type: "terminal",
      text: "output",
    };
    render(<ChatTerminalBlock block={block} />);
    expect(screen.getByLabelText("Copy terminal output")).toBeTruthy();
  });
});

// ===========================================================================
// ChatSessionList
// ===========================================================================

describe("ChatSessionList", () => {
  it("renders loading skeleton", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/proj-1/chat"]}>
        <ChatSessionList loading={true} />
      </MemoryRouter>,
    );
    // Skeleton components render divs with animate-pulse
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("shows 'No chat sessions yet' when empty", () => {
    useChatStore.setState({ sessions: [] });
    render(
      <MemoryRouter initialEntries={["/proj-1/chat"]}>
        <ChatSessionList loading={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText("No chat sessions yet")).toBeTruthy();
  });

  it("renders New Chat button", () => {
    render(
      <MemoryRouter initialEntries={["/proj-1/chat"]}>
        <ChatSessionList loading={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText("New Chat")).toBeTruthy();
  });

  it("renders session items when sessions exist", () => {
    useChatStore.setState({
      sessions: [
        { id: "s1", projectId: "proj-1", title: "First Chat", model: "model-1", createdAt: "2024-01-01T00:00:00Z", messageCount: 5 },
        { id: "s2", projectId: "proj-1", title: "Second Chat", model: "model-1", createdAt: "2024-01-02T00:00:00Z", messageCount: 3 },
      ],
    });
    render(
      <MemoryRouter initialEntries={["/proj-1/chat"]}>
        <ChatSessionList loading={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText("First Chat")).toBeTruthy();
    expect(screen.getByText("Second Chat")).toBeTruthy();
  });

  it("shows 'New Chat' for sessions without title", () => {
    useChatStore.setState({
      sessions: [
        { id: "s1", projectId: "proj-1", model: "model-1", createdAt: "2024-01-01T00:00:00Z", messageCount: 0 },
      ],
    });
    render(
      <MemoryRouter initialEntries={["/proj-1/chat"]}>
        <ChatSessionList loading={false} />
      </MemoryRouter>,
    );
    // "New Chat" button + "New Chat" session title
    expect(screen.getAllByText("New Chat").length).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// ChatContextBar
// ===========================================================================

describe("ChatContextBar", () => {
  it("renders model name", () => {
    render(<ChatContextBar />);
    expect(screen.getByText("Test Model")).toBeTruthy();
  });

  it("shows reasoning effort when model supports it", () => {
    render(<ChatContextBar />);
    expect(screen.getByText("medium")).toBeTruthy();
  });

  it("shows context window percentage when > 0", () => {
    useChatStore.setState({ contextWindowPct: 42 });
    render(<ChatContextBar />);
    expect(screen.getByText("42%")).toBeTruthy();
  });

  it("does not show context when 0", () => {
    useChatStore.setState({ contextWindowPct: 0 });
    render(<ChatContextBar />);
    expect(screen.queryByText("0%")).toBeNull();
  });
});

// ===========================================================================
// ChatModelSelector
// ===========================================================================

describe("ChatModelSelector", () => {
  it("renders model selector dropdown", () => {
    render(<ChatModelSelector />);
    expect(screen.getByText("Test Model")).toBeTruthy();
  });

  it("renders Autopilot button", () => {
    render(<ChatModelSelector />);
    expect(screen.getByText("Autopilot")).toBeTruthy();
  });

  it("shows skeleton when no models", () => {
    useChatStore.setState({ models: [] });
    const { container } = render(<ChatModelSelector />);
    expect(container.querySelector(".animate-pulse")).toBeTruthy();
  });

  it("shows effort selector when model supports reasoning", () => {
    render(<ChatModelSelector />);
    // effort select should be visible since supportsReasoning: true
    const selects = screen.getAllByRole("combobox");
    expect(selects.length).toBeGreaterThanOrEqual(2);
  });
});

// ===========================================================================
// ChatInputDialog
// ===========================================================================

describe("ChatInputDialog", () => {
  const request: InputRequest = {
    requestId: "input-1",
    prompt: "What is your project name?",
  };

  it("renders question header", () => {
    render(<ChatInputDialog request={request} />);
    expect(screen.getByText("Question")).toBeTruthy();
  });

  it("renders prompt text", () => {
    render(<ChatInputDialog request={request} />);
    expect(screen.getByText("What is your project name?")).toBeTruthy();
  });

  it("renders input field and submit button", () => {
    render(<ChatInputDialog request={request} />);
    expect(screen.getByPlaceholderText("Type your answer...")).toBeTruthy();
    expect(screen.getByText("Submit")).toBeTruthy();
  });

  it("submit button is disabled when input is empty", () => {
    render(<ChatInputDialog request={request} />);
    const submitBtn = screen.getByText("Submit").closest("button");
    expect(submitBtn?.disabled).toBe(true);
  });

  it("allows typing in the input", async () => {
    const user = userEvent.setup();
    render(<ChatInputDialog request={request} />);
    const input = screen.getByPlaceholderText("Type your answer...");
    await user.type(input, "MyProject");
    expect(input).toHaveValue("MyProject");
  });
});
