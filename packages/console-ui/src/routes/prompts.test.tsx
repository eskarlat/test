import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { usePromptStore, type Prompt } from "../stores/prompt-store";

// Mock API client
vi.mock("../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
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

const { default: PromptsPage } = await import("./prompts");

function renderWithRouter(path = "/proj-1/prompts") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path=":projectId/prompts" element={<PromptsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function makePrompt(overrides: Partial<Prompt> = {}): Prompt {
  return {
    id: "p-1",
    projectId: "proj-1",
    agent: "copilot",
    intent: "code_generation",
    promptPreview: "Write a function to calculate fibonacci",
    tokenCount: 120,
    createdAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("PromptsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Override fetch methods to be no-ops so useEffect doesn't overwrite state
    usePromptStore.setState({
      prompts: [],
      stats: null,
      loading: false,
      error: null,
      filter: { intent: undefined, agent: undefined, dateFrom: undefined, dateTo: undefined, search: undefined },
      fetchPrompts: () => Promise.resolve(),
      fetchStats: () => Promise.resolve(),
    });
  });

  it("renders page header", () => {
    renderWithRouter();
    expect(screen.getByText("Prompt Journal")).toBeTruthy();
    expect(
      screen.getByText("Recorded prompts from agent sessions"),
    ).toBeTruthy();
  });

  it("shows empty state when no prompts", () => {
    renderWithRouter();
    expect(screen.getByText("No prompts found")).toBeTruthy();
    expect(
      screen.getByText("Prompts are recorded from agent sessions."),
    ).toBeTruthy();
  });

  it("renders prompts list", async () => {
    usePromptStore.setState({
      prompts: [
        makePrompt({ id: "p-1", promptPreview: "Write fibonacci function" }),
        makePrompt({ id: "p-2", promptPreview: "Fix bug in auth module", agent: "claude" }),
      ],
    });
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("Write fibonacci function")).toBeTruthy();
      expect(screen.getByText("Fix bug in auth module")).toBeTruthy();
    });
  });

  it("shows loading state", () => {
    usePromptStore.setState({ loading: true });
    renderWithRouter();
    expect(screen.getByText("Loading prompts...")).toBeTruthy();
  });

  it("shows error state", () => {
    usePromptStore.setState({ error: "Request failed", loading: false });
    renderWithRouter();
    expect(screen.getByText("Request failed")).toBeTruthy();
  });

  it("renders stats cards when stats available", () => {
    usePromptStore.setState({
      stats: {
        total: 42,
        byIntent: { code_generation: 30, debugging: 12 },
        byAgent: { copilot: 25, claude: 17 },
      },
    });
    renderWithRouter();
    expect(screen.getByText("Total Prompts")).toBeTruthy();
    expect(screen.getByText("42")).toBeTruthy();
    expect(screen.getByText("Intents")).toBeTruthy();
    expect(screen.getByText("Agents")).toBeTruthy();
  });

  it("renders search input", () => {
    renderWithRouter();
    expect(screen.getByPlaceholderText("Search prompts...")).toBeTruthy();
  });

  it("renders agent filter input", () => {
    renderWithRouter();
    expect(screen.getByPlaceholderText("Filter agent...")).toBeTruthy();
  });

  it("shows prompt count", () => {
    renderWithRouter();
    expect(screen.getByText("0 prompts")).toBeTruthy();
  });

  it("renders breadcrumbs", () => {
    renderWithRouter();
    expect(screen.getByText("Dashboard")).toBeTruthy();
  });

  it("returns null when no projectId", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<PromptsPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe("");
  });
});
