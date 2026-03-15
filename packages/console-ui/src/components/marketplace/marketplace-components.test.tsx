import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { RemoveDialog } from "./RemoveDialog";
import { PermissionReview } from "./PermissionReview";
import { ConfirmInstall } from "./ConfirmInstall";
import { UpgradeDialog } from "./UpgradeDialog";
import { SettingsStep } from "./SettingsStep";
import { InstallDialog, type MarketplaceExtensionForInstall } from "./InstallDialog";
import {
  InstalledExtensionCard,
  MarketplaceExtensionCard,
  type InstalledExtensionCardData,
  type MarketplaceExtensionCardData,
} from "./ExtensionCard";
import { InstalledTab } from "./InstalledTab";
import { MarketplaceTab } from "./MarketplaceTab";
import { VaultKeyPicker } from "./VaultKeyPicker";
import type { MountedExtension } from "../../stores/extension-store";

const mockApiGet = vi.fn().mockResolvedValue({ data: null, error: null, status: 200 });
const mockApiPost = vi.fn().mockResolvedValue({ data: null, error: null, status: 200 });
const mockApiDelete = vi.fn().mockResolvedValue({ data: null, error: null, status: 200 });

vi.mock("../../api/client", () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
  apiPost: (...args: unknown[]) => mockApiPost(...args),
  apiDelete: (...args: unknown[]) => mockApiDelete(...args),
  BASE_URL: "http://localhost:42888",
}));

const mockFetchExtensions = vi.fn().mockResolvedValue(undefined);
const mockGetExtensionsForProject = vi.fn().mockReturnValue([]);

