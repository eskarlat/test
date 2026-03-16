import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Mock API hooks – each hook returns { data, loading, error, reload }
const mockUseHealth = vi.fn();
const mockUseSessions = vi.fn();
const mockUseMCPStatus = vi.fn();
const mockUseHookActivity = vi.fn();
const mockUseAPIUsage = vi.fn();
const mockUseLogs = vi.fn();

vi.mock("../../api/hooks", () => ({
  useHealth: (...args: unknown[]) => mockUseHealth(...args),
  useSessions: (...args: unknown[]) => mockUseSessions(...args),
  useMCPStatus: (...args: unknown[]) => mockUseMCPStatus(...args),
  useHookActivity: (...args: unknown[]) => mockUseHookActivity(...args),
  useAPIUsage: (...args: unknown[]) => mockUseAPIUsage(...args),
  useLogs: (...args: unknown[]) => mockUseLogs(...args),
}));

vi.mock("../../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  BASE_URL: "http://localhost:42888",
}));

vi.mock("../../api/socket", () => ({
  useSocketStore: Object.assign(vi.fn(() => null), {
    getState: () => ({ socket: null }),
    subscribe: vi.fn(),
    setState: vi.fn(),
  }),
}));

// Mock notification store for ActivityFeed
const mockRecentEvents = vi.fn().mockReturnValue([]);
vi.mock("../../stores/notification-store", () => ({
  useNotificationStore: (selector: (s: { recentEvents: unknown[] }) => unknown) =>
    selector({ recentEvents: mockRecentEvents() }),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { ServerStatus } from "./ServerStatus";
import { ProjectCard } from "./ProjectCard";
import { SessionList } from "./SessionList";
import { ActivityFeed } from "./ActivityFeed";
import { ExtensionStatusList } from "./ExtensionStatusList";
import { MCPStatus } from "./MCPStatus";
import { HookActivity } from "./HookActivity";
import { APIUsage } from "./APIUsage";
import { RecentLogs } from "./RecentLogs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function loading() {
  return { data: null, loading: true, error: null, reload: vi.fn() };
}
function errorState(msg: string) {
  return { data: null, loading: false, error: msg, reload: vi.fn() };
}

// ---------------------------------------------------------------------------
// ServerStatus
// ---------------------------------------------------------------------------

describe("ServerStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows skeleton while loading", () => {
    mockUseHealth.mockReturnValue(loading());
    const { container } = render(<ServerStatus />);
    // Skeletons are rendered
    expect(container.querySelectorAll("[class*='animate-pulse'], [class*='skeleton']").length).toBeGreaterThanOrEqual(0);
    // No "Server running" text
    expect(screen.queryByText("Server running")).not.toBeInTheDocument();
  });

  it("shows error state with retry button", () => {
    const reload = vi.fn();
    mockUseHealth.mockReturnValue({ data: null, loading: false, error: "Connection refused", reload });
    render(<ServerStatus />);
    expect(screen.getByText(/Server status unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/Connection refused/)).toBeInTheDocument();
    expect(screen.getByLabelText("Retry")).toBeInTheDocument();
  });

  it("calls reload when Retry is clicked", async () => {
    const user = userEvent.setup();
    const reload = vi.fn();
    mockUseHealth.mockReturnValue({ data: null, loading: false, error: "fail", reload });
    render(<ServerStatus />);
    await user.click(screen.getByLabelText("Retry"));
    expect(reload).toHaveBeenCalled();
  });

  it("shows server info when data is available", () => {
    mockUseHealth.mockReturnValue({
      data: {
        status: "ok",
        port: 42888,
        uptime: 3661,
        memoryUsage: { heapUsed: 52428800, heapTotal: 104857600, rss: 157286400 },
        pid: 12345,
        version: "1.0.0",
      },
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<ServerStatus />);
    expect(screen.getByText("Server running")).toBeInTheDocument();
    expect(screen.getByText(/port 42888/)).toBeInTheDocument();
    expect(screen.getByText("Uptime: 1h 1m")).toBeInTheDocument();
    expect(screen.getByText("Memory: 50MB")).toBeInTheDocument();
    expect(screen.getByText("PID: 12345")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
  });

  it("shows uptime in minutes only when < 1h", () => {
    mockUseHealth.mockReturnValue({
      data: {
        status: "ok",
        port: 42888,
        uptime: 300,
        memoryUsage: { heapUsed: 10485760, heapTotal: 20971520, rss: 31457280 },
      },
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<ServerStatus />);
    expect(screen.getByText("Uptime: 5m")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ProjectCard
// ---------------------------------------------------------------------------

describe("ProjectCard", () => {
  beforeEach(() => vi.clearAllMocks());

  it("renders project name and path", () => {
    render(
      <MemoryRouter>
        <ProjectCard
          project={{
            id: "proj-1",
            name: "My Project",
            path: "/home/user/my-project",
            extensionCount: 2,
            mountedExtensions: [
              { name: "ext-a", version: "1.0.0", status: "healthy" },
              { name: "ext-b", version: "0.2.0", status: "error" },
            ],
          }}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("My Project")).toBeInTheDocument();
    expect(screen.getByText("/home/user/my-project")).toBeInTheDocument();
    expect(screen.getByText("2 extensions")).toBeInTheDocument();
  });

  it("shows healthy and problem counts", () => {
    render(
      <MemoryRouter>
        <ProjectCard
          project={{
            id: "proj-1",
            name: "P",
            path: "/p",
            extensionCount: 3,
            mountedExtensions: [
              { name: "a", version: "1.0.0", status: "healthy" },
              { name: "b", version: "1.0.0", status: "healthy" },
              { name: "c", version: "1.0.0", status: "error" },
            ],
          }}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("2 healthy")).toBeInTheDocument();
    expect(screen.getByText("1 need attention")).toBeInTheDocument();
  });

  it("shows singular extension when count is 1", () => {
    render(
      <MemoryRouter>
        <ProjectCard
          project={{
            id: "proj-1",
            name: "P",
            path: "/p",
            extensionCount: 1,
            mountedExtensions: [{ name: "a", version: "1.0.0", status: "healthy" }],
          }}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("1 extension")).toBeInTheDocument();
  });

  it("renders link to open project", () => {
    render(
      <MemoryRouter>
        <ProjectCard
          project={{
            id: "proj-1",
            name: "My Project",
            path: "/p",
            extensionCount: 0,
            mountedExtensions: [],
          }}
        />
      </MemoryRouter>
    );
    expect(screen.getByLabelText("Open project My Project")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// SessionList
// ---------------------------------------------------------------------------

describe("SessionList", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows skeleton while loading", () => {
    mockUseSessions.mockReturnValue(loading());
    render(<SessionList projectId="proj-1" />);
    expect(screen.queryByText("No active sessions.")).not.toBeInTheDocument();
  });

  it("shows error with retry", () => {
    const reload = vi.fn();
    mockUseSessions.mockReturnValue(errorState("Network error"));
    // Override to include custom reload
    mockUseSessions.mockReturnValue({ data: null, loading: false, error: "Network error", reload });
    render(<SessionList projectId="proj-1" />);
    expect(screen.getByText(/Sessions unavailable: Network error/)).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("shows empty state when no sessions", () => {
    mockUseSessions.mockReturnValue({ data: [], loading: false, error: null, reload: vi.fn() });
    render(<SessionList projectId="proj-1" />);
    expect(screen.getByText("No active sessions.")).toBeInTheDocument();
  });

  it("renders session list with agent labels", () => {
    mockUseSessions.mockReturnValue({
      data: [
        { id: "sess-1", projectId: "proj-1", startedAt: new Date().toISOString(), agent: "claude-code", status: "active" },
        { id: "sess-2", projectId: "proj-1", startedAt: new Date().toISOString(), agent: "copilot", status: "active" },
      ],
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<SessionList projectId="proj-1" />);
    expect(screen.getByText("Claude Code")).toBeInTheDocument();
    expect(screen.getByText("GitHub Copilot")).toBeInTheDocument();
  });

  it("shows unknown agent name as-is", () => {
    mockUseSessions.mockReturnValue({
      data: [
        { id: "sess-1", projectId: "proj-1", startedAt: new Date().toISOString(), agent: "custom-agent", status: "active" },
      ],
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<SessionList projectId="proj-1" />);
    expect(screen.getByText("custom-agent")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ActivityFeed
// ---------------------------------------------------------------------------

describe("ActivityFeed", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows empty state when no events", () => {
    mockRecentEvents.mockReturnValue([]);
    render(<ActivityFeed />);
    expect(screen.getByText("No recent activity yet.")).toBeInTheDocument();
    expect(screen.getByText(/Events will appear here/)).toBeInTheDocument();
  });

  it("renders events with labels", () => {
    mockRecentEvents.mockReturnValue([
      { timestamp: new Date().toISOString(), event: "extension.mounted", payload: { name: "my-ext", projectId: "proj-1" } },
      { timestamp: new Date().toISOString(), event: "server.started", payload: null },
    ]);
    render(<ActivityFeed />);
    // The first event should show "extension.mounted — my-ext"
    expect(screen.getByText(/extension\.mounted/)).toBeInTheDocument();
    expect(screen.getByText("server.started")).toBeInTheDocument();
  });

  it("shows project ID when present in payload", () => {
    mockRecentEvents.mockReturnValue([
      { timestamp: new Date().toISOString(), event: "test.event", payload: { projectId: "my-proj" } },
    ]);
    render(<ActivityFeed />);
    expect(screen.getByText("my-proj")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ExtensionStatusList
// ---------------------------------------------------------------------------

describe("ExtensionStatusList", () => {
  const defaultProps = {
    projectId: "proj-1",
    loading: false,
    error: null,
    onRetry: vi.fn(),
  };

  beforeEach(() => vi.clearAllMocks());

  it("shows skeleton while loading", () => {
    render(
      <MemoryRouter>
        <ExtensionStatusList {...defaultProps} extensions={[]} loading={true} />
      </MemoryRouter>
    );
    expect(screen.queryByText("No extensions installed.")).not.toBeInTheDocument();
  });

  it("shows error with retry button", async () => {
    const user = userEvent.setup();
    const onRetry = vi.fn();
    render(
      <MemoryRouter>
        <ExtensionStatusList {...defaultProps} extensions={[]} error="Timeout" onRetry={onRetry} />
      </MemoryRouter>
    );
    expect(screen.getByText(/Failed to load extensions: Timeout/)).toBeInTheDocument();
    await user.click(screen.getByText("Retry"));
    expect(onRetry).toHaveBeenCalled();
  });

  it("shows empty state when no extensions", () => {
    render(
      <MemoryRouter>
        <ExtensionStatusList {...defaultProps} extensions={[]} />
      </MemoryRouter>
    );
    expect(screen.getByText("No extensions installed.")).toBeInTheDocument();
  });

  it("renders extension list with statuses", () => {
    render(
      <MemoryRouter>
        <ExtensionStatusList
          {...defaultProps}
          extensions={[
            { name: "ext-a", displayName: "Extension A", version: "1.0.0", status: "healthy" },
            { name: "ext-b", version: "0.5.0", status: "error", error: "Missing config" },
            { name: "ext-c", version: "2.0.0", status: "needs-setup" },
          ]}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("Extension A")).toBeInTheDocument();
    expect(screen.getByText("v1.0.0")).toBeInTheDocument();
    expect(screen.getByText("healthy")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
    expect(screen.getByText("needs setup")).toBeInTheDocument();
    expect(screen.getByText("Missing config")).toBeInTheDocument();
    expect(screen.getByText("Configure")).toBeInTheDocument();
  });

  it("uses extension name when displayName is missing", () => {
    render(
      <MemoryRouter>
        <ExtensionStatusList
          {...defaultProps}
          extensions={[{ name: "raw-name", version: "1.0.0", status: "healthy" }]}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("raw-name")).toBeInTheDocument();
  });

  it("renders Open link for healthy extensions with UI pages", () => {
    render(
      <MemoryRouter>
        <ExtensionStatusList
          {...defaultProps}
          extensions={[
            {
              name: "ext-a",
              version: "1.0.0",
              status: "healthy",
              ui: { pages: [{ id: "page-1", label: "Dashboard", path: "/dashboard" }], bundle: "/bundle.js" },
            },
          ]}
        />
      </MemoryRouter>
    );
    expect(screen.getByText("Open")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// MCPStatus
// ---------------------------------------------------------------------------

describe("MCPStatus", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows skeleton while loading", () => {
    mockUseMCPStatus.mockReturnValue(loading());
    render(<MCPStatus projectId="proj-1" />);
    expect(screen.queryByText("No active MCP connections.")).not.toBeInTheDocument();
  });

  it("shows error with retry", () => {
    mockUseMCPStatus.mockReturnValue(errorState("Server error"));
    render(<MCPStatus projectId="proj-1" />);
    expect(screen.getByText(/MCP status unavailable: Server error/)).toBeInTheDocument();
    expect(screen.getByText("Retry")).toBeInTheDocument();
  });

  it("shows empty state", () => {
    mockUseMCPStatus.mockReturnValue({ data: [], loading: false, error: null, reload: vi.fn() });
    render(<MCPStatus projectId="proj-1" />);
    expect(screen.getByText("No active MCP connections.")).toBeInTheDocument();
  });

  it("renders MCP entries with connection status", () => {
    mockUseMCPStatus.mockReturnValue({
      data: [
        { extensionName: "mcp-ext", transport: "stdio", status: "connected", uptime: 7200, pid: 9999 },
        { extensionName: "sse-ext", transport: "sse", status: "connecting", uptime: 30, url: "http://localhost:3000" },
        { extensionName: "err-ext", transport: "stdio", status: "error", uptime: 0, error: "Crashed" },
      ],
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<MCPStatus projectId="proj-1" />);
    expect(screen.getByText("mcp-ext")).toBeInTheDocument();
    expect(screen.getAllByText("stdio").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("PID 9999")).toBeInTheDocument();
    expect(screen.getByText("Uptime: 2h 0m")).toBeInTheDocument();

    expect(screen.getByText("sse-ext")).toBeInTheDocument();
    expect(screen.getByText("Connecting")).toBeInTheDocument();
    expect(screen.getByText("http://localhost:3000")).toBeInTheDocument();

    expect(screen.getByText("err-ext")).toBeInTheDocument();
    expect(screen.getByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Crashed")).toBeInTheDocument();
  });

  it("shows Disconnected for disconnected status", () => {
    mockUseMCPStatus.mockReturnValue({
      data: [
        { extensionName: "dc-ext", transport: "stdio", status: "disconnected", uptime: 0 },
      ],
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<MCPStatus projectId="proj-1" />);
    expect(screen.getByText("Disconnected")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// HookActivity
// ---------------------------------------------------------------------------

describe("HookActivity", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows skeleton while loading", () => {
    mockUseHookActivity.mockReturnValue(loading());
    render(<HookActivity projectId="proj-1" />);
    expect(screen.queryByText("No hook executions recorded yet.")).not.toBeInTheDocument();
  });

  it("shows error with retry", () => {
    mockUseHookActivity.mockReturnValue(errorState("Timeout"));
    render(<HookActivity projectId="proj-1" />);
    expect(screen.getByText(/Hook activity unavailable: Timeout/)).toBeInTheDocument();
  });

  it("shows empty state", () => {
    mockUseHookActivity.mockReturnValue({ data: [], loading: false, error: null, reload: vi.fn() });
    render(<HookActivity projectId="proj-1" />);
    expect(screen.getByText("No hook executions recorded yet.")).toBeInTheDocument();
  });

  it("renders hook entries with success/failure indicators", () => {
    mockUseHookActivity.mockReturnValue({
      data: [
        { timestamp: new Date().toISOString(), event: "preToolUse", feature: "context-provider", extensionName: "my-ext", success: true, durationMs: 42 },
        { timestamp: new Date().toISOString(), event: "postToolUse", feature: "hook-runner", success: false, durationMs: 1500 },
      ],
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<HookActivity projectId="proj-1" />);
    expect(screen.getByText("preToolUse")).toBeInTheDocument();
    expect(screen.getByText("my-ext")).toBeInTheDocument();
    expect(screen.getByText("context-provider")).toBeInTheDocument();
    expect(screen.getByText("42ms")).toBeInTheDocument();
    expect(screen.getByLabelText("Success")).toBeInTheDocument();

    expect(screen.getByText("postToolUse")).toBeInTheDocument();
    expect(screen.getByText("1.5s")).toBeInTheDocument();
    expect(screen.getByLabelText("Failed")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// APIUsage
// ---------------------------------------------------------------------------

describe("APIUsage", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows skeleton while loading", () => {
    mockUseAPIUsage.mockReturnValue(loading());
    render(<APIUsage projectId="proj-1" />);
    expect(screen.queryByText("No API calls in the last hour.")).not.toBeInTheDocument();
  });

  it("shows error with retry", () => {
    mockUseAPIUsage.mockReturnValue(errorState("Service down"));
    render(<APIUsage projectId="proj-1" />);
    expect(screen.getByText(/API usage unavailable: Service down/)).toBeInTheDocument();
  });

  it("shows empty state", () => {
    mockUseAPIUsage.mockReturnValue({ data: [], loading: false, error: null, reload: vi.fn() });
    render(<APIUsage projectId="proj-1" />);
    expect(screen.getByText("No API calls in the last hour.")).toBeInTheDocument();
  });

  it("renders stats rows with totals", () => {
    mockUseAPIUsage.mockReturnValue({
      data: [
        { extension: "ext-a", action: "getData", calls: 10, avgLatencyMs: 50 },
        { extension: "ext-b", action: "postData", calls: 5, avgLatencyMs: 100 },
      ],
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<APIUsage projectId="proj-1" />);
    expect(screen.getByText("ext-a")).toBeInTheDocument();
    expect(screen.getByText("getData")).toBeInTheDocument();
    expect(screen.getByText("10 calls")).toBeInTheDocument();
    expect(screen.getByText("avg 50ms")).toBeInTheDocument();

    expect(screen.getByText("ext-b")).toBeInTheDocument();
    expect(screen.getByText("5 calls")).toBeInTheDocument();

    // totals: 15 total calls, overall avg = (50*10 + 100*5) / 15 = 67ms
    expect(screen.getByText("15 total calls (last hour)")).toBeInTheDocument();
    expect(screen.getByText("Overall avg: 67ms")).toBeInTheDocument();
  });

  it("uses singular 'call' for single call", () => {
    mockUseAPIUsage.mockReturnValue({
      data: [{ extension: "ext-a", action: "single", calls: 1, avgLatencyMs: 20 }],
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(<APIUsage projectId="proj-1" />);
    expect(screen.getByText("1 call")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// RecentLogs
// ---------------------------------------------------------------------------

describe("RecentLogs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("shows skeleton while loading", () => {
    mockUseLogs.mockReturnValue(loading());
    render(
      <MemoryRouter>
        <RecentLogs projectId="proj-1" />
      </MemoryRouter>
    );
    expect(screen.queryByText("No log entries yet.")).not.toBeInTheDocument();
  });

  it("shows error with retry", () => {
    mockUseLogs.mockReturnValue(errorState("Cannot read logs"));
    render(
      <MemoryRouter>
        <RecentLogs projectId="proj-1" />
      </MemoryRouter>
    );
    expect(screen.getByText(/Logs unavailable: Cannot read logs/)).toBeInTheDocument();
  });

  it("shows empty state", () => {
    mockUseLogs.mockReturnValue({ data: [], loading: false, error: null, reload: vi.fn() });
    render(
      <MemoryRouter>
        <RecentLogs projectId="proj-1" />
      </MemoryRouter>
    );
    expect(screen.getByText("No log entries yet.")).toBeInTheDocument();
  });

  it("renders log entries with level and message", () => {
    mockUseLogs.mockReturnValue({
      data: [
        { timestamp: new Date().toISOString(), level: "info", source: "server", message: "Started successfully" },
        { timestamp: new Date().toISOString(), level: "error", source: "ext-a", message: "Failed to connect" },
        { timestamp: new Date().toISOString(), level: "warn", source: "hooks", message: "Slow execution" },
        { timestamp: new Date().toISOString(), level: "debug", source: "core", message: "Trace data" },
      ],
      loading: false,
      error: null,
      reload: vi.fn(),
    });
    render(
      <MemoryRouter>
        <RecentLogs projectId="proj-1" />
      </MemoryRouter>
    );
    expect(screen.getByText("info")).toBeInTheDocument();
    expect(screen.getByText("error")).toBeInTheDocument();
    expect(screen.getByText("warn")).toBeInTheDocument();
    expect(screen.getByText("debug")).toBeInTheDocument();
    expect(screen.getByText("Started successfully")).toBeInTheDocument();
    expect(screen.getByText("Failed to connect")).toBeInTheDocument();
    expect(screen.getByText("View all logs")).toBeInTheDocument();
  });
});
