import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router";
import { useAutomationStore } from "../stores/automation-store";

// Mock modules
vi.mock("../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: [], error: null, status: 200 }),
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

vi.mock("../stores/notification-store", () => {
  const addToastMock = vi.fn();
  return {
    useNotificationStore: Object.assign(
      vi.fn((selector: (s: { addToast: (...args: unknown[]) => void }) => unknown) =>
        selector({ addToast: addToastMock }),
      ),
      {
        getState: () => ({ addToast: addToastMock }),
        subscribe: vi.fn(),
        setState: vi.fn(),
        _addToastMock: addToastMock,
      },
    ),
  };
});

// Must import lazily after mocks
const { default: AutomationEditorPage } = await import("./automation-editor");

const defaultModels = [
  { id: "claude-3-opus", name: "Claude 3 Opus" },
  { id: "claude-3-sonnet", name: "Claude 3 Sonnet" },
];

function renderEditor(initialEntry = "/proj-1/automations/new") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path=":projectId/automations/new" element={<AutomationEditorPage />} />
        <Route path=":projectId/automations/:id/edit" element={<AutomationEditorPage />} />
        <Route path=":projectId/automations" element={<div>Automations List</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("AutomationEditorPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useAutomationStore.setState({
      models: defaultModels,
      automations: [],
      extensionJobs: [],
      loading: false,
      error: null,
      runs: [],
      activeRun: null,
      runLoading: false,
      fetchModels: vi.fn(),
      createAutomation: vi.fn().mockResolvedValue({
        id: "auto-1",
        projectId: "proj-1",
        name: "Test",
        enabled: true,
        schedule: { type: "manual" },
        chain: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
      updateAutomation: vi.fn().mockResolvedValue({
        id: "auto-1",
        projectId: "proj-1",
        name: "Test",
        enabled: true,
        schedule: { type: "manual" },
        chain: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }),
    });
  });

  // -----------------------------------------------------------------------
  // 1. Renders all sections
  // -----------------------------------------------------------------------
  it("renders all sections (Name, Schedule, Worktree, System Prompt, Chain)", () => {
    renderEditor();

    // Title
    expect(screen.getByText("New Automation")).toBeTruthy();

    // Name & Description section — check for the labels
    expect(screen.getByLabelText(/^Name/)).toBeTruthy();
    expect(screen.getByLabelText("Description")).toBeTruthy();

    // Schedule section heading
    expect(screen.getByText("Schedule")).toBeTruthy();

    // Worktree section heading
    expect(screen.getByText("Worktree Isolation")).toBeTruthy();

    // System Prompt section heading
    expect(screen.getByText("System Prompt")).toBeTruthy();

    // Variables section heading
    expect(screen.getByText("Variables")).toBeTruthy();

    // Prompt Chain section heading (contains * so we look for the text inside)
    expect(screen.getByText(/Prompt Chain/)).toBeTruthy();

    // Max Duration section heading
    expect(screen.getByText("Max Duration")).toBeTruthy();

    // Save/Cancel actions
    expect(screen.getByText("Create Automation")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // 2. Default step is created when models load
  // -----------------------------------------------------------------------
  it("creates a default step when models are available", () => {
    renderEditor();

    // The default step should appear as "Step 1"
    expect(screen.getByText("Step 1")).toBeTruthy();

    // Step editor fields should be visible: Step Name, Prompt, Model, etc.
    expect(screen.getByText("Step Name")).toBeTruthy();
    expect(screen.getByText("Prompt")).toBeTruthy();
    expect(screen.getByText("Model")).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // 3. Add Step button adds a new step
  // -----------------------------------------------------------------------
  it("adds a step when 'Add Step' button is clicked", async () => {
    const user = userEvent.setup();
    renderEditor();

    // Initially there should be 1 default step
    expect(screen.getByText("Step 1")).toBeTruthy();

    const addBtn = screen.getByRole("button", { name: /Add Step/i });
    await user.click(addBtn);

    // Now there should be 2 steps
    expect(screen.getByText("Step 1")).toBeTruthy();
    expect(screen.getByText("Step 2")).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // 4. Remove step removes it
  // -----------------------------------------------------------------------
  it("removes a step when remove button is clicked", async () => {
    const user = userEvent.setup();
    renderEditor();

    // Add a second step first
    const addBtn = screen.getByRole("button", { name: /Add Step/i });
    await user.click(addBtn);

    expect(screen.getByText("Step 1")).toBeTruthy();
    expect(screen.getByText("Step 2")).toBeTruthy();

    // Find the remove buttons (trash icon buttons). With 2 steps, each step should
    // have a remove button (totalSteps > 1).
    const removeButtons = screen.getAllByTitle("Remove step");
    expect(removeButtons.length).toBe(2);

    // Click the first remove button to remove step 1
    await user.click(removeButtons[0]!);

    // Now only 1 step should remain, and the remove button should disappear
    // (because totalSteps is now 1)
    const remainingSteps = screen.getAllByText(/^Step \d+/);
    expect(remainingSteps.length).toBe(1);
    expect(screen.getByText("Step 1")).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // 5. Cron expression input appears when schedule type is cron
  // -----------------------------------------------------------------------
  it("shows cron expression input when schedule type is set to cron", async () => {
    const user = userEvent.setup();
    renderEditor();

    // Initially schedule type is "manual", so no cron input
    expect(screen.queryByLabelText("Cron Expression")).toBeNull();

    // Change schedule type to cron
    const scheduleTypeSelect = screen.getByLabelText("Type");
    await user.selectOptions(scheduleTypeSelect, "cron");

    // Now cron expression input should appear
    expect(screen.getByLabelText("Cron Expression")).toBeTruthy();

    // Timezone input should also appear
    expect(screen.getByLabelText("Timezone")).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // 6. Validation: name required — shows toast on save
  // -----------------------------------------------------------------------
  it("shows validation error when name is empty on save", async () => {
    const user = userEvent.setup();
    // Get the addToast mock from the notification store mock
    const { useNotificationStore } = await import("../stores/notification-store");
    const addToastMock = (useNotificationStore as unknown as { _addToastMock: ReturnType<typeof vi.fn> })._addToastMock;

    renderEditor();

    // Name field is empty by default. Click save.
    const saveBtn = screen.getByText("Create Automation");
    await user.click(saveBtn);

    // Validation should fire toast "Automation name is required"
    expect(addToastMock).toHaveBeenCalledWith("Automation name is required", "error");
  });

  // -----------------------------------------------------------------------
  // 7. Validation: step prompt required — shows toast
  // -----------------------------------------------------------------------
  it("shows validation error when a step has no prompt", async () => {
    const user = userEvent.setup();
    const { useNotificationStore } = await import("../stores/notification-store");
    const addToastMock = (useNotificationStore as unknown as { _addToastMock: ReturnType<typeof vi.fn> })._addToastMock;

    renderEditor();

    // Fill in name
    const nameInput = screen.getByLabelText(/^Name/);
    await user.type(nameInput, "My Automation");

    // The default step has an empty prompt. Click save.
    const saveBtn = screen.getByText("Create Automation");
    await user.click(saveBtn);

    // Should show toast about missing prompt
    expect(addToastMock).toHaveBeenCalledWith(
      expect.stringContaining("needs a prompt"),
      "error",
    );
  });

  // -----------------------------------------------------------------------
  // 8. Autopilot dialog appears on save for new automations
  // -----------------------------------------------------------------------
  it("shows autopilot dialog when saving a valid new automation", async () => {
    const user = userEvent.setup();
    renderEditor();

    // Fill in name
    const nameInput = screen.getByLabelText(/^Name/);
    await user.type(nameInput, "Nightly Review");

    // Fill in step prompt (find the textarea for prompt)
    const promptTextarea = screen.getByPlaceholderText(
      /Enter the prompt for this step/,
    );
    await user.type(promptTextarea, "Review all changes from today");

    // Click save
    const saveBtn = screen.getByText("Create Automation");
    await user.click(saveBtn);

    // Autopilot dialog should appear
    const dialog = screen.getByRole("dialog", { name: /Enable autopilot mode/i });
    expect(dialog).toBeTruthy();
    expect(screen.getByText("Enable Autopilot Mode")).toBeTruthy();
    expect(screen.getByText(/autopilot mode/i)).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // 9. Autopilot dialog confirm triggers createAutomation
  // -----------------------------------------------------------------------
  it("calls createAutomation after confirming autopilot dialog", async () => {
    const user = userEvent.setup();
    const createMock = vi.fn().mockResolvedValue({
      id: "auto-new",
      projectId: "proj-1",
      name: "Nightly Review",
      enabled: true,
      schedule: { type: "manual" },
      chain: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    useAutomationStore.setState({ createAutomation: createMock });

    renderEditor();

    // Fill in name
    const nameInput = screen.getByLabelText(/^Name/);
    await user.type(nameInput, "Nightly Review");

    // Fill in step prompt
    const promptTextarea = screen.getByPlaceholderText(
      /Enter the prompt for this step/,
    );
    await user.type(promptTextarea, "Review all changes");

    // Click save — autopilot dialog appears
    const saveBtn = screen.getByText("Create Automation");
    await user.click(saveBtn);

    // Click "Enable Autopilot" button in dialog
    const confirmBtn = screen.getByRole("button", { name: /Enable Autopilot/i });
    await user.click(confirmBtn);

    // createAutomation should have been called
    expect(createMock).toHaveBeenCalledWith(
      "proj-1",
      expect.objectContaining({
        name: "Nightly Review",
        schedule: expect.objectContaining({ type: "manual" }),
        chain: expect.arrayContaining([
          expect.objectContaining({ prompt: "Review all changes" }),
        ]),
      }),
    );
  });

  // -----------------------------------------------------------------------
  // 10. Loading state when editing existing automation
  // -----------------------------------------------------------------------
  it("shows loading state when editing an existing automation", async () => {
    // Set up apiGet to return a pending promise (never resolves during this test)
    const { apiGet } = await import("../api/client");
    (apiGet as ReturnType<typeof vi.fn>).mockReturnValue(new Promise(() => {}));

    renderEditor("/proj-1/automations/auto-1/edit");

    expect(screen.getByText("Loading automation...")).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // 11. Schedule type "once" shows Run At field
  // -----------------------------------------------------------------------
  it("shows 'Run At' input when schedule type is set to once", async () => {
    const user = userEvent.setup();
    renderEditor();

    expect(screen.queryByLabelText("Run At")).toBeNull();

    const scheduleTypeSelect = screen.getByLabelText("Type");
    await user.selectOptions(scheduleTypeSelect, "once");

    expect(screen.getByLabelText("Run At")).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // 12. Worktree fields appear when checkbox is enabled
  // -----------------------------------------------------------------------
  it("shows worktree configuration fields when worktree isolation is enabled", async () => {
    const user = userEvent.setup();
    renderEditor();

    // Worktree fields should not be visible initially
    expect(screen.queryByLabelText("Branch")).toBeNull();
    expect(screen.queryByLabelText("Cleanup Policy")).toBeNull();

    // Enable worktree isolation
    const worktreeCheckbox = screen.getByLabelText("Enable worktree isolation");
    await user.click(worktreeCheckbox);

    // Now branch and cleanup policy fields should appear
    expect(screen.getByLabelText("Branch")).toBeTruthy();
    expect(screen.getByLabelText("Cleanup Policy")).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // 13. Move step up/down reorders steps
  // -----------------------------------------------------------------------
  it("reorders steps when move up/down buttons are clicked", async () => {
    const user = userEvent.setup();
    renderEditor();

    // Add a second step
    const addBtn = screen.getByRole("button", { name: /Add Step/i });
    await user.click(addBtn);

    // Give names to the steps to distinguish them
    const stepNameInputs = screen.getAllByPlaceholderText("e.g., Analyze code quality");
    await user.type(stepNameInputs[0]!, "First");
    await user.type(stepNameInputs[1]!, "Second");

    // Verify initial order
    expect(screen.getByText("Step 1: First")).toBeTruthy();
    expect(screen.getByText("Step 2: Second")).toBeTruthy();

    // Click "Move down" on step 1 (the first step's move-down button)
    const moveDownButtons = screen.getAllByTitle("Move down");
    await user.click(moveDownButtons[0]!);

    // After moving, "First" should now be step 2 and "Second" should be step 1
    expect(screen.getByText("Step 1: Second")).toBeTruthy();
    expect(screen.getByText("Step 2: First")).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // 14. Edit mode renders "Edit Automation" title and "Update Automation" button
  // -----------------------------------------------------------------------
  it("shows edit mode title and update button when editing", async () => {
    const { apiGet } = await import("../api/client");
    (apiGet as ReturnType<typeof vi.fn>).mockResolvedValue({
      data: {
        id: "auto-1",
        projectId: "proj-1",
        name: "Existing Automation",
        description: "Existing desc",
        enabled: true,
        schedule: { type: "manual" },
        chain: [
          {
            id: "step-1",
            name: "Step one",
            prompt: "Do something",
            model: "claude-3-opus",
            tools: { builtIn: true, extensions: "all", mcp: "all" },
            onError: "stop",
          },
        ],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
      error: null,
      status: 200,
    });

    renderEditor("/proj-1/automations/auto-1/edit");

    // Wait for loading to finish and "Edit Automation" to appear
    expect(await screen.findByText("Edit Automation")).toBeTruthy();
    expect(screen.getByText("Update Automation")).toBeTruthy();
  });

  // -----------------------------------------------------------------------
  // 15. Help button opens help drawer
  // -----------------------------------------------------------------------
  it("opens help drawer when Help button is clicked", async () => {
    const user = userEvent.setup();
    renderEditor();

    const helpBtn = screen.getByRole("button", { name: /Help/i });
    await user.click(helpBtn);

    // HelpDrawer should open — it has a dialog with aria-label "Automation help"
    expect(screen.getByRole("dialog", { name: /Automation help/i })).toBeTruthy();
    expect(screen.getByText("Automation Help")).toBeTruthy();
  });
});
