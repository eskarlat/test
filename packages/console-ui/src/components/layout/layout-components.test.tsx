import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

// Connection store
const mockConnectionStatus = vi.fn().mockReturnValue("connected");
vi.mock("@/stores/connection-store", () => ({
  useConnectionStore: (selector: (s: { status: string }) => string) =>
    selector({ status: mockConnectionStatus() }),
}));

// Project store
const mockProjectStore: Record<string, unknown> = {
  activeProjectId: null,
  projects: [],
  setActiveProject: vi.fn(),
};
vi.mock("@/stores/project-store", () => ({
  useProjectStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(mockProjectStore),
}));

// Extension store
const mockExtensionStore: Record<string, unknown> = {
  getExtensionsForProject: vi.fn().mockReturnValue([]),
};
vi.mock("@/stores/extension-store", () => ({
  useExtensionStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(mockExtensionStore),
}));

// Chat store
const mockChatStore: Record<string, unknown> = {
  bridgeStatus: "not-initialized",
};
vi.mock("@/stores/chat-store", () => ({
  useChatStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector(mockChatStore),
}));

// Socket store
vi.mock("@/api/socket", () => ({
  useSocketStore: Object.assign(vi.fn(() => null), {
    getState: () => ({ socket: null, connect: vi.fn() }),
    subscribe: vi.fn(),
    setState: vi.fn(),
  }),
}));

// API client
vi.mock("@/api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  BASE_URL: "http://localhost:42888",
}));

// Extension loader
vi.mock("@/lib/extension-loader", () => ({
  loadExtensionModule: vi.fn(),
  invalidateExtensionModule: vi.fn(),
}));

