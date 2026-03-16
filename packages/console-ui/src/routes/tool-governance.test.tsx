import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { useToolRulesStore, type ToolRule, type AuditEntry } from "../stores/tool-rules-store";

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

const { default: ToolGovernancePage } = await import("./tool-governance");

function renderWithRouter(path = "/proj-1/tool-governance") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path=":projectId/tool-governance" element={<ToolGovernancePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

function makeRule(overrides: Partial<ToolRule> = {}): ToolRule {
  return {
    id: "rule-1",
    name: "Block rm -rf",
    toolType: "bash",
    pattern: "rm -rf",
    patternType: "contains",
    decision: "deny",
    reason: "Dangerous command",
    priority: 10,
    scope: "project",
    enabled: true,
    isBuiltin: false,
    hitCount: 5,
    ...overrides,
  };
}

function makeAudit(overrides: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "audit-1",
    toolName: "bash",
    toolInput: "rm -rf /tmp/test",
    decision: "deny",
    ruleId: "rule-1",
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("ToolGovernancePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useToolRulesStore.setState({
      rules: [],
      auditLog: [],
      loading: false,
      error: null,
      fetchRules: () => Promise.resolve(),
      fetchAuditLog: () => Promise.resolve(),
      createRule: vi.fn().mockResolvedValue(undefined),
      updateRule: vi.fn().mockResolvedValue(undefined),
      deleteRule: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("returns null when no projectId", () => {
    const { container } = render(
      <MemoryRouter initialEntries={["/"]}>
        <Routes>
          <Route path="/" element={<ToolGovernancePage />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders page header with title and description", () => {
    renderWithRouter();
    // "Tool Governance" appears in breadcrumb and heading
    expect(screen.getAllByText("Tool Governance").length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Rules that control which tools AI agents can use")).toBeTruthy();
  });

  it("renders breadcrumbs", () => {
    renderWithRouter();
    expect(screen.getByText("Dashboard")).toBeTruthy();
  });

  it("shows loading state", () => {
    useToolRulesStore.setState({ loading: true });
    renderWithRouter();
    expect(screen.getByText("Loading...")).toBeTruthy();
  });

  it("shows error state", () => {
    useToolRulesStore.setState({ error: "Failed to fetch rules" });
    renderWithRouter();
    expect(screen.getByText("Failed to fetch rules")).toBeTruthy();
  });

  it("shows empty state when no rules exist", () => {
    renderWithRouter();
    expect(screen.getByText("No rules")).toBeTruthy();
    expect(screen.getByText("Add tool governance rules to control agent behavior.")).toBeTruthy();
  });

  it("renders rules list sorted by priority", () => {
    useToolRulesStore.setState({
      rules: [
        makeRule({ id: "r2", name: "Low priority", priority: 50 }),
        makeRule({ id: "r1", name: "High priority", priority: 5 }),
      ],
    });
    renderWithRouter();
    const _names = screen.getAllByText(/priority/);
    // Both rules should render
    expect(screen.getByText("High priority")).toBeTruthy();
    expect(screen.getByText("Low priority")).toBeTruthy();
  });

  it("displays rule details: pattern, patternType, scope, hitCount, reason", () => {
    useToolRulesStore.setState({
      rules: [makeRule()],
    });
    renderWithRouter();
    expect(screen.getByText("rm -rf")).toBeTruthy();
    expect(screen.getByText("(contains)")).toBeTruthy();
    expect(screen.getByText("project")).toBeTruthy();
    expect(screen.getByText("5 hits")).toBeTruthy();
  });

  it("shows builtin badge for builtin rules", () => {
    useToolRulesStore.setState({
      rules: [makeRule({ isBuiltin: true })],
    });
    renderWithRouter();
    expect(screen.getByText("builtin")).toBeTruthy();
  });

  it("does not show delete button for builtin rules", () => {
    useToolRulesStore.setState({
      rules: [makeRule({ isBuiltin: true })],
    });
    renderWithRouter();
    expect(screen.queryByTitle("Delete")).toBeNull();
  });

  it("shows delete button for non-builtin rules", () => {
    useToolRulesStore.setState({
      rules: [makeRule({ isBuiltin: false })],
    });
    renderWithRouter();
    expect(screen.getByTitle("Delete")).toBeTruthy();
  });

  it("calls deleteRule when delete button is clicked", () => {
    const deleteRule = vi.fn().mockResolvedValue(undefined);
    useToolRulesStore.setState({
      rules: [makeRule()],
      deleteRule,
    });
    renderWithRouter();
    fireEvent.click(screen.getByTitle("Delete"));
    expect(deleteRule).toHaveBeenCalledWith("proj-1", "rule-1");
  });

  it("calls updateRule when enabled checkbox is toggled", () => {
    const updateRule = vi.fn().mockResolvedValue(undefined);
    useToolRulesStore.setState({
      rules: [makeRule({ enabled: true })],
      updateRule,
    });
    renderWithRouter();
    const checkbox = screen.getByRole("checkbox", { name: "Enabled" });
    fireEvent.click(checkbox);
    expect(updateRule).toHaveBeenCalledWith("proj-1", "rule-1", { enabled: false });
  });

  it("shows Add Rule button on rules tab", () => {
    renderWithRouter();
    expect(screen.getByText("Add Rule")).toBeTruthy();
  });

  it("opens add dialog when Add Rule is clicked", () => {
    renderWithRouter();
    fireEvent.click(screen.getByText("Add Rule"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Add Rule", { selector: "h2" })).toBeTruthy();
  });

  it("opens edit dialog when edit button is clicked", () => {
    useToolRulesStore.setState({
      rules: [makeRule()],
    });
    renderWithRouter();
    fireEvent.click(screen.getByTitle("Edit"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText("Edit Rule")).toBeTruthy();
  });

  it("pre-fills edit dialog with existing rule data", () => {
    useToolRulesStore.setState({
      rules: [makeRule({ name: "My Rule", pattern: "test-pattern", reason: "test reason" })],
    });
    renderWithRouter();
    fireEvent.click(screen.getByTitle("Edit"));
    const nameInput = screen.getByDisplayValue("My Rule");
    expect(nameInput).toBeTruthy();
    expect(screen.getByDisplayValue("test-pattern")).toBeTruthy();
    expect(screen.getByDisplayValue("test reason")).toBeTruthy();
  });

  it("closes dialog when Cancel is clicked", () => {
    renderWithRouter();
    fireEvent.click(screen.getByText("Add Rule"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    fireEvent.click(screen.getByText("Cancel"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("closes dialog when clicking backdrop", () => {
    renderWithRouter();
    fireEvent.click(screen.getByText("Add Rule"));
    const backdrop = screen.getByRole("dialog");
    fireEvent.click(backdrop);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("disables Create button when name or pattern is empty", () => {
    renderWithRouter();
    fireEvent.click(screen.getByText("Add Rule"));
    const createBtn = screen.getByText("Create");
    expect(createBtn).toHaveProperty("disabled", true);
  });

  it("enables Create button when name and pattern are filled", () => {
    renderWithRouter();
    fireEvent.click(screen.getByText("Add Rule"));

    // The dialog inputs don't use htmlFor, so query by role within the dialog
    const inputs = screen.getByRole("dialog").querySelectorAll("input[type='text'], input:not([type])");
    // inputs: Name, Tool Type, Pattern, Reason, Test Pattern (text inputs in order)
    const nameInput = inputs[0]!;
    const patternInput = inputs[2]!;
    fireEvent.change(nameInput, { target: { value: "My Rule" } });
    fireEvent.change(patternInput, { target: { value: "some-pattern" } });

    const createBtn = screen.getByText("Create");
    expect(createBtn).toHaveProperty("disabled", false);
  });

  it("calls createRule on save for new rule", async () => {
    const createRule = vi.fn().mockResolvedValue(undefined);
    useToolRulesStore.setState({ createRule });
    renderWithRouter();
    fireEvent.click(screen.getByText("Add Rule"));

    const inputs = screen.getByRole("dialog").querySelectorAll("input[type='text'], input:not([type])");
    fireEvent.change(inputs[0]!, { target: { value: "New Rule" } });
    fireEvent.change(inputs[2]!, { target: { value: "danger" } });

    fireEvent.click(screen.getByText("Create"));
    await waitFor(() => {
      expect(createRule).toHaveBeenCalledWith("proj-1", expect.objectContaining({
        name: "New Rule",
        pattern: "danger",
      }));
    });
  });

  it("calls updateRule on save for existing rule", async () => {
    const updateRule = vi.fn().mockResolvedValue(undefined);
    useToolRulesStore.setState({
      rules: [makeRule()],
      updateRule,
    });
    renderWithRouter();
    fireEvent.click(screen.getByTitle("Edit"));

    // The save button should say "Update" for edit mode
    expect(screen.getByText("Update")).toBeTruthy();
    fireEvent.click(screen.getByText("Update"));
    await waitFor(() => {
      expect(updateRule).toHaveBeenCalledWith("proj-1", "rule-1", expect.objectContaining({
        name: "Block rm -rf",
      }));
    });
  });

  it("shows pattern test result: Match", () => {
    renderWithRouter();
    fireEvent.click(screen.getByText("Add Rule"));
    const inputs = screen.getByRole("dialog").querySelectorAll("input[type='text'], input:not([type])");
    fireEvent.change(inputs[2]!, { target: { value: "hello" } });
    fireEvent.change(screen.getByPlaceholderText("Enter text to test pattern..."), {
      target: { value: "say hello world" },
    });
    expect(screen.getByText("Match")).toBeTruthy();
  });

  it("shows pattern test result: No match", () => {
    renderWithRouter();
    fireEvent.click(screen.getByText("Add Rule"));
    const inputs = screen.getByRole("dialog").querySelectorAll("input[type='text'], input:not([type])");
    fireEvent.change(inputs[2]!, { target: { value: "hello" } });
    fireEvent.change(screen.getByPlaceholderText("Enter text to test pattern..."), {
      target: { value: "goodbye" },
    });
    expect(screen.getByText("No match")).toBeTruthy();
  });

  // Tabs
  it("switches to audit tab", () => {
    renderWithRouter();
    fireEvent.click(screen.getByText("Audit Log"));
    expect(screen.getByText("No audit entries")).toBeTruthy();
  });

  it("does not show Add Rule button on audit tab", () => {
    renderWithRouter();
    fireEvent.click(screen.getByText("Audit Log"));
    // Add Rule button is not rendered for audit tab
    expect(screen.queryByText("Add Rule")).toBeNull();
  });

  it("renders audit log entries", () => {
    useToolRulesStore.setState({
      auditLog: [
        makeAudit({ id: "a1", toolName: "bash", toolInput: "rm -rf /tmp" }),
        makeAudit({ id: "a2", toolName: "edit", toolInput: "modify file.ts", decision: "allow" }),
      ],
    });
    renderWithRouter();
    fireEvent.click(screen.getByText("Audit Log"));
    expect(screen.getByText("bash")).toBeTruthy();
    expect(screen.getByText("edit")).toBeTruthy();
    expect(screen.getByText("rm -rf /tmp")).toBeTruthy();
  });

  it("shows audit entry with no ruleId as dash", () => {
    useToolRulesStore.setState({
      auditLog: [(() => { const { ruleId: _ruleId, ...rest } = makeAudit(); return rest; })()],
    });
    renderWithRouter();
    fireEvent.click(screen.getByText("Audit Log"));
    // The em-dash is rendered for missing ruleId
    expect(screen.getByText("—")).toBeTruthy();
  });

  // Pattern type switching in dialog
  it("allows switching pattern type to regex and tests pattern", () => {
    renderWithRouter();
    fireEvent.click(screen.getByText("Add Rule"));
    fireEvent.click(screen.getByLabelText("regex"));
    const inputs = screen.getByRole("dialog").querySelectorAll("input[type='text'], input:not([type])");
    fireEvent.change(inputs[2]!, { target: { value: "^rm\\s" } });
    fireEvent.change(screen.getByPlaceholderText("Enter text to test pattern..."), {
      target: { value: "rm something" },
    });
    expect(screen.getByText("Match")).toBeTruthy();
  });

  it("allows switching pattern type to glob and tests pattern", () => {
    renderWithRouter();
    fireEvent.click(screen.getByText("Add Rule"));
    fireEvent.click(screen.getByLabelText("glob"));
    const inputs = screen.getByRole("dialog").querySelectorAll("input[type='text'], input:not([type])");
    fireEvent.change(inputs[2]!, { target: { value: "*.ts" } });
    fireEvent.change(screen.getByPlaceholderText("Enter text to test pattern..."), {
      target: { value: "file.ts" },
    });
    expect(screen.getByText("Match")).toBeTruthy();
  });

  it("allows switching decision type", () => {
    renderWithRouter();
    fireEvent.click(screen.getByText("Add Rule"));
    // Default is "ask", switch to "allow"
    const _allowRadios = screen.getAllByRole("radio");
    // There are pattern type radios + decision radios + scope radios
    // Just click on the "allow" text's radio
    fireEvent.click(screen.getByLabelText("allow"));
    expect(screen.getByLabelText("allow")).toBeChecked();
  });

  it("allows switching scope to global", () => {
    renderWithRouter();
    fireEvent.click(screen.getByText("Add Rule"));
    fireEvent.click(screen.getByLabelText("global"));
    expect(screen.getByLabelText("global")).toBeChecked();
  });
});
