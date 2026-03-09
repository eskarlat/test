import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { useWorktreeStore } from "../stores/worktree-store";
import type { Worktree } from "../types/worktree";

// Mock modules
vi.mock("../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: [], error: null, status: 200 }),
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

vi.mock("../stores/notification-store", () => ({
  useNotificationStore: Object.assign(
    vi.fn((selector: (s: { addToast: () => void }) => unknown) => selector({ addToast: vi.fn() })),
    {
      getState: () => ({ addToast: vi.fn() }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

// Must import lazily after mocks
const { default: WorktreesPage } = await import("./worktrees");
const { WorktreeStatusBadge } = await import("../components/worktrees/WorktreeStatusBadge");
const { formatBytes } = await import("../components/worktrees/DiskUsageBar");

function makeWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: "wt-1",
    projectId: "proj-1",
    branch: "feature/test",
    path: "/tmp/worktrees/wt-1", // eslint-disable-line sonarjs/publicly-writable-directories
    status: "ready",
    cleanupPolicy: "always",
    createdBy: { type: "user" },
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function renderWithRouter(ui: React.ReactElement, initialEntry = "/proj-1/worktrees") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path=":projectId/worktrees" element={ui} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("WorktreesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useWorktreeStore.setState({
      worktrees: [],
      totalDiskUsage: 0,
      worktreeCount: 0,
      loading: false,
      error: null,
    });
  });

  it("renders empty state when no worktrees", () => {
    renderWithRouter(<WorktreesPage />);

    expect(screen.getByText("No worktrees")).toBeTruthy();
    expect(screen.getByText(/Worktrees provide isolated git working directories/)).toBeTruthy();
  });

  it("renders worktree list", () => {
    useWorktreeStore.setState({
      worktrees: [
        makeWorktree({ id: "wt-1", branch: "feature/alpha" }),
        makeWorktree({ id: "wt-2", branch: "feature/beta", status: "in_use" }),
      ],
    });

    renderWithRouter(<WorktreesPage />);

    expect(screen.getByText("feature/alpha")).toBeTruthy();
    expect(screen.getByText("feature/beta")).toBeTruthy();
  });

  it("renders error state with retry button", () => {
    useWorktreeStore.setState({ error: "Connection failed" });

    renderWithRouter(<WorktreesPage />);

    expect(screen.getByText("Connection failed")).toBeTruthy();
    expect(screen.getByText("Retry")).toBeTruthy();
  });

  it("opens create dialog on button click", async () => {
    const user = userEvent.setup();
    renderWithRouter(<WorktreesPage />);

    const createBtn = screen.getByRole("button", { name: /New Worktree/i });
    await user.click(createBtn);

    expect(screen.getByRole("dialog", { name: /Create worktree/i })).toBeTruthy();
    expect(screen.getByLabelText("Branch name")).toBeTruthy();
  });

  it("renders loading skeleton", () => {
    useWorktreeStore.setState({ loading: true });

    renderWithRouter(<WorktreesPage />);

    const skeletons = document.querySelectorAll(".animate-pulse");
    expect(skeletons.length).toBeGreaterThan(0);
  });
});

describe("WorktreeStatusBadge", () => {
  it("renders the correct label for each status", () => {
    const statuses = [
      { status: "creating" as const, label: "CREATING" },
      { status: "ready" as const, label: "READY" },
      { status: "in_use" as const, label: "IN USE" },
      { status: "completed" as const, label: "COMPLETED" },
      { status: "error" as const, label: "ERROR" },
      { status: "removing" as const, label: "REMOVING" },
    ];

    for (const { status, label } of statuses) {
      const { unmount } = render(<WorktreeStatusBadge status={status} />);
      expect(screen.getByText(label)).toBeTruthy();
      unmount();
    }
  });

  it("applies animate-pulse to in_use status", () => {
    render(<WorktreeStatusBadge status="in_use" />);
    const badge = screen.getByText("IN USE");
    expect(badge.className).toContain("animate-pulse");
  });
});

describe("formatBytes", () => {
  it("formats 0 bytes", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("formats bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("formats kilobytes", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("formats megabytes", () => {
    expect(formatBytes(1048576)).toBe("1.0 MB");
  });

  it("formats gigabytes", () => {
    expect(formatBytes(1073741824)).toBe("1.0 GB");
  });
});
