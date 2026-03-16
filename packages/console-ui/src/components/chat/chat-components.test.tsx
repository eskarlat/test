import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// ---------------------------------------------------------------------------
// Mocks — must be declared before imports that use them
// ---------------------------------------------------------------------------

// Mock stores
const mockChatStoreState: Record<string, unknown> = {
  bridgeStatus: "ready",
  bridgeError: null,
  isStreaming: false,
  activeSessionId: "session-1",
  selectedModel: "model-1",
  models: [{ id: "model-1", name: "Test Model", supportsReasoning: false, supportsVision: false }],
  revisionDraft: null,
  sendMessage: vi.fn(),
  cancelGeneration: vi.fn(),
  checkBridgeStatus: vi.fn(),
  createSession: vi.fn(),
  pendingInitialMessage: null,
};

vi.mock("../../stores/chat-store", () => ({
  useChatStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockChatStoreState),
    { setState: vi.fn(), getState: () => mockChatStoreState },
  ),
}));

// Mock react-router (used by ChatEmptyState)
const mockNavigate = vi.fn();
vi.mock("react-router", () => ({
  useParams: () => ({ projectId: "proj-1" }),
  useNavigate: () => mockNavigate,
}));

// Mock child components used by ChatContentBlock to keep tests focused
vi.mock("./ChatTextBlock", () => ({
  ChatTextBlock: ({ content }: { content: string }) => <div data-testid="text-block">{content}</div>,
}));
vi.mock("./ChatReasoningBlock", () => ({
  ChatReasoningBlock: () => <div data-testid="reasoning-block" />,
}));
vi.mock("./ChatToolExecution", () => ({
  ChatToolExecution: () => <div data-testid="tool-execution-block" />,
}));
vi.mock("./ChatSubagentBlock", () => ({
  ChatSubagentBlock: () => <div data-testid="subagent-block" />,
}));
vi.mock("./ChatFileDiff", () => ({
  ChatFileDiff: () => <div data-testid="file-diff-block" />,
}));
vi.mock("./ChatPermissionDialog", () => ({
  ChatPermissionDialog: () => <div data-testid="confirmation-block" />,
}));
vi.mock("./ChatTerminalBlock", () => ({
  ChatTerminalBlock: () => <div data-testid="terminal-block" />,
}));
vi.mock("./ChatModelSelector", () => ({
  ChatModelSelector: () => <div data-testid="model-selector" />,
}));

// Clipboard is handled by jsdom; tests verify UI state change after copy click

// ---------------------------------------------------------------------------
// Imports
// ---------------------------------------------------------------------------

import { ChatCodeBlock } from "./ChatCodeBlock";
import { ChatCompactionNotice } from "./ChatCompactionNotice";
import { ChatContentBlock } from "./ChatContentBlock";
import { ChatMessage } from "./ChatMessage";
import { ChatInput } from "./ChatInput";
import { ChatEmptyState } from "./ChatEmptyState";
import { CopyButton } from "./CopyButton";
import { ChatNewMessageIndicator } from "./ChatNewMessageIndicator";
import { ChatProgressIndicator } from "./ChatProgressIndicator";
import { ChatAttachmentPreview } from "./ChatAttachmentPreview";
import type { CompactionBlock, ContentBlock as ContentBlockType, ChatMessage as ChatMessageType, Attachment } from "../../types/chat";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Reset store state
  mockChatStoreState.bridgeStatus = "ready";
  mockChatStoreState.bridgeError = null;
  mockChatStoreState.isStreaming = false;
  mockChatStoreState.activeSessionId = "session-1";
  mockChatStoreState.selectedModel = "model-1";
  mockChatStoreState.models = [{ id: "model-1", name: "Test Model", supportsReasoning: false, supportsVision: false }];
  mockChatStoreState.revisionDraft = null;
});

