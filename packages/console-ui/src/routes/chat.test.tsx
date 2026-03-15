import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { useChatStore } from "../stores/chat-store";

// Mock API client
vi.mock("../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  apiPost: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
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

// Mock all chat child components to isolate the page logic
vi.mock("../components/chat/ChatSessionList", () => ({
  ChatSessionList: ({ loading }: { loading: boolean }) => (
    <div data-testid="session-list">{loading ? "loading-sessions" : "session-list"}</div>
  ),
}));

vi.mock("../components/chat/ChatMessageList", () => ({
  ChatMessageList: ({ sessionId }: { sessionId: string }) => (
    <div data-testid="message-list">messages-{sessionId}</div>
  ),
}));

vi.mock("../components/chat/ChatInput", () => ({
  ChatInput: () => <div data-testid="chat-input">chat-input</div>,
}));

vi.mock("../components/chat/ChatModelSelector", () => ({
  ChatModelSelector: () => <div data-testid="model-selector">model-selector</div>,
}));

vi.mock("../components/chat/ChatEmptyState", () => ({
  ChatEmptyState: ({ sessionError }: { sessionError?: string }) => (
    <div data-testid="empty-state">{sessionError ?? "empty"}</div>
  ),
}));

vi.mock("../components/chat/ChatContextBar", () => ({
  ChatContextBar: () => <div data-testid="context-bar">context-bar</div>,
}));

vi.mock("../components/chat/ChatPermissionBanner", () => ({
  ChatPermissionBanner: ({ request }: { request: { requestId: string } }) => (
    <div data-testid="permission-banner">permission-{request.requestId}</div>
  ),
}));

vi.mock("../components/chat/ChatInputDialog", () => ({
  ChatInputDialog: ({ request }: { request: { requestId: string } }) => (
    <div data-testid="input-dialog">input-{request.requestId}</div>
  ),
}));

vi.mock("../components/chat/ChatElicitationDialog", () => ({
  ChatElicitationDialog: ({ request }: { request: { requestId: string } }) => (
    <div data-testid="elicitation-dialog">elicitation-{request.requestId}</div>
  ),
}));

const { default: ChatPage } = await import("./chat");

function renderWithRouter(path = "/proj-1/chat") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path=":projectId/chat" element={<ChatPage />} />
        <Route path=":projectId/chat/:sessionId" element={<ChatPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ChatPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Override fetch actions to no-ops so useEffect doesn't overwrite state
    useChatStore.setState({
      bridgeStatus: "not-initialized",
      bridgeError: undefined,
      sessions: [],
      sessionsFetched: false,
      activeSessionId: null,
      models: [],
      selectedModel: "",
      messages: new Map(),
      isStreaming: false,
      pendingPermission: null,
      pendingInput: null,
      pendingElicitation: null,
      sessionError: null,
      pendingInitialMessage: null,
      checkBridgeStatus: () => Promise.resolve(),
      fetchModels: () => Promise.resolve(),
      fetchSessions: () => Promise.resolve(),
      setActiveSession: () => {},
      resumeSession: () => Promise.resolve(),
    });
  });

  it("renders session list panel", () => {
    renderWithRouter();
    expect(screen.getByTestId("session-list")).toBeTruthy();
  });

  it("shows empty state when bridge is not ready and no sessionId", () => {
    renderWithRouter("/proj-1/chat");
    // With no sessionId on desktop, the chat area shows empty state
    // On the route /:projectId/chat without sessionId, the chat area is hidden on mobile but visible on md+
    // The empty state is rendered inside the hidden-on-mobile section
    expect(screen.getByTestId("empty-state")).toBeTruthy();
  });

  it("shows empty state when bridge is not ready with session", () => {
    useChatStore.setState({ bridgeStatus: "starting" });
    renderWithRouter("/proj-1/chat/sess-1");
    expect(screen.getByTestId("empty-state")).toBeTruthy();
  });

  it("shows chat interface when bridge is ready and sessionId is present", () => {
    useChatStore.setState({ bridgeStatus: "ready", sessionsFetched: true });
    renderWithRouter("/proj-1/chat/sess-1");
    expect(screen.getByTestId("message-list")).toBeTruthy();
    expect(screen.getByTestId("chat-input")).toBeTruthy();
    expect(screen.getByTestId("model-selector")).toBeTruthy();
    expect(screen.getByTestId("context-bar")).toBeTruthy();
  });

  it("renders message list with correct sessionId", () => {
    useChatStore.setState({ bridgeStatus: "ready", sessionsFetched: true });
    renderWithRouter("/proj-1/chat/sess-42");
    expect(screen.getByText("messages-sess-42")).toBeTruthy();
  });

  it("renders permission banner when pendingPermission is set", () => {
    useChatStore.setState({
      bridgeStatus: "ready",
      sessionsFetched: true,
      pendingPermission: {
        requestId: "perm-1",
        title: "Allow shell?",
        message: "Run command?",
        permissionKind: "shell",
      },
    });
    renderWithRouter("/proj-1/chat/sess-1");
    expect(screen.getByTestId("permission-banner")).toBeTruthy();
    expect(screen.getByText("permission-perm-1")).toBeTruthy();
  });

  it("renders input dialog when pendingInput is set", () => {
    useChatStore.setState({
      bridgeStatus: "ready",
      sessionsFetched: true,
      pendingInput: {
        requestId: "input-1",
        prompt: "Enter value",
      },
    });
    renderWithRouter("/proj-1/chat/sess-1");
    expect(screen.getByTestId("input-dialog")).toBeTruthy();
    expect(screen.getByText("input-input-1")).toBeTruthy();
  });

  it("renders elicitation dialog when pendingElicitation is set", () => {
    useChatStore.setState({
      bridgeStatus: "ready",
      sessionsFetched: true,
      pendingElicitation: {
        requestId: "elicit-1",
        schema: { type: "object" },
        message: "Fill form",
      },
    });
    renderWithRouter("/proj-1/chat/sess-1");
    expect(screen.getByTestId("elicitation-dialog")).toBeTruthy();
    expect(screen.getByText("elicitation-elicit-1")).toBeTruthy();
  });

  it("does not render permission/input/elicitation when null", () => {
    useChatStore.setState({
      bridgeStatus: "ready",
      sessionsFetched: true,
      pendingPermission: null,
      pendingInput: null,
      pendingElicitation: null,
    });
    renderWithRouter("/proj-1/chat/sess-1");
    expect(screen.queryByTestId("permission-banner")).toBeNull();
    expect(screen.queryByTestId("input-dialog")).toBeNull();
    expect(screen.queryByTestId("elicitation-dialog")).toBeNull();
  });

  it("shows session error in empty state", () => {
    useChatStore.setState({
      bridgeStatus: "not-initialized",
      sessionError: "Bridge unavailable",
    });
    renderWithRouter("/proj-1/chat/sess-1");
    expect(screen.getByText("Bridge unavailable")).toBeTruthy();
  });

  it("renders back button on mobile when sessionId is present", () => {
    useChatStore.setState({ bridgeStatus: "ready", sessionsFetched: true });
    renderWithRouter("/proj-1/chat/sess-1");
    expect(screen.getByLabelText("Back to sessions")).toBeTruthy();
  });

  it("shows loading state in session list when sessions not fetched", () => {
    useChatStore.setState({ bridgeStatus: "ready", sessionsFetched: false });
    renderWithRouter("/proj-1/chat");
    expect(screen.getByText("loading-sessions")).toBeTruthy();
  });

  it("does not show loading when bridge is not ready", () => {
    useChatStore.setState({ bridgeStatus: "starting", sessionsFetched: false });
    renderWithRouter("/proj-1/chat");
    expect(screen.getByText("session-list")).toBeTruthy();
  });

  it("calls checkBridgeStatus on mount", () => {
    const checkBridgeStatus = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ checkBridgeStatus });
    renderWithRouter();
    expect(checkBridgeStatus).toHaveBeenCalled();
  });

  it("calls fetchModels when bridge becomes ready", () => {
    const fetchModels = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ bridgeStatus: "ready", fetchModels });
    renderWithRouter();
    expect(fetchModels).toHaveBeenCalled();
  });

  it("does not call fetchModels when bridge is not ready", () => {
    const fetchModels = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ bridgeStatus: "starting", fetchModels });
    renderWithRouter();
    expect(fetchModels).not.toHaveBeenCalled();
  });

  it("calls fetchSessions when bridge is ready and projectId present", () => {
    const fetchSessions = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ bridgeStatus: "ready", fetchSessions });
    renderWithRouter("/proj-1/chat");
    expect(fetchSessions).toHaveBeenCalledWith("proj-1");
  });

  it("does not call fetchSessions when bridge is not ready", () => {
    const fetchSessions = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ bridgeStatus: "starting", fetchSessions });
    renderWithRouter("/proj-1/chat");
    expect(fetchSessions).not.toHaveBeenCalled();
  });

  it("calls setActiveSession with sessionId from route", () => {
    const setActiveSession = vi.fn();
    useChatStore.setState({ setActiveSession });
    renderWithRouter("/proj-1/chat/sess-99");
    expect(setActiveSession).toHaveBeenCalledWith("sess-99");
  });

  it("calls setActiveSession with null when no sessionId", () => {
    const setActiveSession = vi.fn();
    useChatStore.setState({ setActiveSession });
    renderWithRouter("/proj-1/chat");
    expect(setActiveSession).toHaveBeenCalledWith(null);
  });

  it("calls resumeSession when bridge is ready and sessionId present", () => {
    const resumeSession = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ bridgeStatus: "ready", resumeSession });
    renderWithRouter("/proj-1/chat/sess-5");
    expect(resumeSession).toHaveBeenCalledWith("proj-1", "sess-5");
  });

  it("does not call resumeSession when bridge is not ready", () => {
    const resumeSession = vi.fn().mockResolvedValue(undefined);
    useChatStore.setState({ bridgeStatus: "starting", resumeSession });
    renderWithRouter("/proj-1/chat/sess-5");
    expect(resumeSession).not.toHaveBeenCalled();
  });

  it("shows empty state with 'empty' text when no session error", () => {
    useChatStore.setState({ bridgeStatus: "not-initialized", sessionError: null });
    renderWithRouter("/proj-1/chat/sess-1");
    expect(screen.getByText("empty")).toBeTruthy();
  });

  it("shows empty state for bridge error status", () => {
    useChatStore.setState({ bridgeStatus: "error" });
    renderWithRouter("/proj-1/chat/sess-1");
    expect(screen.getByTestId("empty-state")).toBeTruthy();
  });

  it("shows empty state for bridge unavailable status", () => {
    useChatStore.setState({ bridgeStatus: "unavailable" });
    renderWithRouter("/proj-1/chat/sess-1");
    expect(screen.getByTestId("empty-state")).toBeTruthy();
  });

  it("renders all session-active components together", () => {
    useChatStore.setState({
      bridgeStatus: "ready",
      sessionsFetched: true,
      pendingPermission: { requestId: "p1", title: "t", message: "m", permissionKind: "shell" },
      pendingInput: { requestId: "i1", prompt: "?" },
      pendingElicitation: { requestId: "e1", schema: {}, message: "fill" },
    });
    renderWithRouter("/proj-1/chat/sess-1");
    expect(screen.getByTestId("permission-banner")).toBeTruthy();
    expect(screen.getByTestId("input-dialog")).toBeTruthy();
    expect(screen.getByTestId("elicitation-dialog")).toBeTruthy();
    expect(screen.getByTestId("message-list")).toBeTruthy();
    expect(screen.getByTestId("chat-input")).toBeTruthy();
    expect(screen.getByTestId("model-selector")).toBeTruthy();
    expect(screen.getByTestId("context-bar")).toBeTruthy();
  });

  describe("bridge status polling", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("polls checkBridgeStatus at 2s intervals when bridge not ready", () => {
      const checkBridgeStatus = vi.fn().mockResolvedValue(undefined);
      useChatStore.setState({ bridgeStatus: "starting", checkBridgeStatus });
      renderWithRouter();

      // Initial call
      expect(checkBridgeStatus).toHaveBeenCalledTimes(1);

      // Advance timer by 2s should trigger interval
      act(() => { vi.advanceTimersByTime(2000); });
      expect(checkBridgeStatus).toHaveBeenCalledTimes(2);

      act(() => { vi.advanceTimersByTime(2000); });
      expect(checkBridgeStatus).toHaveBeenCalledTimes(3);
    });

    it("stops polling when bridge becomes ready", () => {
      const checkBridgeStatus = vi.fn().mockResolvedValue(undefined);
      useChatStore.setState({ bridgeStatus: "ready", checkBridgeStatus });
      renderWithRouter();

      // Initial call
      const initialCalls = checkBridgeStatus.mock.calls.length;

      // Should not add more calls since bridge is "ready"
      act(() => { vi.advanceTimersByTime(6000); });
      expect(checkBridgeStatus).toHaveBeenCalledTimes(initialCalls);
    });

    it("stops polling when bridge status is error", () => {
      const checkBridgeStatus = vi.fn().mockResolvedValue(undefined);
      useChatStore.setState({ bridgeStatus: "error", checkBridgeStatus });
      renderWithRouter();

      const initialCalls = checkBridgeStatus.mock.calls.length;
      act(() => { vi.advanceTimersByTime(6000); });
      expect(checkBridgeStatus).toHaveBeenCalledTimes(initialCalls);
    });

    it("stops polling when bridge status is unavailable", () => {
      const checkBridgeStatus = vi.fn().mockResolvedValue(undefined);
      useChatStore.setState({ bridgeStatus: "unavailable", checkBridgeStatus });
      renderWithRouter();

      const initialCalls = checkBridgeStatus.mock.calls.length;
      act(() => { vi.advanceTimersByTime(6000); });
      expect(checkBridgeStatus).toHaveBeenCalledTimes(initialCalls);
    });
  });
});