vi.mock("../../stores/extension-store", () => ({
  useExtensionStore: Object.assign(
    vi.fn((sel: (s: Record<string, unknown>) => unknown) =>
      sel({
        fetchExtensions: mockFetchExtensions,
        getExtensionsForProject: mockGetExtensionsForProject,
        extensions: {},
      }),
    ),
    {
      getState: () => ({
        fetchExtensions: mockFetchExtensions,
        getExtensionsForProject: mockGetExtensionsForProject,
        extensions: {},
      }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

const mockAddToast = vi.fn();

vi.mock("../../stores/notification-store", () => ({
  useNotificationStore: Object.assign(
    vi.fn((sel: (s: Record<string, unknown>) => unknown) =>
      sel({ availableUpdates: [], toasts: [] }),
    ),
    {
      getState: () => ({ addToast: mockAddToast, availableUpdates: [], toasts: [] }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

const mockFetchProjects = vi.fn().mockResolvedValue(undefined);

vi.mock("../../stores/project-store", () => ({
  useProjectStore: Object.assign(
    vi.fn((sel: (s: Record<string, unknown>) => unknown) =>
      sel({ projects: [], activeProjectId: null }),
    ),
    {
      getState: () => ({ fetchProjects: mockFetchProjects }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

const mockNavigate = vi.fn();
vi.mock("react-router", async () => {
  const actual = await vi.importActual<typeof import("react-router")>("react-router");
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockFetchKeys = vi.fn().mockResolvedValue(undefined);
let mockVaultKeys: string[] = [];

vi.mock("../../stores/vault-store", () => ({
  useVaultStore: Object.assign(
    vi.fn((sel: (s: { keys: string[]; fetchKeys: () => Promise<void> }) => unknown) =>
      sel({ keys: mockVaultKeys, fetchKeys: mockFetchKeys }),
    ),
    {
      getState: () => ({ keys: mockVaultKeys, fetchKeys: mockFetchKeys }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockVaultKeys = [];
  mockApiGet.mockResolvedValue({ data: null, error: null, status: 200 });
  mockApiPost.mockResolvedValue({ data: null, error: null, status: 200 });
  mockApiDelete.mockResolvedValue({ data: null, error: null, status: 200 });
  mockGetExtensionsForProject.mockReturnValue([]);
});

describe("RemoveDialog", () => {
  it("renders dialog with extension name", () => {
    render(
      <RemoveDialog
        extensionName="my-ext"
        removing={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Remove my-ext?")).toBeTruthy();
    expect(screen.getByText("Cancel")).toBeTruthy();
    expect(screen.getByText("Remove")).toBeTruthy();
  });

  it("shows removing state", () => {
    render(
      <RemoveDialog
        extensionName="my-ext"
        removing={true}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Removing...")).toBeTruthy();
  });

  it("calls onConfirm when Remove clicked", () => {
    const onConfirm = vi.fn();
    render(
      <RemoveDialog extensionName="my-ext" removing={false} onConfirm={onConfirm} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Remove"));
    expect(onConfirm).toHaveBeenCalled();
  });

  it("calls onClose when Cancel clicked", () => {
    const onClose = vi.fn();
    render(
      <RemoveDialog extensionName="my-ext" removing={false} onConfirm={vi.fn()} onClose={onClose} />,
    );
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(
      <RemoveDialog extensionName="my-ext" removing={false} onConfirm={vi.fn()} onClose={onClose} />,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });
});

describe("PermissionReview", () => {
  it("shows no permissions message when undefined", () => {
    render(<PermissionReview permissions={undefined} />);
    expect(screen.getByText("This extension does not request any special permissions.")).toBeTruthy();
  });

  it("shows no permissions message when empty", () => {
    render(<PermissionReview permissions={{}} />);
    expect(screen.getByText("This extension does not request any special permissions.")).toBeTruthy();
  });

  it("shows database permission", () => {
    render(<PermissionReview permissions={{ database: true }} />);
    expect(screen.getByText("Database")).toBeTruthy();
  });

  it("shows network permissions", () => {
    render(<PermissionReview permissions={{ network: ["api.example.com", "cdn.example.com"] }} />);
    expect(screen.getByText("Network")).toBeTruthy();
    expect(screen.getByText("api.example.com, cdn.example.com")).toBeTruthy();
  });

  it("shows MCP permission", () => {
    render(<PermissionReview permissions={{ mcp: true }} />);
    expect(screen.getByText("MCP Server")).toBeTruthy();
  });

  it("shows hooks permissions", () => {
    render(<PermissionReview permissions={{ hooks: ["preToolUse", "postToolUse"] }} />);
    expect(screen.getByText("Hooks (2)")).toBeTruthy();
  });

  it("shows vault permissions", () => {
    render(<PermissionReview permissions={{ vault: ["API_KEY"] }} />);
    expect(screen.getByText("Vault Secrets")).toBeTruthy();
    expect(screen.getByText("Needs: API_KEY")).toBeTruthy();
  });

  it("shows filesystem permission", () => {
    render(<PermissionReview permissions={{ filesystem: true }} />);
    expect(screen.getByText("Filesystem")).toBeTruthy();
  });

  it("shows all permissions together", () => {
    render(
      <PermissionReview
        permissions={{ database: true, mcp: true, filesystem: true, network: ["api.com"], hooks: ["x"], vault: ["k"] }}
      />,
    );
    expect(screen.getByText("Database")).toBeTruthy();
    expect(screen.getByText("MCP Server")).toBeTruthy();
    expect(screen.getByText("Filesystem")).toBeTruthy();
    expect(screen.getByText("Network")).toBeTruthy();
    expect(screen.getByText("Hooks (1)")).toBeTruthy();
    expect(screen.getByText("Vault Secrets")).toBeTruthy();
  });
});

describe("ConfirmInstall", () => {
  const baseExtension = {
    name: "cool-ext",
    version: "1.2.3",
    marketplace: "official",
    description: "A cool extension",
  };

  it("renders extension info", () => {
    render(<ConfirmInstall extension={baseExtension} schema={[]} values={{}} />);
    expect(screen.getByText("cool-ext v1.2.3")).toBeTruthy();
    expect(screen.getByText("A cool extension")).toBeTruthy();
    expect(screen.getByText("official")).toBeTruthy();
  });

  it("shows no permissions when none requested", () => {
    render(<ConfirmInstall extension={baseExtension} schema={[]} values={{}} />);
    expect(screen.getAllByText("None").length).toBeGreaterThanOrEqual(1);
  });

  it("shows permissions summary", () => {
    const ext = { ...baseExtension, permissions: { database: true, mcp: true } };
    render(<ConfirmInstall extension={ext} schema={[]} values={{}} />);
    expect(screen.getByText("Database, MCP")).toBeTruthy();
  });

  it("shows settings summary", () => {
    const schema = [
      { key: "api_key", label: "API Key", type: "string" as const, required: true },
    ];
    const values = { api_key: "my-key" };
    render(<ConfirmInstall extension={baseExtension} schema={schema} values={values} />);
    expect(screen.getByText("api_key")).toBeTruthy();
    expect(screen.getByText("my-key")).toBeTruthy();
  });

  it("shows vault setting display", () => {
    const schema = [
      { key: "token", label: "Token", type: "vault" as const, required: true },
    ];
    const values = { token: "${VAULT:my-secret}" };
    render(<ConfirmInstall extension={baseExtension} schema={schema} values={values} />);
    expect(screen.getByText("vault: my-secret")).toBeTruthy();
  });

  it("shows install actions list", () => {
    render(<ConfirmInstall extension={baseExtension} schema={[]} values={{}} />);
    expect(screen.getByText("Mount extension routes in worker service")).toBeTruthy();
  });
});

describe("UpgradeDialog", () => {
  it("renders dialog with versions", () => {
    render(
      <UpgradeDialog
        extensionName="my-ext"
        currentVersion="1.0.0"
        targetVersion="2.0.0"
        upgrading={false}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Upgrade my-ext?")).toBeTruthy();
    expect(screen.getByText("v1.0.0")).toBeTruthy();
    expect(screen.getByText("v2.0.0")).toBeTruthy();
  });

  it("shows upgrading state", () => {
    render(
      <UpgradeDialog
        extensionName="my-ext"
        currentVersion="1.0.0"
        targetVersion="2.0.0"
        upgrading={true}
        onConfirm={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(screen.getByText("Upgrading...")).toBeTruthy();
  });

  it("calls onConfirm on Upgrade click", () => {
    const onConfirm = vi.fn();
    render(
      <UpgradeDialog extensionName="x" currentVersion="1" targetVersion="2" upgrading={false} onConfirm={onConfirm} onClose={vi.fn()} />,
    );
    fireEvent.click(screen.getByText("Upgrade"));
    expect(onConfirm).toHaveBeenCalled();
  });
});

describe("SettingsStep", () => {
  it("shows no settings message when schema is empty", () => {
    render(<SettingsStep schema={[]} values={{}} onChange={vi.fn()} />);
    expect(screen.getByText("No settings required for this extension.")).toBeTruthy();
  });

  it("renders string field", () => {
    const schema = [{ key: "name", label: "Name", type: "string", required: true }];
    render(<SettingsStep schema={schema} values={{}} onChange={vi.fn()} />);
    expect(screen.getByText("Name")).toBeTruthy();
  });

  it("renders number field", () => {
    const schema = [{ key: "count", label: "Count", type: "number" }];
    render(<SettingsStep schema={schema} values={{}} onChange={vi.fn()} />);
    expect(screen.getByText("Count")).toBeTruthy();
  });

  it("renders boolean field", () => {
    const schema = [{ key: "enabled", label: "Enabled", type: "boolean" }];
    render(<SettingsStep schema={schema} values={{}} onChange={vi.fn()} />);
    expect(screen.getAllByText(/Enable/i).length).toBeGreaterThanOrEqual(1);
  });

  it("renders select field", () => {
    const schema = [{ key: "mode", label: "Mode", type: "select", options: ["fast", "slow"] }];
    render(<SettingsStep schema={schema} values={{}} onChange={vi.fn()} />);
    expect(screen.getByText("Mode")).toBeTruthy();
    expect(screen.getByText("fast")).toBeTruthy();
    expect(screen.getByText("slow")).toBeTruthy();
  });

  it("calls onChange on input change", () => {
    const onChange = vi.fn();
    const schema = [{ key: "name", label: "Name", type: "string" }];
    render(<SettingsStep schema={schema} values={{ name: "" }} onChange={onChange} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "test" } });
    expect(onChange).toHaveBeenCalledWith("name", "test");
  });
});

// ─── InstallDialog ────────────────────────────────────────────────────────────

describe("InstallDialog", () => {
  const baseExtension: MarketplaceExtensionForInstall = {
    name: "test-ext",
    version: "1.0.0",
    repository: "https://github.com/test/ext",
    marketplace: "official",
    description: "Test extension",
  };

  function renderDialog(
    overrides: Partial<MarketplaceExtensionForInstall> = {},
    props: { onClose?: () => void; onInstalled?: () => void } = {},
  ) {
    return render(
      <InstallDialog
        projectId="proj-1"
        extension={{ ...baseExtension, ...overrides }}
        onClose={props.onClose ?? vi.fn()}
        onInstalled={props.onInstalled ?? vi.fn()}
      />,
    );
  }

  it("renders dialog title with extension name and version", () => {
    renderDialog();
    expect(screen.getByText(/Install test-ext v1\.0\.0/)).toBeTruthy();
  });

  it("starts on permissions step", () => {
    renderDialog();
    expect(screen.getByText(/Review Permissions/)).toBeTruthy();
    expect(screen.getByText(/This extension requests the following permissions/)).toBeTruthy();
  });

  it("skips settings step when extension has no settings", () => {
    renderDialog();
    // Step 1 of 2 (permissions + confirm, no settings)
    expect(screen.getByText(/Step 1 of 2/)).toBeTruthy();
  });

  it("includes settings step when extension has settings", () => {
    renderDialog({
      settings: {
        schema: [{ key: "api_key", type: "string", label: "API Key", required: true }],
      },
    });
    expect(screen.getByText(/Step 1 of 3/)).toBeTruthy();
  });

  it("navigates to next step on Accept & Next click", () => {
    renderDialog();
    fireEvent.click(screen.getByText(/Accept/));
    // Now on confirm step (step 2 of 2)
    expect(screen.getByText(/Step 2 of 2/)).toBeTruthy();
    expect(screen.getByText(/Confirm/)).toBeTruthy();
  });

  it("shows Back button on non-first steps", () => {
    renderDialog();
    // On first step, no Back button
    expect(screen.queryByText("Back")).toBeNull();
    fireEvent.click(screen.getByText(/Accept/));
    // Now on confirm step, Back should appear
    expect(screen.getByText("Back")).toBeTruthy();
  });

  it("navigates back when Back is clicked", () => {
    renderDialog();
    fireEvent.click(screen.getByText(/Accept/));
    expect(screen.getByText(/Step 2 of 2/)).toBeTruthy();
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText(/Step 1 of 2/)).toBeTruthy();
  });

  it("shows Install button on last step", () => {
    renderDialog();
    fireEvent.click(screen.getByText(/Accept/));
    expect(screen.getByText("Install")).toBeTruthy();
  });

  it("calls apiPost and onInstalled on successful install", async () => {
    const onInstalled = vi.fn();
    mockApiPost.mockResolvedValueOnce({ data: { ok: true }, error: null, status: 200 });
    renderDialog({}, { onInstalled });

    fireEvent.click(screen.getByText(/Accept/));
    fireEvent.click(screen.getByText("Install"));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        "/api/proj-1/extensions/install",
        expect.objectContaining({ name: "test-ext", version: "1.0.0" }),
      );
    });
    await waitFor(() => {
      expect(onInstalled).toHaveBeenCalled();
    });
  });

  it("shows error message on failed install", async () => {
    mockApiPost.mockResolvedValueOnce({ data: null, error: "Network error", status: 500 });
    renderDialog();

    fireEvent.click(screen.getByText(/Accept/));
    fireEvent.click(screen.getByText("Install"));

    await waitFor(() => {
      expect(screen.getByText("Network error")).toBeTruthy();
    });
  });

  it("calls onClose when Escape is pressed", () => {
    const onClose = vi.fn();
    renderDialog({}, { onClose });
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when Cancel is clicked", () => {
    const onClose = vi.fn();
    renderDialog({}, { onClose });
    fireEvent.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when clicking backdrop", () => {
    const onClose = vi.fn();
    renderDialog({}, { onClose });
    // The outer div with role="dialog" is the backdrop itself
    const backdrop = screen.getByRole("dialog");
    fireEvent.click(backdrop);
    expect(onClose).toHaveBeenCalled();
  });

  it("navigates through 3-step flow with settings", () => {
    renderDialog({
      settings: {
        schema: [{ key: "token", type: "string", label: "Token" }],
      },
    });
    expect(screen.getByText(/Step 1 of 3/)).toBeTruthy();

    fireEvent.click(screen.getByText(/Accept/));
    expect(screen.getByText(/Step 2 of 3/)).toBeTruthy();
    expect(screen.getByText(/Configure Settings/)).toBeTruthy();

    fireEvent.click(screen.getByText(/Accept/));
    expect(screen.getByText(/Step 3 of 3/)).toBeTruthy();
  });

  it("populates default values from settings schema", async () => {
    mockApiPost.mockResolvedValueOnce({ data: { ok: true }, error: null, status: 200 });
    const onInstalled = vi.fn();
    renderDialog(
      {
        settings: {
          schema: [{ key: "mode", type: "string", label: "Mode", default: "fast" }],
        },
      },
      { onInstalled },
    );

    // Go through all steps
    fireEvent.click(screen.getByText(/Accept/));
    fireEvent.click(screen.getByText(/Accept/));
    fireEvent.click(screen.getByText("Install"));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ settings: { mode: "fast" } }),
      );
    });
  });
});

// ─── ExtensionCard ────────────────────────────────────────────────────────────

describe("InstalledExtensionCard", () => {
  const baseCardData: InstalledExtensionCardData = {
    name: "my-ext",
    version: "1.0.0",
    status: "healthy",
    hasSettings: false,
  };

  const defaultHandlers = {
    onSettings: vi.fn(),
    onDisable: vi.fn(),
    onEnable: vi.fn(),
    onRemove: vi.fn(),
    onUpgrade: vi.fn(),
    toggling: false,
  };

  it("renders extension name and version", () => {
    render(<InstalledExtensionCard extension={baseCardData} {...defaultHandlers} />);
    expect(screen.getByText("my-ext")).toBeTruthy();
    expect(screen.getByText("v1.0.0")).toBeTruthy();
  });

  it("renders displayName when available", () => {
    render(
      <InstalledExtensionCard
        extension={{ ...baseCardData, displayName: "My Extension" }}
        {...defaultHandlers}
      />,
    );
    expect(screen.getByText("My Extension")).toBeTruthy();
  });

  it("shows Healthy status badge", () => {
    render(<InstalledExtensionCard extension={baseCardData} {...defaultHandlers} />);
    expect(screen.getByText("Healthy")).toBeTruthy();
  });

  it("shows Error status badge", () => {
    render(
      <InstalledExtensionCard
        extension={{ ...baseCardData, status: "error" }}
        {...defaultHandlers}
      />,
    );
    expect(screen.getByText("Error")).toBeTruthy();
  });

  it("shows Disabled status badge", () => {
    render(
      <InstalledExtensionCard
        extension={{ ...baseCardData, status: "disabled" }}
        {...defaultHandlers}
      />,
    );
    expect(screen.getByText("Disabled")).toBeTruthy();
  });

  it("shows Needs setup status badge and warning message", () => {
    render(
      <InstalledExtensionCard
        extension={{ ...baseCardData, status: "needs-setup", hasSettings: true }}
        {...defaultHandlers}
      />,
    );
    expect(screen.getByText("Needs setup")).toBeTruthy();
    expect(screen.getByText(/required settings missing/)).toBeTruthy();
  });

  it("shows Update available badge when update available", () => {
    render(
      <InstalledExtensionCard
        extension={{ ...baseCardData, updateAvailable: { version: "2.0.0" } }}
        {...defaultHandlers}
      />,
    );
    expect(screen.getByText("v2.0.0")).toBeTruthy();
    expect(screen.getByText("Upgrade")).toBeTruthy();
  });

  it("shows Settings button only when hasSettings is true", () => {
    const { rerender } = render(
      <InstalledExtensionCard extension={baseCardData} {...defaultHandlers} />,
    );
    expect(screen.queryByText("Settings")).toBeNull();

    rerender(
      <InstalledExtensionCard
        extension={{ ...baseCardData, hasSettings: true }}
        {...defaultHandlers}
      />,
    );
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("calls onSettings when Settings clicked", () => {
    const onSettings = vi.fn();
    render(
      <InstalledExtensionCard
        extension={{ ...baseCardData, hasSettings: true }}
        {...defaultHandlers}
        onSettings={onSettings}
      />,
    );
    fireEvent.click(screen.getByText("Settings"));
    expect(onSettings).toHaveBeenCalled();
  });

  it("shows Disable button when enabled and calls onDisable", () => {
    const onDisable = vi.fn();
    render(
      <InstalledExtensionCard extension={baseCardData} {...defaultHandlers} onDisable={onDisable} />,
    );
    fireEvent.click(screen.getByText("Disable"));
    expect(onDisable).toHaveBeenCalled();
  });

  it("shows Enable button when disabled and calls onEnable", () => {
    const onEnable = vi.fn();
    render(
      <InstalledExtensionCard
        extension={{ ...baseCardData, status: "disabled" }}
        {...defaultHandlers}
        onEnable={onEnable}
      />,
    );
    fireEvent.click(screen.getByText("Enable"));
    expect(onEnable).toHaveBeenCalled();
  });

  it("shows ... when toggling", () => {
    render(
      <InstalledExtensionCard extension={baseCardData} {...defaultHandlers} toggling={true} />,
    );
    expect(screen.getByText("...")).toBeTruthy();
  });

  it("calls onRemove when Remove clicked", () => {
    const onRemove = vi.fn();
    render(
      <InstalledExtensionCard extension={baseCardData} {...defaultHandlers} onRemove={onRemove} />,
    );
    fireEvent.click(screen.getByText("Remove"));
    expect(onRemove).toHaveBeenCalled();
  });

  it("calls onUpgrade when Upgrade clicked", () => {
    const onUpgrade = vi.fn();
    render(
      <InstalledExtensionCard
        extension={{ ...baseCardData, updateAvailable: { version: "2.0.0" } }}
        {...defaultHandlers}
        onUpgrade={onUpgrade}
      />,
    );
    fireEvent.click(screen.getByText("Upgrade"));
    expect(onUpgrade).toHaveBeenCalled();
  });

  it("shows description when provided", () => {
    render(
      <InstalledExtensionCard
        extension={{ ...baseCardData, description: "A test extension" }}
        {...defaultHandlers}
      />,
    );
    expect(screen.getByText("A test extension")).toBeTruthy();
  });

  it("shows error message when extension has error", () => {
    render(
      <InstalledExtensionCard
        extension={{ ...baseCardData, status: "error", error: "Connection failed" }}
        {...defaultHandlers}
      />,
    );
    expect(screen.getByText("Connection failed")).toBeTruthy();
  });

  it("shows MCP transport info", () => {
    render(
      <InstalledExtensionCard
        extension={{ ...baseCardData, mcpTransport: "stdio", mcpStatus: "connected" }}
        {...defaultHandlers}
      />,
    );
    expect(screen.getByText("MCP: stdio (connected)")).toBeTruthy();
  });

  it("shows marketplace source", () => {
    render(
      <InstalledExtensionCard
        extension={{ ...baseCardData, marketplace: "community" }}
        {...defaultHandlers}
      />,
    );
    expect(screen.getByText("Source: community")).toBeTruthy();
  });
});

describe("MarketplaceExtensionCard", () => {
  const baseCard: MarketplaceExtensionCardData = {
    name: "cool-ext",
    version: "2.0.0",
    description: "A marketplace extension",
  };

  it("renders name and version", () => {
    render(<MarketplaceExtensionCard extension={baseCard} onInstall={vi.fn()} />);
    expect(screen.getByText("cool-ext")).toBeTruthy();
    expect(screen.getByText("v2.0.0")).toBeTruthy();
  });

  it("shows description", () => {
    render(<MarketplaceExtensionCard extension={baseCard} onInstall={vi.fn()} />);
    expect(screen.getByText("A marketplace extension")).toBeTruthy();
  });

  it("shows Install button when not installed", () => {
    const onInstall = vi.fn();
    render(<MarketplaceExtensionCard extension={baseCard} onInstall={onInstall} />);
    fireEvent.click(screen.getByText("Install"));
    expect(onInstall).toHaveBeenCalled();
  });

  it("shows Installed badge and no Install button when installed", () => {
    render(
      <MarketplaceExtensionCard
        extension={{ ...baseCard, installed: true }}
        onInstall={vi.fn()}
      />,
    );
    expect(screen.getAllByText("Installed").length).toBeGreaterThanOrEqual(1);
    expect(screen.queryByRole("button", { name: /install/i })).toBeNull();
  });

  it("shows tags", () => {
    render(
      <MarketplaceExtensionCard
        extension={{ ...baseCard, tags: ["ai", "productivity"] }}
        onInstall={vi.fn()}
      />,
    );
    expect(screen.getByText("ai")).toBeTruthy();
    expect(screen.getByText("productivity")).toBeTruthy();
  });

  it("shows author", () => {
    render(
      <MarketplaceExtensionCard
        extension={{ ...baseCard, author: "John Doe" }}
        onInstall={vi.fn()}
      />,
    );
    expect(screen.getByText("Author: John Doe")).toBeTruthy();
  });

  it("shows marketplace name", () => {
    render(
      <MarketplaceExtensionCard
        extension={{ ...baseCard, marketplace: "official" }}
        onInstall={vi.fn()}
      />,
    );
    expect(screen.getByText("official")).toBeTruthy();
  });
});

// ─── InstalledTab ─────────────────────────────────────────────────────────────

describe("InstalledTab", () => {
  function renderTab(
    props: { loading?: boolean; extensions?: MountedExtension[] } = {},
  ) {
    return render(
      <MemoryRouter>
        <InstalledTab
          projectId="proj-1"
          loading={props.loading ?? false}
          extensions={props.extensions ?? []}
        />
      </MemoryRouter>,
    );
  }

  it("shows loading state", () => {
    renderTab({ loading: true });
    expect(screen.getByText("Loading extensions...")).toBeTruthy();
  });

  it("shows empty state when no extensions", () => {
    renderTab({ extensions: [] });
    expect(screen.getByText("No extensions installed")).toBeTruthy();
    expect(screen.getByText(/Browse the Marketplace/)).toBeTruthy();
  });

  it("renders extension cards for each installed extension", () => {
    const extensions: MountedExtension[] = [
      { name: "ext-a", version: "1.0.0", status: "healthy" },
      { name: "ext-b", version: "2.0.0", status: "disabled" },
    ];
    renderTab({ extensions });
    expect(screen.getByText("ext-a")).toBeTruthy();
    expect(screen.getByText("ext-b")).toBeTruthy();
  });

  it("shows Disable button for healthy extensions", () => {
    const extensions: MountedExtension[] = [
      { name: "ext-a", version: "1.0.0", status: "healthy" },
    ];
    renderTab({ extensions });
    expect(screen.getByText("Disable")).toBeTruthy();
  });

  it("shows Enable button for disabled extensions", () => {
    const extensions: MountedExtension[] = [
      { name: "ext-a", version: "1.0.0", status: "disabled" },
    ];
    renderTab({ extensions });
    expect(screen.getByText("Enable")).toBeTruthy();
  });

  it("calls apiPost to disable when Disable clicked", async () => {
    mockApiPost.mockResolvedValueOnce({ data: { ok: true }, error: null, status: 200 });
    const extensions: MountedExtension[] = [
      { name: "ext-a", version: "1.0.0", status: "healthy" },
    ];
    renderTab({ extensions });
    fireEvent.click(screen.getByText("Disable"));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        "/api/projects/proj-1/extensions/ext-a/disable",
        {},
      );
    });
  });

  it("calls apiPost to enable when Enable clicked", async () => {
    mockApiPost.mockResolvedValueOnce({ data: { ok: true }, error: null, status: 200 });
    const extensions: MountedExtension[] = [
      { name: "ext-a", version: "1.0.0", status: "disabled" },
    ];
    renderTab({ extensions });
    fireEvent.click(screen.getByText("Enable"));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith(
        "/api/projects/proj-1/extensions/ext-a/enable",
        {},
      );
    });
  });

  it("opens RemoveDialog when Remove clicked", () => {
    const extensions: MountedExtension[] = [
      { name: "ext-a", version: "1.0.0", status: "healthy" },
    ];
    renderTab({ extensions });
    fireEvent.click(screen.getByText("Remove"));
    expect(screen.getByText("Remove ext-a?")).toBeTruthy();
  });

  it("navigates to settings page when Settings clicked", () => {
    const extensions: MountedExtension[] = [
      {
        name: "ext-a",
        version: "1.0.0",
        status: "healthy",
        manifest: { settings: { schema: [{ key: "k", type: "string" }] } },
      },
    ];
    renderTab({ extensions });
    fireEvent.click(screen.getByText("Settings"));
    expect(mockNavigate).toHaveBeenCalledWith("/extensions/settings/ext-a?project=proj-1");
  });

  it("shows error toast on disable failure", async () => {
    mockApiPost.mockResolvedValueOnce({ data: null, error: "Server error", status: 500 });
    const extensions: MountedExtension[] = [
      { name: "ext-a", version: "1.0.0", status: "healthy" },
    ];
    renderTab({ extensions });
    fireEvent.click(screen.getByText("Disable"));

    await waitFor(() => {
      expect(mockAddToast).toHaveBeenCalledWith(
        expect.stringContaining("Failed to disable ext-a"),
        "error",
      );
    });
  });
});

// ─── MarketplaceTab ───────────────────────────────────────────────────────────

describe("MarketplaceTab", () => {
  const marketplaceResponse = {
    extensions: [
      {
        name: "ext-alpha",
        version: "1.0.0",
        description: "Alpha extension",
        repository: "https://github.com/test/alpha",
        marketplace: "official",
        tags: ["ai"],
        author: "Alice",
      },
      {
        name: "ext-beta",
        version: "2.0.0",
        description: "Beta extension",
        repository: "https://github.com/test/beta",
        marketplace: "community",
        tags: ["tools"],
        author: "Bob",
      },
    ],
    marketplaces: [
      { name: "official", url: "https://official.example.com" },
      { name: "community", url: "https://community.example.com" },
    ],
    fetchedAt: "2026-01-01T00:00:00Z",
  };

  function renderMarketplace() {
    return render(
      <MemoryRouter>
        <MarketplaceTab projectId="proj-1" />
      </MemoryRouter>,
    );
  }

  it("shows loading state initially", () => {
    // apiGet never resolves immediately, so loading state should show
    mockApiGet.mockReturnValue(new Promise(() => {})); // never resolves
    renderMarketplace();
    expect(screen.getByText("Fetching marketplace...")).toBeTruthy();
  });

  it("shows error state when API fails", async () => {
    mockApiGet.mockResolvedValueOnce({ data: null, error: "Connection refused", status: 500 });
    renderMarketplace();

    await waitFor(() => {
      expect(screen.getByText("Failed to load marketplace")).toBeTruthy();
      expect(screen.getByText("Connection refused")).toBeTruthy();
    });
  });

  it("shows Retry button on error and retries on click", async () => {
    mockApiGet.mockResolvedValueOnce({ data: null, error: "Timeout", status: 500 });
    renderMarketplace();

    await waitFor(() => {
      expect(screen.getByText("Retry")).toBeTruthy();
    });

    mockApiGet.mockResolvedValueOnce({ data: marketplaceResponse, error: null, status: 200 });
    fireEvent.click(screen.getByText("Retry"));

    await waitFor(() => {
      expect(screen.getByText("ext-alpha")).toBeTruthy();
    });
  });

  it("renders extensions after successful load", async () => {
    mockApiGet.mockResolvedValueOnce({ data: marketplaceResponse, error: null, status: 200 });
    renderMarketplace();

    await waitFor(() => {
      expect(screen.getByText("ext-alpha")).toBeTruthy();
      expect(screen.getByText("ext-beta")).toBeTruthy();
    });
  });

  it("filters extensions by search query", async () => {
    mockApiGet.mockResolvedValueOnce({ data: marketplaceResponse, error: null, status: 200 });
    renderMarketplace();

    await waitFor(() => {
      expect(screen.getByText("ext-alpha")).toBeTruthy();
    });

    const searchInput = screen.getByLabelText("Search marketplace");
    fireEvent.change(searchInput, { target: { value: "beta" } });

    expect(screen.queryByText("ext-alpha")).toBeNull();
    expect(screen.getByText("ext-beta")).toBeTruthy();
  });

  it("shows no results message when search has no matches", async () => {
    mockApiGet.mockResolvedValueOnce({ data: marketplaceResponse, error: null, status: 200 });
    renderMarketplace();

    await waitFor(() => {
      expect(screen.getByText("ext-alpha")).toBeTruthy();
    });

    const searchInput = screen.getByLabelText("Search marketplace");
    fireEvent.change(searchInput, { target: { value: "nonexistent" } });

    expect(screen.getByText(/No extensions match "nonexistent"/)).toBeTruthy();
  });

  it("filters by marketplace dropdown", async () => {
    mockApiGet.mockResolvedValueOnce({ data: marketplaceResponse, error: null, status: 200 });
    renderMarketplace();

    await waitFor(() => {
      expect(screen.getByText("ext-alpha")).toBeTruthy();
    });

    const selectEl = screen.getByLabelText("Filter by marketplace");
    fireEvent.change(selectEl, { target: { value: "community" } });

    expect(screen.queryByText("ext-alpha")).toBeNull();
    expect(screen.getByText("ext-beta")).toBeTruthy();
  });

  it("opens InstallDialog when Install button is clicked", async () => {
    mockApiGet.mockResolvedValueOnce({ data: marketplaceResponse, error: null, status: 200 });
    renderMarketplace();

    await waitFor(() => {
      expect(screen.getByText("ext-alpha")).toBeTruthy();
    });

    // Find the Install button for ext-alpha (the first Install button)
    const installButtons = screen.getAllByText("Install");
    fireEvent.click(installButtons[0]!);

    await waitFor(() => {
      expect(screen.getByText(/Install ext-alpha v1\.0\.0/)).toBeTruthy();
    });
  });

  it("marks already-installed extensions as installed", async () => {
    mockGetExtensionsForProject.mockReturnValue([{ name: "ext-alpha", version: "1.0.0" }]);
    mockApiGet.mockResolvedValueOnce({ data: marketplaceResponse, error: null, status: 200 });
    renderMarketplace();

    await waitFor(() => {
      expect(screen.getAllByText("Installed").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("shows empty state when no extensions available", async () => {
    mockApiGet.mockResolvedValueOnce({
      data: { extensions: [], marketplaces: [], fetchedAt: "" },
      error: null,
      status: 200,
    });
    renderMarketplace();

    await waitFor(() => {
      expect(screen.getByText("No extensions available")).toBeTruthy();
    });
  });
});

// ─── VaultKeyPicker ───────────────────────────────────────────────────────────

describe("VaultKeyPicker", () => {
  function renderPicker(
    props: { value?: string; onChange?: (k: string) => void; disabled?: boolean } = {},
  ) {
    return render(
      <VaultKeyPicker
        value={props.value ?? ""}
        onChange={props.onChange ?? vi.fn()}
        disabled={props.disabled ?? false}
      />,
    );
  }

  it("renders with placeholder", () => {
    renderPicker();
    expect(screen.getByText("Select vault key...")).toBeTruthy();
  });

  it("renders vault keys from store as options", () => {
    mockVaultKeys = ["api_token", "db_password"];
    renderPicker();
    expect(screen.getByText("api_token")).toBeTruthy();
    expect(screen.getByText("db_password")).toBeTruthy();
  });

  it("calls onChange when a key is selected", () => {
    mockVaultKeys = ["api_token"];
    const onChange = vi.fn();
    renderPicker({ onChange });

    const select = screen.getByRole("combobox");
    fireEvent.change(select, { target: { value: "api_token" } });
    expect(onChange).toHaveBeenCalledWith("api_token");
  });

  it("shows selected key badge when value is set", () => {
    renderPicker({ value: "my_secret" });
    expect(screen.getByText(/Using vault key/)).toBeTruthy();
    expect(screen.getByText("my_secret")).toBeTruthy();
  });

  it("shows Create new secret button when not disabled", () => {
    renderPicker();
    expect(screen.getByText("Create new secret")).toBeTruthy();
  });

  it("hides Create new secret button when disabled", () => {
    renderPicker({ disabled: true });
    expect(screen.queryByText("Create new secret")).toBeNull();
  });

  it("toggles create form visibility", () => {
    renderPicker();
    fireEvent.click(screen.getByText("Create new secret"));
    expect(screen.getByText("New Vault Secret")).toBeTruthy();
    expect(screen.getByText("Hide create form")).toBeTruthy();

    fireEvent.click(screen.getByText("Hide create form"));
    expect(screen.queryByText("New Vault Secret")).toBeNull();
  });

  it("creates a new secret and auto-selects it", async () => {
    const onChange = vi.fn();
    mockApiPost.mockResolvedValueOnce({
      data: { ok: true, key: "new_key" },
      error: null,
      status: 200,
    });
    renderPicker({ onChange });

    fireEvent.click(screen.getByText("Create new secret"));

    const keyInput = screen.getByPlaceholderText("my_api_token");
    const valueInput = screen.getByPlaceholderText("Secret value");

    fireEvent.change(keyInput, { target: { value: "new_key" } });
    fireEvent.change(valueInput, { target: { value: "secret123" } });

    fireEvent.click(screen.getByText(/Save to Vault/));

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith("/api/vault/secrets", {
        key: "new_key",
        value: "secret123",
      });
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith("new_key");
    });

    await waitFor(() => {
      expect(mockFetchKeys).toHaveBeenCalled();
    });
  });

  it("shows create error on failure", async () => {
    mockApiPost.mockResolvedValueOnce({
      data: null,
      error: "Key already exists",
      status: 409,
    });
    renderPicker();

    fireEvent.click(screen.getByText("Create new secret"));

    const keyInput = screen.getByPlaceholderText("my_api_token");
    const valueInput = screen.getByPlaceholderText("Secret value");

    fireEvent.change(keyInput, { target: { value: "existing_key" } });
    fireEvent.change(valueInput, { target: { value: "val" } });

    fireEvent.click(screen.getByText(/Save to Vault/));

    await waitFor(() => {
      expect(screen.getByText("Key already exists")).toBeTruthy();
    });
  });

  it("disables Save button when key or value is empty", () => {
    renderPicker();
    fireEvent.click(screen.getByText("Create new secret"));

    const saveButton = screen.getByText(/Save to Vault/).closest("button")!;
    expect(saveButton.disabled).toBe(true);
  });

  it("creates secret on Enter key in value input", async () => {
    const onChange = vi.fn();
    mockApiPost.mockResolvedValueOnce({
      data: { ok: true, key: "enter_key" },
      error: null,
      status: 200,
    });
    renderPicker({ onChange });

    fireEvent.click(screen.getByText("Create new secret"));

    fireEvent.change(screen.getByPlaceholderText("my_api_token"), {
      target: { value: "enter_key" },
    });
    fireEvent.change(screen.getByPlaceholderText("Secret value"), {
      target: { value: "val" },
    });

    fireEvent.keyDown(screen.getByPlaceholderText("Secret value"), { key: "Enter" });

    await waitFor(() => {
      expect(mockApiPost).toHaveBeenCalledWith("/api/vault/secrets", {
        key: "enter_key",
        value: "val",
      });
    });
  });
});