// ===== ChatCodeBlock =====
describe("ChatCodeBlock", () => {
  it("renders code and language label", () => {
    render(<ChatCodeBlock language="typescript" code="const x = 1;" />);
    expect(screen.getByText("typescript")).toBeInTheDocument();
    expect(screen.getByText("const x = 1;")).toBeInTheDocument();
  });

  it("shows 'plain' when language is empty", () => {
    render(<ChatCodeBlock language="" code="hello" />);
    expect(screen.getByText("plain")).toBeInTheDocument();
  });

  it("shows line numbers when code exceeds 10 lines", () => {
    const code = Array.from({ length: 12 }, (_, i) => `line ${i + 1}`).join("\n");
    render(<ChatCodeBlock language="text" code={code} />);
    // Line number 1 should appear
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("does not show line numbers for short code", () => {
    render(<ChatCodeBlock language="js" code="short" />);
    expect(screen.queryByText("1")).not.toBeInTheDocument();
  });

  it("has a copy button", () => {
    render(<ChatCodeBlock language="js" code="x" />);
    expect(screen.getByLabelText("Copy code")).toBeInTheDocument();
  });

  it("copies to clipboard on click and shows check icon", async () => {
    const user = userEvent.setup();
    render(<ChatCodeBlock language="js" code="copy me" />);
    await user.click(screen.getByLabelText("Copy code"));
    // After clicking, the component shows Check icon (copied state)
    await waitFor(() => {
      const btn = screen.getByLabelText("Copy code");
      // The Check icon has the text-green-500 class
      expect(btn.querySelector(".text-green-500")).toBeInTheDocument();
    });
  });
});

// ===== ChatCompactionNotice =====
describe("ChatCompactionNotice", () => {
  it("shows spinner when compaction is in progress", () => {
    const block: CompactionBlock = { type: "compaction", tokensRemoved: 0 };
    render(<ChatCompactionNotice block={block} />);
    expect(screen.getByText("Compacting conversation history...")).toBeInTheDocument();
  });

  it("shows token count when compaction is done", () => {
    const block: CompactionBlock = { type: "compaction", tokensRemoved: 1500 };
    render(<ChatCompactionNotice block={block} />);
    expect(screen.getByText(/1,500 tokens/)).toBeInTheDocument();
  });

  it("shows summary when provided", () => {
    const block: CompactionBlock = { type: "compaction", tokensRemoved: 500, summary: "Summarized context" };
    render(<ChatCompactionNotice block={block} />);
    expect(screen.getByText(/Summarized context/)).toBeInTheDocument();
  });
});

// ===== ChatContentBlock =====
describe("ChatContentBlock", () => {
  it("renders text block", () => {
    const block: ContentBlockType = { type: "text", content: "Hello world" };
    render(<ChatContentBlock block={block} isStreaming={false} />);
    expect(screen.getByTestId("text-block")).toHaveTextContent("Hello world");
  });

  it("renders reasoning block", () => {
    const block: ContentBlockType = { type: "reasoning", content: "thinking...", collapsed: false };
    render(<ChatContentBlock block={block} isStreaming={false} />);
    expect(screen.getByTestId("reasoning-block")).toBeInTheDocument();
  });

  it("renders warning block", () => {
    const block: ContentBlockType = { type: "warning", message: "Watch out!" };
    render(<ChatContentBlock block={block} isStreaming={false} />);
    expect(screen.getByText("Watch out!")).toBeInTheDocument();
  });

  it("renders image block", () => {
    const block: ContentBlockType = { type: "image", data: "abc123", mimeType: "image/png" };
    render(<ChatContentBlock block={block} isStreaming={false} />);
    const img = screen.getByAltText("Chat image");
    expect(img).toBeInTheDocument();
    expect(img).toHaveAttribute("src", "data:image/png;base64,abc123");
  });

  it("renders image block with custom alt", () => {
    const block: ContentBlockType = { type: "image", data: "x", mimeType: "image/jpeg", alt: "Custom alt" };
    render(<ChatContentBlock block={block} isStreaming={false} />);
    expect(screen.getByAltText("Custom alt")).toBeInTheDocument();
  });

  it("renders progress block", () => {
    const block: ContentBlockType = { type: "progress", message: "Loading..." };
    render(<ChatContentBlock block={block} isStreaming={false} />);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("renders compaction block", () => {
    const block: ContentBlockType = { type: "compaction", tokensRemoved: 200 };
    render(<ChatContentBlock block={block} isStreaming={false} />);
    expect(screen.getByText(/200 tokens/)).toBeInTheDocument();
  });

  it("renders unknown block type gracefully", () => {
    const block = { type: "some-future-type", data: "stuff" } as unknown as ContentBlockType;
    render(<ChatContentBlock block={block} isStreaming={false} />);
    expect(screen.getByText("some-future-type")).toBeInTheDocument();
  });
});

// ===== ChatMessage =====
describe("ChatMessage", () => {
  function makeMessage(overrides: Partial<ChatMessageType> = {}): ChatMessageType {
    return {
      id: "msg-1",
      role: "assistant",
      blocks: [{ type: "text", content: "Hello" }],
      timestamp: new Date().toISOString(),
      isStreaming: false,
      ...overrides,
    };
  }

  it("renders an assistant message", () => {
    render(<ChatMessage message={makeMessage()} onRevise={undefined} />);
    expect(screen.getByTestId("text-block")).toHaveTextContent("Hello");
  });

  it("renders a user message", () => {
    render(<ChatMessage message={makeMessage({ role: "user" })} onRevise={undefined} />);
    expect(screen.getByTestId("text-block")).toBeInTheDocument();
  });

  it("shows streaming cursor when isStreaming", () => {
    const { container } = render(
      <ChatMessage message={makeMessage({ isStreaming: true })} onRevise={undefined} />,
    );
    expect(container.querySelector(".animate-pulse")).toBeInTheDocument();
  });

  it("renders attachment chips when attachments present", () => {
    const attachments: Attachment[] = [
      { type: "file", path: "/src/index.ts", displayName: "index.ts" },
    ];
    render(<ChatMessage message={makeMessage({ role: "user", attachments })} onRevise={undefined} />);
    // The emoji and text are separate text nodes, so use a function matcher
    expect(screen.getByText((_content, el) => el?.textContent?.includes("index.ts") === true && el?.tagName === "SPAN")).toBeInTheDocument();
  });

  it("shows edit button for user messages with onRevise", () => {
    const onRevise = vi.fn();
    render(<ChatMessage message={makeMessage({ role: "user" })} onRevise={onRevise} />);
    expect(screen.getByLabelText("Edit message")).toBeInTheDocument();
  });

  it("does not show edit button for assistant messages", () => {
    render(<ChatMessage message={makeMessage({ role: "assistant" })} onRevise={vi.fn()} />);
    expect(screen.queryByLabelText("Edit message")).not.toBeInTheDocument();
  });
});

// ===== ChatInput =====
describe("ChatInput", () => {
  it("renders textarea with placeholder", () => {
    render(<ChatInput />);
    expect(screen.getByPlaceholderText("Type a message...")).toBeInTheDocument();
  });

  it("shows disabled placeholder when not ready", () => {
    mockChatStoreState.bridgeStatus = "unavailable";
    render(<ChatInput />);
    expect(screen.getByPlaceholderText("Chat not available")).toBeInTheDocument();
  });

  it("renders send button", () => {
    render(<ChatInput />);
    expect(screen.getByLabelText("Send message")).toBeInTheDocument();
  });

  it("renders stop button when streaming", () => {
    mockChatStoreState.isStreaming = true;
    render(<ChatInput />);
    expect(screen.getByLabelText("Stop generation")).toBeInTheDocument();
  });

  it("typing updates textarea value", async () => {
    const user = userEvent.setup();
    render(<ChatInput />);
    const textarea = screen.getByPlaceholderText("Type a message...");
    await user.type(textarea, "hello");
    expect(textarea).toHaveValue("hello");
  });
});

// ===== ChatEmptyState =====
describe("ChatEmptyState", () => {
  it("shows session error when provided", () => {
    render(<ChatEmptyState sessionError="Something went wrong" />);
    expect(screen.getByText("Session Error")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
  });

  it("shows unavailable state", () => {
    mockChatStoreState.bridgeStatus = "unavailable";
    render(<ChatEmptyState sessionError={undefined} />);
    expect(screen.getByText("Copilot CLI Required")).toBeInTheDocument();
  });

  it("shows auth error state", () => {
    mockChatStoreState.bridgeStatus = "error";
    mockChatStoreState.bridgeError = "auth token expired";
    render(<ChatEmptyState sessionError={undefined} />);
    expect(screen.getByText("GitHub Authentication Required")).toBeInTheDocument();
  });

  it("shows non-auth error state", () => {
    mockChatStoreState.bridgeStatus = "error";
    mockChatStoreState.bridgeError = "connection refused";
    render(<ChatEmptyState sessionError={undefined} />);
    expect(screen.getByText("Connection Error")).toBeInTheDocument();
    expect(screen.getByText("connection refused")).toBeInTheDocument();
  });

  it("shows starting state", () => {
    mockChatStoreState.bridgeStatus = "starting";
    render(<ChatEmptyState sessionError={undefined} />);
    expect(screen.getByText("Connecting to Copilot...")).toBeInTheDocument();
  });

  it("shows ready state with hero", () => {
    mockChatStoreState.bridgeStatus = "ready";
    render(<ChatEmptyState sessionError={undefined} />);
    expect(screen.getByText("What can I help you with?")).toBeInTheDocument();
  });

  it("renders suggestion chips in ready state", () => {
    mockChatStoreState.bridgeStatus = "ready";
    render(<ChatEmptyState sessionError={undefined} />);
    expect(screen.getByText("Explain this codebase")).toBeInTheDocument();
    expect(screen.getByText("Debug an issue")).toBeInTheDocument();
  });
});

// ===== CopyButton =====
describe("CopyButton", () => {
  it("renders with default label", () => {
    render(<CopyButton text="hello" />);
    expect(screen.getByLabelText("Copy content")).toBeInTheDocument();
  });

  it("renders with custom label", () => {
    render(<CopyButton text="hello" label="Copy snippet" />);
    expect(screen.getByLabelText("Copy snippet")).toBeInTheDocument();
  });

  it("shows check icon after click (copied state)", async () => {
    const user = userEvent.setup();
    render(<CopyButton text="copy this" />);
    await user.click(screen.getByLabelText("Copy content"));
    // After clicking, the component switches to the Check icon with text-green-500
    await waitFor(() => {
      const btn = screen.getByLabelText("Copy content");
      expect(btn.querySelector(".text-green-500")).toBeInTheDocument();
    });
  });
});

// ===== ChatNewMessageIndicator =====
describe("ChatNewMessageIndicator", () => {
  it("renders button with text", () => {
    render(<ChatNewMessageIndicator onClick={vi.fn()} />);
    expect(screen.getByText("New messages")).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<ChatNewMessageIndicator onClick={onClick} />);
    await user.click(screen.getByText("New messages"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});

// ===== ChatProgressIndicator =====
describe("ChatProgressIndicator", () => {
  it("renders progress message", () => {
    render(<ChatProgressIndicator message="Analyzing code..." />);
    expect(screen.getByText("Analyzing code...")).toBeInTheDocument();
  });

  it("renders animated dots", () => {
    const { container } = render(<ChatProgressIndicator message="Working" />);
    const dots = container.querySelectorAll(".animate-bounce");
    expect(dots.length).toBe(3);
  });
});

// ===== ChatAttachmentPreview =====
describe("ChatAttachmentPreview", () => {
  it("returns null for empty attachments", () => {
    const { container } = render(<ChatAttachmentPreview attachments={[]} />);
    expect(container.innerHTML).toBe("");
  });

  it("renders file attachment", () => {
    const attachments: Attachment[] = [
      { type: "file", path: "/src/main.ts", displayName: "main.ts" },
    ];
    render(<ChatAttachmentPreview attachments={attachments} />);
    expect(screen.getByText("main.ts")).toBeInTheDocument();
  });

  it("renders directory attachment", () => {
    const attachments: Attachment[] = [
      { type: "directory", path: "/src/components/", displayName: "components" },
    ];
    render(<ChatAttachmentPreview attachments={attachments} />);
    expect(screen.getByText("components")).toBeInTheDocument();
  });

  it("renders selection attachment", () => {
    const attachments: Attachment[] = [
      {
        type: "selection",
        filePath: "/src/app.ts",
        text: "selected code",
        selection: {
          start: { line: 10, character: 0 },
          end: { line: 20, character: 0 },
        },
      },
    ];
    render(<ChatAttachmentPreview attachments={attachments} />);
    expect(screen.getByText("app.ts:10-20")).toBeInTheDocument();
  });

  it("uses displayName over computed name for file", () => {
    const attachments: Attachment[] = [
      { type: "file", path: "/very/long/path/to/file.ts", displayName: "MyFile" },
    ];
    render(<ChatAttachmentPreview attachments={attachments} />);
    expect(screen.getByText("MyFile")).toBeInTheDocument();
  });

  it("derives file name from path when no displayName", () => {
    const attachments: Attachment[] = [
      { type: "file", path: "/src/utils/helper.ts" },
    ];
    render(<ChatAttachmentPreview attachments={attachments} />);
    expect(screen.getByText("helper.ts")).toBeInTheDocument();
  });

  it("renders multiple attachments", () => {
    const attachments: Attachment[] = [
      { type: "file", path: "/a.ts", displayName: "a.ts" },
      { type: "directory", path: "/src/", displayName: "src" },
    ];
    render(<ChatAttachmentPreview attachments={attachments} />);
    expect(screen.getByText("a.ts")).toBeInTheDocument();
    expect(screen.getByText("src")).toBeInTheDocument();
  });
});
