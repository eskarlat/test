import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { useSearchStore } from "../stores/search-store";

// Mock API client
vi.mock("../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
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

const { default: SearchPage } = await import("./search");

function renderWithRouter(path = "/proj-1/search") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path=":projectId/search" element={<SearchPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("SearchPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSearchStore.setState({
      query: "",
      results: [],
      loading: false,
      error: null,
      activeFilters: [],
    });
  });

  it("renders page heading", () => {
    renderWithRouter();
    // "Search" appears in both breadcrumb and heading, so use getAllByText
    const searchElements = screen.getAllByText("Search");
    expect(searchElements.length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText(
        "Full-text search across sessions, observations, prompts, and errors",
      ),
    ).toBeTruthy();
  });

  it("renders search input", () => {
    renderWithRouter();
    expect(screen.getByPlaceholderText("Search everything...")).toBeTruthy();
  });

  it("shows start searching empty state when query is empty", () => {
    renderWithRouter();
    expect(screen.getByText("Start searching")).toBeTruthy();
    expect(
      screen.getByText(
        "Type a query above to search across all intelligence data.",
      ),
    ).toBeTruthy();
  });

  it("renders filter labels for all tables", () => {
    renderWithRouter();
    expect(screen.getByText("Sessions")).toBeTruthy();
    expect(screen.getByText("Observations")).toBeTruthy();
    expect(screen.getByText("Prompts")).toBeTruthy();
    expect(screen.getByText("Error Patterns")).toBeTruthy();
  });

  it("shows loading state", () => {
    useSearchStore.setState({ query: "test", loading: true });
    renderWithRouter();
    expect(screen.getByText("Searching...")).toBeTruthy();
  });

  it("shows error state", () => {
    useSearchStore.setState({ query: "test", error: "Search failed" });
    renderWithRouter();
    expect(screen.getByText("Search failed")).toBeTruthy();
  });

  it("shows no results message", () => {
    useSearchStore.setState({ query: "nonexistent", results: [], loading: false });
    renderWithRouter();
    expect(screen.getByText("No results")).toBeTruthy();
  });

  it("renders search results grouped by table", () => {
    useSearchStore.setState({
      query: "test",
      results: [
        {
          table: "observations",
          id: "o-1",
          projectId: "proj-1",
          preview: "Test observation content",
          createdAt: "2025-01-01T00:00:00Z",
        },
        {
          table: "prompts",
          id: "p-1",
          projectId: "proj-1",
          preview: "Test prompt content",
          createdAt: "2025-01-02T00:00:00Z",
        },
      ],
      loading: false,
    });
    renderWithRouter();
    expect(screen.getByText(/Observations \(1\)/)).toBeTruthy();
    expect(screen.getByText(/Prompts \(1\)/)).toBeTruthy();
  });

  it("renders breadcrumbs", () => {
    renderWithRouter();
    expect(screen.getByText("Dashboard")).toBeTruthy();
  });

  it("returns null when no projectId", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<SearchPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe("");
  });
});
