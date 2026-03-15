import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
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

vi.mock("../../stores/connection-store", () => ({
  useConnectionStore: Object.assign(
    vi.fn((selector: (s: { status: string }) => unknown) =>
      selector({ status: "connected" }),
    ),
    {
      getState: () => ({ status: "connected" }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

vi.mock("../../components/intelligence/SearchPalette", () => ({
  SearchPalette: () => <div data-testid="search-palette">search</div>,
}));

import { useProjectStore } from "../../stores/project-store";

const { Toolbar } = await import("./Toolbar");

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Toolbar", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({
      activeProjectId: null,
      projects: [],
    });
  });

  function renderToolbar(onMenuToggle?: () => void) {
    return render(
      <MemoryRouter>
        <Toolbar onMenuToggle={onMenuToggle} />
      </MemoryRouter>,
    );
  }

  it("renders the toolbar header", () => {
    renderToolbar();
    expect(screen.getByLabelText("Select project")).toBeTruthy();
  });

  it("renders 'No project selected' option", () => {
    renderToolbar();
    expect(screen.getByText("No project selected")).toBeTruthy();
  });

  it("renders project options when projects exist", () => {
    useProjectStore.setState({
      projects: [
        { id: "p1", name: "Project One", path: "/p1", extensionCount: 0, mountedExtensions: [] },
        { id: "p2", name: "Project Two", path: "/p2", extensionCount: 1, mountedExtensions: [] },
      ],
    });
    renderToolbar();
    expect(screen.getByText("Project One")).toBeTruthy();
    expect(screen.getByText("Project Two")).toBeTruthy();
  });

  it("renders Vault link", () => {
    renderToolbar();
    expect(screen.getByLabelText("Vault")).toBeTruthy();
  });

  it("renders Settings link", () => {
    renderToolbar();
    expect(screen.getByLabelText("Settings")).toBeTruthy();
  });

  it("renders theme toggle button", () => {
    renderToolbar();
    expect(screen.getByLabelText("Toggle theme")).toBeTruthy();
  });

  it("renders mobile menu button", () => {
    renderToolbar();
    expect(screen.getByLabelText("Toggle menu")).toBeTruthy();
  });

  it("renders search palette", () => {
    renderToolbar();
    expect(screen.getByTestId("search-palette")).toBeTruthy();
  });
});
