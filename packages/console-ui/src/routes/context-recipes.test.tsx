import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { useContextRecipeStore, type ProviderConfig } from "../stores/context-recipe-store";
import { useNotificationStore } from "../stores/notification-store";

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

const { default: ContextRecipesPage } = await import("./context-recipes");

function renderWithRouter(path = "/proj-1/context-recipes") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path=":projectId/context-recipes" element={<ContextRecipesPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function makeProvider(overrides: Partial<ProviderConfig> = {}): ProviderConfig {
  return {
    id: "prov-1",
    name: "Git Context",
    description: "Recent git history",
    enabled: true,
    estimatedTokens: 2000,
    config: {},
    ...overrides,
  };
}

describe("ContextRecipesPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    useContextRecipeStore.setState({
      providers: [],
      tokenBudget: 8000,
      preview: null,
      previewLoading: false,
      loading: false,
      error: null,
      fetchRecipe: vi.fn().mockResolvedValue(undefined),
      saveRecipe: vi.fn().mockResolvedValue(undefined),
      fetchPreview: vi.fn().mockResolvedValue(undefined),
    });
    useNotificationStore.setState({
      toasts: [],
      addToast: vi.fn(),
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when no projectId", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ContextRecipesPage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders page header with title and description", () => {
    renderWithRouter();
    expect(screen.getAllByText("Context Recipes").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Configure what context is provided to agent sessions")).toBeTruthy();
  });

  it("renders breadcrumbs", () => {
    renderWithRouter();
    expect(screen.getByText("Dashboard")).toBeTruthy();
  });

  it("shows loading state", () => {
    useContextRecipeStore.setState({ loading: true });
    renderWithRouter();
    expect(screen.getByText("Loading context recipe...")).toBeTruthy();
  });

  it("shows error state", () => {
    useContextRecipeStore.setState({ error: "Server error" });
    renderWithRouter();
    expect(screen.getByText("Server error")).toBeTruthy();
  });

  it("shows empty state when no providers", () => {
    renderWithRouter();
    expect(screen.getByText("No providers configured")).toBeTruthy();
    expect(screen.getByText("Context providers will appear here once the worker is running.")).toBeTruthy();
  });

  it("renders provider list when providers exist", () => {
    useContextRecipeStore.setState({
      providers: [
        makeProvider({ id: "p1", name: "Git Context" }),
        makeProvider({ id: "p2", name: "File Tree", estimatedTokens: 3000 }),
      ],
    });
    renderWithRouter();
    expect(screen.getByText("Git Context")).toBeTruthy();
    expect(screen.getByText("File Tree")).toBeTruthy();
    expect(screen.getByText("Context Providers")).toBeTruthy();
  });

  it("displays provider description", () => {
    useContextRecipeStore.setState({
      providers: [makeProvider({ description: "Shows recent commits" })],
    });
    renderWithRouter();
    expect(screen.getByText("Shows recent commits")).toBeTruthy();
  });

  it("displays estimated tokens for each provider", () => {
    useContextRecipeStore.setState({
      providers: [makeProvider({ estimatedTokens: 2000 })],
    });
    renderWithRouter();
    expect(screen.getByText("~2,000 tokens")).toBeTruthy();
  });

  it("renders token budget input with default value", () => {
    useContextRecipeStore.setState({
      providers: [makeProvider()],
      tokenBudget: 8000,
    });
    renderWithRouter();
    expect(screen.getByText("Token Budget")).toBeTruthy();
    expect(screen.getByDisplayValue("8000")).toBeTruthy();
  });

  it("shows budget percentage for enabled providers", () => {
    useContextRecipeStore.setState({
      providers: [
        makeProvider({ id: "p1", enabled: true, estimatedTokens: 4000 }),
        makeProvider({ id: "p2", enabled: true, estimatedTokens: 2000 }),
      ],
      tokenBudget: 10000,
    });
    renderWithRouter();
    // 6000/10000 = 60%
    expect(screen.getByText("60.0% of budget")).toBeTruthy();
    expect(screen.getByText("Estimated: 6,000 tokens")).toBeTruthy();
  });

  it("excludes disabled providers from budget calculation", () => {
    useContextRecipeStore.setState({
      providers: [
        makeProvider({ id: "p1", enabled: true, estimatedTokens: 2000 }),
        makeProvider({ id: "p2", enabled: false, estimatedTokens: 5000 }),
      ],
      tokenBudget: 8000,
    });
    renderWithRouter();
    // Only 2000/8000 = 25%
    expect(screen.getByText("25.0% of budget")).toBeTruthy();
  });

  it("toggles provider enabled state and triggers debounced save", async () => {
    const saveRecipe = vi.fn().mockResolvedValue(undefined);
    useContextRecipeStore.setState({
      providers: [makeProvider({ id: "p1", name: "Git Context", enabled: true })],
      saveRecipe,
    });
    renderWithRouter();
    const checkbox = screen.getByLabelText("Git Context");
    fireEvent.click(checkbox);

    // Advance past debounce timer
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(saveRecipe).toHaveBeenCalledWith(
      "proj-1",
      expect.arrayContaining([expect.objectContaining({ id: "p1", enabled: false })]),
      8000,
    );
  });

  it("shows Configure button for providers with config", () => {
    useContextRecipeStore.setState({
      providers: [makeProvider({ config: { maxDepth: 3 } })],
    });
    renderWithRouter();
    expect(screen.getByText("Configure")).toBeTruthy();
  });

  it("does not show Configure button for providers without config", () => {
    useContextRecipeStore.setState({
      providers: [makeProvider({ config: {} })],
    });
    renderWithRouter();
    expect(screen.queryByText("Configure")).toBeNull();
  });

  it("expands config editor when Configure is clicked", () => {
    useContextRecipeStore.setState({
      providers: [makeProvider({ config: { maxDepth: 3 } })],
    });
    renderWithRouter();
    fireEvent.click(screen.getByText("Configure"));
    expect(screen.getByText("Provider Config (JSON)")).toBeTruthy();
    expect(screen.getByText("Apply")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  it("shows config error for invalid JSON", () => {
    useContextRecipeStore.setState({
      providers: [makeProvider({ config: { maxDepth: 3 } })],
    });
    renderWithRouter();
    fireEvent.click(screen.getByText("Configure"));
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: "not valid json" } });
    fireEvent.click(screen.getByText("Apply"));
    expect(screen.getByText("Invalid JSON")).toBeTruthy();
  });

  it("applies valid JSON config", async () => {
    const saveRecipe = vi.fn().mockResolvedValue(undefined);
    useContextRecipeStore.setState({
      providers: [makeProvider({ config: { maxDepth: 3 } })],
      saveRecipe,
    });
    renderWithRouter();
    fireEvent.click(screen.getByText("Configure"));
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: '{"maxDepth": 5}' } });
    fireEvent.click(screen.getByText("Apply"));

    // Config editor should close (no more "Invalid JSON")
    expect(screen.queryByText("Invalid JSON")).toBeNull();

    // Debounced save should fire
    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(saveRecipe).toHaveBeenCalledWith(
      "proj-1",
      expect.arrayContaining([expect.objectContaining({ config: { maxDepth: 5 } })]),
      8000,
    );
  });

  it("closes config editor on Cancel without saving", () => {
    useContextRecipeStore.setState({
      providers: [makeProvider({ config: { maxDepth: 3 } })],
    });
    renderWithRouter();
    fireEvent.click(screen.getByText("Configure"));
    expect(screen.getByText("Provider Config (JSON)")).toBeTruthy();

    // Modify and cancel
    const textarea = screen.getByRole("textbox");
    fireEvent.change(textarea, { target: { value: '{"maxDepth": 99}' } });
    fireEvent.click(screen.getByText("Cancel"));

    // Config editor should be closed
    expect(screen.queryByText("Provider Config (JSON)")).toBeNull();
  });

  it("renders Reset button and calls fetchRecipe on click", () => {
    const fetchRecipe = vi.fn().mockResolvedValue(undefined);
    useContextRecipeStore.setState({ fetchRecipe });
    renderWithRouter();
    fireEvent.click(screen.getByText("Reset"));
    expect(fetchRecipe).toHaveBeenCalledWith("proj-1");
  });

  it("renders Preview Context button", () => {
    renderWithRouter();
    expect(screen.getByText("Preview Context")).toBeTruthy();
  });

  it("shows loading text on Preview button when previewLoading", () => {
    useContextRecipeStore.setState({ previewLoading: true });
    renderWithRouter();
    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("opens preview dialog when preview is fetched", async () => {
    const fetchPreview = vi.fn().mockImplementation(async () => {
      useContextRecipeStore.setState({ preview: "# Context\nSome content here" });
    });
    useContextRecipeStore.setState({ fetchPreview });
    renderWithRouter();

    await act(async () => {
      fireEvent.click(screen.getByText("Preview Context"));
    });

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Context Preview")).toBeTruthy();
    expect(screen.getByText(/# Context/)).toBeTruthy();
  });

  it("closes preview dialog when X button is clicked", async () => {
    const fetchPreview = vi.fn().mockImplementation(async () => {
      useContextRecipeStore.setState({ preview: "preview content" });
    });
    useContextRecipeStore.setState({ fetchPreview });
    renderWithRouter();

    await act(async () => {
      fireEvent.click(screen.getByText("Preview Context"));
    });

    expect(screen.getByRole("dialog")).toBeTruthy();

    // Click the X button in the preview dialog
    const dialog = screen.getByRole("dialog");
    const closeBtn = dialog.querySelector("button")!;
    fireEvent.click(closeBtn);

    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes preview dialog when clicking backdrop", async () => {
    const fetchPreview = vi.fn().mockImplementation(async () => {
      useContextRecipeStore.setState({ preview: "preview content" });
    });
    useContextRecipeStore.setState({ fetchPreview });
    renderWithRouter();

    await act(async () => {
      fireEvent.click(screen.getByText("Preview Context"));
    });

    const backdrop = screen.getByRole("dialog");
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("updates budget and triggers debounced save", async () => {
    const saveRecipe = vi.fn().mockResolvedValue(undefined);
    useContextRecipeStore.setState({
      providers: [makeProvider()],
      tokenBudget: 8000,
      saveRecipe,
    });
    renderWithRouter();
    const budgetInput = screen.getByDisplayValue("8000");
    fireEvent.change(budgetInput, { target: { value: "12000" } });

    await act(async () => {
      vi.advanceTimersByTime(600);
    });

    expect(saveRecipe).toHaveBeenCalledWith("proj-1", expect.any(Array), 12000);
  });

  it("calls fetchRecipe on mount", () => {
    const fetchRecipe = vi.fn().mockResolvedValue(undefined);
    useContextRecipeStore.setState({ fetchRecipe });
    renderWithRouter();
    expect(fetchRecipe).toHaveBeenCalledWith("proj-1");
  });
});
