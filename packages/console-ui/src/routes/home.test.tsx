import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { useProjectStore } from "../stores/project-store";

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

vi.mock("../stores/notification-store", () => ({
  useNotificationStore: Object.assign(
    vi.fn((sel: (s: { recentEvents: never[]; toasts: never[] }) => unknown) =>
      sel({ recentEvents: [], toasts: [] }),
    ),
    {
      getState: () => ({ recentEvents: [], toasts: [] }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

const { default: SystemHome } = await import("./home");

function renderPage() {
  return render(
    <MemoryRouter>
      <SystemHome />
    </MemoryRouter>,
  );
}

describe("SystemHome", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({ projects: [], activeProjectId: null });
  });

  it("renders page heading", () => {
    renderPage();
    expect(screen.getByText("RenRe Kit Console")).toBeTruthy();
    expect(
      screen.getByText("Monitor and manage your AI agent context services."),
    ).toBeTruthy();
  });

  it("renders section headings", () => {
    renderPage();
    expect(screen.getByText("Active Projects")).toBeTruthy();
    expect(screen.getByText("Recent Activity")).toBeTruthy();
  });

  it("shows empty state when no projects", () => {
    renderPage();
    expect(screen.getByText("No projects running")).toBeTruthy();
    expect(
      screen.getByText("Start a project to see it here."),
    ).toBeTruthy();
  });

  it("renders getting started guidance", () => {
    renderPage();
    expect(screen.getByText("No projects running?")).toBeTruthy();
    expect(screen.getByText("renre-kit init")).toBeTruthy();
    expect(screen.getByText("renre-kit start")).toBeTruthy();
  });

  it("renders project cards when projects exist", () => {
    useProjectStore.setState({
      projects: [
        {
          id: "proj-1",
          name: "My Project",
          path: "/tmp/my-project",
          extensionCount: 2,
          mountedExtensions: [
            { name: "ext-a", version: "1.0.0", status: "healthy" },
          ],
        },
      ],
    });
    renderPage();
    expect(screen.getByText("My Project")).toBeTruthy();
  });

  it("renders multiple project cards", () => {
    useProjectStore.setState({
      projects: [
        {
          id: "proj-1",
          name: "Project Alpha",
          path: "/tmp/alpha",
          extensionCount: 1,
          mountedExtensions: [],
        },
        {
          id: "proj-2",
          name: "Project Beta",
          path: "/tmp/beta",
          extensionCount: 0,
          mountedExtensions: [],
        },
      ],
    });
    renderPage();
    expect(screen.getByText("Project Alpha")).toBeTruthy();
    expect(screen.getByText("Project Beta")).toBeTruthy();
  });
});
