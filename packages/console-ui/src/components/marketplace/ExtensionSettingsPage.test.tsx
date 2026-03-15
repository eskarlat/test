import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockApiGet = vi.fn().mockResolvedValue({ data: null, error: null, status: 200 });
const mockApiPut = vi.fn().mockResolvedValue({ data: null, error: null, status: 200 });

vi.mock("../../api/client", () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
  apiPut: (...args: unknown[]) => mockApiPut(...args),
  BASE_URL: "http://localhost:42888",
}));

const mockConnectionStoreState: Record<string, unknown> = {
  status: "connected",
};

vi.mock("../../stores/connection-store", () => ({
  useConnectionStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockConnectionStoreState),
    { setState: vi.fn(), getState: () => mockConnectionStoreState },
  ),
}));

const mockNotificationStoreState = {
  addToast: vi.fn(),
};

vi.mock("../../stores/notification-store", () => ({
  useNotificationStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockNotificationStoreState),
    { setState: vi.fn(), getState: () => mockNotificationStoreState },
  ),
}));

vi.mock("./VaultKeyPicker", () => ({
  VaultKeyPicker: ({ id, value, onChange }: { id: string; value: string; onChange: (v: string) => void }) => (
    <input data-testid={`vault-picker-${id}`} value={value} onChange={(e) => onChange(e.target.value)} />
  ),
}));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual("react-router");
  return { ...actual, useNavigate: () => mockNavigate };
});

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import { ExtensionSettingsPage } from "./ExtensionSettingsPage";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderPage(projectId = "proj-1", extensionName = "my-ext") {
  return render(
    <MemoryRouter>
      <ExtensionSettingsPage projectId={projectId} extensionName={extensionName} />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockConnectionStoreState.status = "connected";
  mockApiGet.mockReset();
  mockApiPut.mockReset();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExtensionSettingsPage", () => {
  it("shows loading state initially", () => {
    mockApiGet.mockReturnValue(new Promise(() => {})); // never resolves
    renderPage();
    expect(screen.getByText("Loading settings...")).toBeInTheDocument();
  });

  it("renders header with extension name", async () => {
    mockApiGet.mockResolvedValue({ data: null, error: null, status: 200 });
    renderPage("proj-1", "analytics");
    await waitFor(() => {
      expect(screen.queryByText("Loading settings...")).not.toBeInTheDocument();
    });
    expect(screen.getByText("analytics — Settings")).toBeInTheDocument();
  });

  it("shows error when both API calls fail", async () => {
    mockApiGet.mockResolvedValue({ data: null, error: "Network error", status: 500 });
    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Failed to load extension/)).toBeInTheDocument();
    });
  });

  it("renders settings form with schema fields", async () => {
    mockApiGet
      .mockResolvedValueOnce({
        data: {
          settings: { apiKey: "key-123", maxRetries: 3 },
          schema: [
            { key: "apiKey", type: "string", label: "API Key", required: true, placeholder: "Enter key" },
            { key: "maxRetries", type: "number", label: "Max Retries" },
          ],
        },
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({
        data: { name: "my-ext", version: "1.0.0" },
        error: null,
        status: 200,
      });

    renderPage();
    await waitFor(() => {
      expect(screen.queryByText("Loading settings...")).not.toBeInTheDocument();
    });
    expect(screen.getByLabelText(/API Key/)).toBeInTheDocument();
    expect(screen.getByLabelText("Max Retries")).toBeInTheDocument();
    expect(screen.getByText("Save Settings")).toBeInTheDocument();
  });

  it("renders boolean setting as checkbox", async () => {
    mockApiGet
      .mockResolvedValueOnce({
        data: {
          settings: { enabled: true },
          schema: [{ key: "enabled", type: "boolean", label: "Enabled" }],
        },
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({ data: null, error: null, status: 200 });

    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Enabled")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Enabled")).toBeChecked();
  });

  it("renders select setting with options", async () => {
    mockApiGet
      .mockResolvedValueOnce({
        data: {
          settings: { mode: "fast" },
          schema: [
            { key: "mode", type: "select", label: "Mode", options: ["fast", "accurate", "balanced"] },
          ],
        },
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({ data: null, error: null, status: 200 });

    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Mode")).toBeInTheDocument();
    });
    expect(screen.getByText("fast")).toBeInTheDocument();
    expect(screen.getByText("accurate")).toBeInTheDocument();
    expect(screen.getByText("balanced")).toBeInTheDocument();
  });

  it("renders 'no configurable settings' when schema is empty", async () => {
    mockApiGet
      .mockResolvedValueOnce({
        data: { settings: {}, schema: [] },
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({ data: null, error: null, status: 200 });

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("This extension has no configurable settings.")).toBeInTheDocument();
    });
  });

  it("shows remount warning", async () => {
    mockApiGet
      .mockResolvedValueOnce({
        data: {
          settings: { key: "val" },
          schema: [{ key: "key", type: "string", label: "Key" }],
        },
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({ data: null, error: null, status: 200 });

    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Saving will remount the extension/)).toBeInTheDocument();
    });
  });

  it("saves settings on form submit", async () => {
    const user = userEvent.setup();
    mockApiGet
      .mockResolvedValueOnce({
        data: {
          settings: { name: "old" },
          schema: [{ key: "name", type: "string", label: "Name" }],
        },
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({ data: { name: "my-ext", version: "1.0.0" }, error: null, status: 200 });
    mockApiPut.mockResolvedValue({ data: { ok: true }, error: null, status: 200 });

    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Name")).toBeInTheDocument();
    });

    // Re-mock for the reload after save
    mockApiGet
      .mockResolvedValueOnce({
        data: { settings: { name: "new" }, schema: [{ key: "name", type: "string", label: "Name" }] },
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({ data: { name: "my-ext", version: "1.0.0" }, error: null, status: 200 });

    await user.click(screen.getByText("Save Settings"));

    await waitFor(() => {
      expect(mockApiPut).toHaveBeenCalledWith(
        "/api/projects/proj-1/extensions/my-ext/settings",
        expect.any(Object),
      );
    });
  });

  it("shows save error on API failure", async () => {
    const user = userEvent.setup();
    mockApiGet
      .mockResolvedValueOnce({
        data: {
          settings: { key: "val" },
          schema: [{ key: "key", type: "string", label: "Key" }],
        },
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({ data: null, error: null, status: 200 });
    mockApiPut.mockResolvedValue({ data: null, error: "Save failed", status: 500 });

    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Key")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Save Settings"));

    await waitFor(() => {
      expect(screen.getByText("Save failed")).toBeInTheDocument();
    });
  });

  it("shows 503 specific error message", async () => {
    const user = userEvent.setup();
    mockApiGet
      .mockResolvedValueOnce({
        data: {
          settings: { key: "val" },
          schema: [{ key: "key", type: "string", label: "Key" }],
        },
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({ data: null, error: null, status: 200 });
    mockApiPut.mockResolvedValue({ data: null, error: "Service Unavailable", status: 503 });

    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Key")).toBeInTheDocument();
    });

    await user.click(screen.getByText("Save Settings"));

    await waitFor(() => {
      expect(screen.getByText("Server is unavailable. Settings not saved.")).toBeInTheDocument();
    });
  });

  it("renders permissions display", async () => {
    mockApiGet
      .mockResolvedValueOnce({
        data: { settings: {}, schema: [] },
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({
        data: {
          name: "my-ext",
          version: "1.0.0",
          manifest: {
            permissions: {
              database: true,
              network: ["api.example.com"],
              mcp: true,
              hooks: ["preToolUse"],
              vault: ["API_KEY"],
              filesystem: true,
            },
          },
        },
        error: null,
        status: 200,
      });

    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/Database/)).toBeInTheDocument();
    });
    expect(screen.getByText(/api.example.com/)).toBeInTheDocument();
    expect(screen.getByText("MCP Server")).toBeInTheDocument();
    expect(screen.getByText(/preToolUse/)).toBeInTheDocument();
    expect(screen.getByText(/API_KEY/)).toBeInTheDocument();
    expect(screen.getByText("Filesystem (advisory)")).toBeInTheDocument();
  });

  it("shows 'no special permissions' when permissions object is empty", async () => {
    mockApiGet
      .mockResolvedValueOnce({
        data: { settings: {}, schema: [] },
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({
        data: {
          name: "my-ext",
          version: "1.0.0",
          manifest: { permissions: {} },
        },
        error: null,
        status: 200,
      });

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("No special permissions declared.")).toBeInTheDocument();
    });
  });

  it("renders extension info section", async () => {
    mockApiGet
      .mockResolvedValueOnce({
        data: { settings: {}, schema: [] },
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({
        data: {
          name: "my-ext",
          version: "2.1.0",
          source: "https://github.com/org/ext",
          marketplace: "official",
          status: "active",
          installedAt: "2024-01-15T12:00:00Z",
        },
        error: null,
        status: 200,
      });

    renderPage();
    await waitFor(() => {
      expect(screen.getByText("2.1.0")).toBeInTheDocument();
    });
    expect(screen.getByText("https://github.com/org/ext")).toBeInTheDocument();
    expect(screen.getByText("official")).toBeInTheDocument();
    expect(screen.getByText("active")).toBeInTheDocument();
  });

  it("shows version and marketplace in header when info available", async () => {
    mockApiGet
      .mockResolvedValueOnce({
        data: { settings: {}, schema: [] },
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({
        data: { name: "my-ext", version: "3.0.0", marketplace: "community" },
        error: null,
        status: 200,
      });

    renderPage();
    await waitFor(() => {
      expect(screen.getByText(/v3.0.0/)).toBeInTheDocument();
    });
    expect(screen.getAllByText(/community/).length).toBeGreaterThanOrEqual(1);
  });

  it("navigates back when back button clicked", async () => {
    const user = userEvent.setup();
    mockApiGet.mockResolvedValue({ data: null, error: null, status: 200 });
    renderPage();

    await user.click(screen.getByText("Back"));
    expect(mockNavigate).toHaveBeenCalledWith(-1);
  });

  it("disables form when disconnected", async () => {
    mockConnectionStoreState.status = "disconnected";
    mockApiGet
      .mockResolvedValueOnce({
        data: {
          settings: { key: "val" },
          schema: [{ key: "key", type: "string", label: "Key" }],
        },
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({ data: null, error: null, status: 200 });

    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Key")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Key")).toBeDisabled();
    expect(screen.getByText("Save Settings").closest("button")).toBeDisabled();
  });

  it("renders select with object options (label/value)", async () => {
    mockApiGet
      .mockResolvedValueOnce({
        data: {
          settings: { region: "us-east" },
          schema: [
            {
              key: "region",
              type: "select",
              label: "Region",
              options: [
                { label: "US East", value: "us-east" },
                { label: "EU West", value: "eu-west" },
              ],
            },
          ],
        },
        error: null,
        status: 200,
      })
      .mockResolvedValueOnce({ data: null, error: null, status: 200 });

    renderPage();
    await waitFor(() => {
      expect(screen.getByLabelText("Region")).toBeInTheDocument();
    });
    expect(screen.getByText("US East")).toBeInTheDocument();
    expect(screen.getByText("EU West")).toBeInTheDocument();
  });
});