// SearchPalette (used by Toolbar)
vi.mock("@/components/intelligence/SearchPalette", () => ({
  SearchPalette: () => <div data-testid="search-palette">SearchPalette</div>,
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import { Sidebar } from "./Sidebar";
import { ConnectionStatus } from "./ConnectionStatus";
import { ReconnectionBanner } from "./ReconnectionBanner";
import { GlobalErrorBoundary } from "./ContentArea";
import { ExtensionErrorBoundary } from "../extensions/ExtensionErrorBoundary";
import { ExtensionLoader } from "../extensions/ExtensionLoader";

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

describe("Sidebar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockProjectStore.activeProjectId = null;
    mockProjectStore.projects = [];
    (mockExtensionStore.getExtensionsForProject as ReturnType<typeof vi.fn>).mockReturnValue([]);
    mockChatStore.bridgeStatus = "not-initialized";
  });

  it("shows 'Select a project' when no active project", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );
    expect(screen.getByText("Select a project to see navigation")).toBeInTheDocument();
  });

  it("renders RenRe Kit branding", () => {
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );
    expect(screen.getByText("RenRe Kit")).toBeInTheDocument();
  });

  it("shows core navigation items when a project is active", () => {
    mockProjectStore.activeProjectId = "proj-1";
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Sessions")).toBeInTheDocument();
    expect(screen.getByText("Observations")).toBeInTheDocument();
    expect(screen.getByText("Prompts")).toBeInTheDocument();
    expect(screen.getByText("Errors")).toBeInTheDocument();
    expect(screen.getByText("Tool Analytics")).toBeInTheDocument();
    expect(screen.getByText("Context Recipes")).toBeInTheDocument();
    expect(screen.getByText("Search")).toBeInTheDocument();
    expect(screen.getByText("Tool Governance")).toBeInTheDocument();
    expect(screen.getByText("Chat")).toBeInTheDocument();
    expect(screen.getByText("Automations")).toBeInTheDocument();
    expect(screen.getByText("Worktrees")).toBeInTheDocument();
    expect(screen.getByText("Extension Manager")).toBeInTheDocument();
    expect(screen.getByText("Logs")).toBeInTheDocument();
  });

  it("renders extension sections when extensions have UI pages", () => {
    mockProjectStore.activeProjectId = "proj-1";
    (mockExtensionStore.getExtensionsForProject as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        name: "my-ext",
        displayName: "My Extension",
        version: "1.0.0",
        status: "healthy",
        ui: { pages: [{ id: "overview", label: "Overview", path: "/overview" }] },
      },
    ]);
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );
    expect(screen.getByText("Extensions")).toBeInTheDocument();
    expect(screen.getByText("My Extension")).toBeInTheDocument();
    expect(screen.getByText("Overview")).toBeInTheDocument();
  });

  it("collapses extension section when toggled", async () => {
    const user = userEvent.setup();
    mockProjectStore.activeProjectId = "proj-1";
    (mockExtensionStore.getExtensionsForProject as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        name: "my-ext",
        displayName: "My Extension",
        version: "1.0.0",
        status: "healthy",
        ui: { pages: [{ id: "pg1", label: "Page One", path: "/pg1" }] },
      },
    ]);
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );
    // Page should be visible initially (expanded by default)
    expect(screen.getByText("Page One")).toBeInTheDocument();

    // Click the extension section toggle
    await user.click(screen.getByText("My Extension"));
    expect(screen.queryByText("Page One")).not.toBeInTheDocument();
  });

  it("calls onNavigate when sidebar is clicked", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(
      <MemoryRouter>
        <Sidebar onNavigate={onNavigate} />
      </MemoryRouter>
    );
    await user.click(screen.getByText("RenRe Kit"));
    expect(onNavigate).toHaveBeenCalled();
  });

  it("shows status icons for extensions", () => {
    mockProjectStore.activeProjectId = "proj-1";
    (mockExtensionStore.getExtensionsForProject as ReturnType<typeof vi.fn>).mockReturnValue([
      {
        name: "healthy-ext",
        displayName: "Healthy Ext",
        version: "1.0.0",
        status: "healthy",
        ui: { pages: [{ id: "p", label: "P", path: "/p" }] },
      },
      {
        name: "broken-ext",
        displayName: "Broken Ext",
        version: "1.0.0",
        status: "error",
        ui: { pages: [{ id: "p", label: "P", path: "/p" }] },
      },
      {
        name: "setup-ext",
        displayName: "Setup Ext",
        version: "1.0.0",
        status: "needs-setup",
        ui: { pages: [{ id: "p", label: "P", path: "/p" }] },
      },
    ]);
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );
    expect(screen.getByLabelText("Healthy")).toBeInTheDocument();
    expect(screen.getByLabelText("Error")).toBeInTheDocument();
    expect(screen.getByLabelText("Needs setup")).toBeInTheDocument();
  });

  it("does not show Extensions heading when no extensions have UI", () => {
    mockProjectStore.activeProjectId = "proj-1";
    (mockExtensionStore.getExtensionsForProject as ReturnType<typeof vi.fn>).mockReturnValue([
      { name: "backend-only", version: "1.0.0", status: "healthy" },
    ]);
    render(
      <MemoryRouter>
        <Sidebar />
      </MemoryRouter>
    );
    expect(screen.queryByText("Extensions")).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ConnectionStatus
// ---------------------------------------------------------------------------

describe("ConnectionStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows connected indicator when connected", () => {
    mockConnectionStatus.mockReturnValue("connected");
    render(<ConnectionStatus />);
    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("shows disconnected indicator when disconnected", () => {
    mockConnectionStatus.mockReturnValue("disconnected");
    render(<ConnectionStatus />);
    expect(screen.getByText("Server offline")).toBeInTheDocument();
  });

  it("shows reconnecting indicator when reconnecting", () => {
    mockConnectionStatus.mockReturnValue("reconnecting");
    render(<ConnectionStatus />);
    expect(screen.getByText("Reconnecting...")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ReconnectionBanner
// ---------------------------------------------------------------------------

describe("ReconnectionBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows banner when disconnected", () => {
    mockConnectionStatus.mockReturnValue("disconnected");
    render(<ReconnectionBanner />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Server offline/)).toBeInTheDocument();
    expect(screen.getByText("Reconnect")).toBeInTheDocument();
  });

  it("hides banner when connected", () => {
    mockConnectionStatus.mockReturnValue("connected");
    const { container } = render(<ReconnectionBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("hides banner when reconnecting", () => {
    mockConnectionStatus.mockReturnValue("reconnecting");
    const { container } = render(<ReconnectionBanner />);
    expect(container.innerHTML).toBe("");
  });

  it("shows 'How to start' help", () => {
    mockConnectionStatus.mockReturnValue("disconnected");
    render(<ReconnectionBanner />);
    expect(screen.getByText("How to start")).toBeInTheDocument();
  });

  it("shows tooltip on hover", async () => {
    const user = userEvent.setup();
    mockConnectionStatus.mockReturnValue("disconnected");
    render(<ReconnectionBanner />);
    await user.hover(screen.getByLabelText("How to start the server"));
    expect(screen.getByText("renre-kit start")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// GlobalErrorBoundary (ContentArea.tsx)
// ---------------------------------------------------------------------------

describe("GlobalErrorBoundary", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders children normally when no error", () => {
    render(
      <GlobalErrorBoundary>
        <div>Page content</div>
      </GlobalErrorBoundary>
    );
    expect(screen.getByText("Page content")).toBeInTheDocument();
  });

  it("shows fallback when child throws", () => {
    function Boom(): ReactNode {
      throw new Error("Unexpected error!");
    }
    render(
      <GlobalErrorBoundary>
        <Boom />
      </GlobalErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.getByText("Unexpected error!")).toBeInTheDocument();
    expect(screen.getByText("Try again")).toBeInTheDocument();
  });

  it("shows stack trace in details element", () => {
    function Boom(): ReactNode {
      throw new Error("Stack trace test");
    }
    render(
      <GlobalErrorBoundary>
        <Boom />
      </GlobalErrorBoundary>
    );
    expect(screen.getByText("Stack trace")).toBeInTheDocument();
  });

  it("resets error boundary on Try again click", async () => {
    const user = userEvent.setup();
    let shouldThrow = true;
    function MaybeBoom() {
      if (shouldThrow) throw new Error("Oops");
      return <div>Recovered content</div>;
    }
    render(
      <GlobalErrorBoundary>
        <MaybeBoom />
      </GlobalErrorBoundary>
    );
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();

    shouldThrow = false;
    await user.click(screen.getByText("Try again"));
    expect(screen.getByText("Recovered content")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ExtensionErrorBoundary
// ---------------------------------------------------------------------------

describe("ExtensionErrorBoundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("renders children normally when no error", () => {
    render(
      <ExtensionErrorBoundary extensionName="test-ext">
        <div>Extension content</div>
      </ExtensionErrorBoundary>
    );
    expect(screen.getByText("Extension content")).toBeInTheDocument();
  });

  it("shows fallback when child throws", () => {
    function Boom(): ReactNode {
      throw new Error("Kaboom!");
    }
    render(
      <ExtensionErrorBoundary extensionName="broken-ext">
        <Boom />
      </ExtensionErrorBoundary>
    );
    expect(screen.getByText("Extension crashed")).toBeInTheDocument();
    expect(screen.getByText(/broken-ext/)).toBeInTheDocument();
    expect(screen.getByText("Kaboom!")).toBeInTheDocument();
    expect(screen.getByText("Reload Extension")).toBeInTheDocument();
  });

  it("calls invalidateExtensionModule and resets on reload click", async () => {
    const user = userEvent.setup();
    const { invalidateExtensionModule } = await import("@/lib/extension-loader");

    let shouldThrow = true;
    function MaybeBoom() {
      if (shouldThrow) throw new Error("Crash");
      return <div>Recovered</div>;
    }
    render(
      <ExtensionErrorBoundary extensionName="test-ext">
        <MaybeBoom />
      </ExtensionErrorBoundary>
    );
    expect(screen.getByText("Extension crashed")).toBeInTheDocument();

    shouldThrow = false;
    await user.click(screen.getByText("Reload Extension"));
    expect(invalidateExtensionModule).toHaveBeenCalledWith("test-ext");
    expect(screen.getByText("Recovered")).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// ExtensionLoader
// ---------------------------------------------------------------------------

describe("ExtensionLoader", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows suspense fallback while loading", async () => {
    const { loadExtensionModule } = await import("@/lib/extension-loader");
    // Never-resolving promise to keep it in suspense
    (loadExtensionModule as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    const { container } = render(
      <ExtensionLoader
        extensionName="test-ext"
        version="1.0.0"
        pageId="overview"
        baseUrl="http://localhost:42888"
        projectId="proj-1"
        apiBaseUrl="http://localhost:42888/api"
      />
    );
    // Should render skeleton placeholders (Skeleton uses animate-pulse)
    await waitFor(() => {
      expect(container.querySelector("[class*='animate-pulse'], [class*='skeleton']")).toBeTruthy();
    });
  });

  it("renders extension page component after loading", async () => {
    const { loadExtensionModule } = await import("@/lib/extension-loader");
    function TestPage({ projectId }: { projectId: string }) {
      return <div>Extension page for {projectId}</div>;
    }
    (loadExtensionModule as ReturnType<typeof vi.fn>).mockResolvedValue({
      pages: { overview: TestPage },
    });

    render(
      <ExtensionLoader
        extensionName="test-ext"
        version="1.0.0"
        pageId="overview"
        baseUrl="http://localhost:42888"
        projectId="proj-1"
        apiBaseUrl="http://localhost:42888/api"
      />
    );
    await waitFor(() => {
      expect(screen.getByText("Extension page for proj-1")).toBeInTheDocument();
    });
  });

  it("shows error boundary when page ID not found", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { loadExtensionModule } = await import("@/lib/extension-loader");
    (loadExtensionModule as ReturnType<typeof vi.fn>).mockResolvedValue({
      pages: {},
    });

    render(
      <ExtensionLoader
        extensionName="test-ext"
        version="1.0.0"
        pageId="nonexistent"
        baseUrl="http://localhost:42888"
        projectId="proj-1"
        apiBaseUrl="http://localhost:42888/api"
      />
    );
    await waitFor(() => {
      expect(screen.getByText("Extension crashed")).toBeInTheDocument();
    });
  });
});
