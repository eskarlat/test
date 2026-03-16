import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { useObservationStore, type Observation } from "../stores/observation-store";

// Mock API client
vi.mock("../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  apiPost: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  apiPut: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
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

const { default: ObservationsPage } = await import("./observations");

function renderWithRouter(path = "/proj-1/observations") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path=":projectId/observations" element={<ObservationsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function makeObs(overrides: Partial<Observation> = {}): Observation {
  return {
    id: "obs-1",
    projectId: "proj-1",
    content: "User prefers TypeScript",
    category: "preference",
    confidence: 0.85,
    source: "hook",
    active: true,
    injectionCount: 3,
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ObservationsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Override fetch method to be a no-op so useEffect doesn't overwrite state
    useObservationStore.setState({
      observations: [],
      loading: false,
      error: null,
      filter: { category: undefined, confidence: undefined, source: undefined, showArchived: undefined },
      fetchObservations: () => Promise.resolve(),
    });
  });

  it("renders page header", () => {
    renderWithRouter();
    // "Observations" appears in both breadcrumb and heading
    const elements = screen.getAllByText("Observations");
    expect(elements.length).toBeGreaterThanOrEqual(1);
    expect(
      screen.getByText("Persistent context injected into agent sessions"),
    ).toBeTruthy();
  });

  it("shows empty state when no observations", () => {
    renderWithRouter();
    expect(screen.getByText("No observations")).toBeTruthy();
    expect(
      screen.getByText("Add observations to give persistent context to agent sessions."),
    ).toBeTruthy();
  });

  it("renders observations list", async () => {
    useObservationStore.setState({
      observations: [
        makeObs({ id: "obs-1", content: "User prefers TypeScript", category: "preference" }),
        makeObs({ id: "obs-2", content: "Always run tests", category: "workflow" }),
      ],
    });
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("User prefers TypeScript")).toBeTruthy();
      expect(screen.getByText("Always run tests")).toBeTruthy();
    });
  });

  it("shows loading state", () => {
    useObservationStore.setState({ loading: true });
    renderWithRouter();
    expect(screen.getByText("Loading observations...")).toBeTruthy();
  });

  it("shows error state", () => {
    useObservationStore.setState({ error: "Server error", loading: false });
    renderWithRouter();
    expect(screen.getByText("Server error")).toBeTruthy();
  });

  it("renders Add Observation button", () => {
    renderWithRouter();
    expect(screen.getByText("Add Observation")).toBeTruthy();
  });

  it("renders search input", () => {
    renderWithRouter();
    expect(screen.getByPlaceholderText("Search observations...")).toBeTruthy();
  });

  it("renders category filter select", () => {
    renderWithRouter();
    expect(screen.getByText("All categories")).toBeTruthy();
  });

  it("renders breadcrumbs", () => {
    renderWithRouter();
    expect(screen.getByText("Dashboard")).toBeTruthy();
  });

  it("shows suggested banner for low confidence observations", () => {
    useObservationStore.setState({
      observations: [
        makeObs({ id: "obs-1", confidence: 0.3 }),
      ],
    });
    renderWithRouter();
    expect(
      screen.getByText(/1 suggested observation.* with low/),
    ).toBeTruthy();
  });

  it("returns null when no projectId", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ObservationsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe("");
  });
});
