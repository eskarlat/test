import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("../../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  apiPut: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  BASE_URL: "http://localhost:42888",
}));

vi.mock("../../stores/connection-store", () => ({
  useConnectionStore: Object.assign(
    vi.fn((sel: (s: { status: string }) => unknown) => sel({ status: "connected" })),
    { getState: () => ({ status: "connected" }), subscribe: vi.fn(), setState: vi.fn() },
  ),
}));

vi.mock("../../stores/vault-store", () => ({
  useVaultStore: Object.assign(
    vi.fn((sel: (s: { keys: string[] }) => unknown) => sel({ keys: ["api-key", "token"] })),
    { getState: () => ({ keys: ["api-key", "token"] }), subscribe: vi.fn(), setState: vi.fn() },
  ),
}));

vi.mock("../../stores/notification-store", () => ({
  useNotificationStore: Object.assign(
    vi.fn(() => null),
    { getState: () => ({ addToast: vi.fn() }), subscribe: vi.fn(), setState: vi.fn() },
  ),
}));

vi.mock("../../lib/extension-loader", () => ({
  invalidateExtensionModule: vi.fn(),
  loadExtensionModule: vi.fn(),
}));

import { ExtensionErrorBoundary } from "./ExtensionErrorBoundary";
import { ExtensionSettingsForm } from "./ExtensionSettingsForm";

describe("ExtensionErrorBoundary", () => {
  it("renders children when no error", () => {
    render(
      <ExtensionErrorBoundary extensionName="test-ext">
        <p>Content here</p>
      </ExtensionErrorBoundary>,
    );
    expect(screen.getByText("Content here")).toBeTruthy();
  });

  it("renders fallback when child throws", () => {
    function Bomb(): JSX.Element {
      throw new Error("Boom!");
    }

    // Suppress console.error from error boundary
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    render(
      <ExtensionErrorBoundary extensionName="my-ext">
        <Bomb />
      </ExtensionErrorBoundary>,
    );

    expect(screen.getByText("Extension crashed")).toBeTruthy();
    expect(screen.getByText(/my-ext/)).toBeTruthy();
    expect(screen.getByText("Boom!")).toBeTruthy();
    expect(screen.getByText("Reload Extension")).toBeTruthy();

    spy.mockRestore();
  });
});

describe("ExtensionSettingsForm", () => {
  const extension = {
    name: "my-extension",
    manifest: {
      settings: {
        schema: [
          { key: "api_key", label: "API Key", type: "string", required: true },
          { key: "enabled", label: "Enabled", type: "boolean" },
          { key: "secret", label: "Secret", type: "vault" },
          { key: "count", label: "Count", type: "number" },
          { key: "mode", label: "Mode", type: "select", options: ["fast", "slow"] },
        ],
      },
    },
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state initially", () => {
    render(<ExtensionSettingsForm projectId="proj-1" extension={extension as any} />);
    expect(screen.getByText("Loading settings...")).toBeTruthy();
  });

  it("shows 'no configurable settings' when schema is empty", async () => {
    const ext = { name: "empty", manifest: { settings: { schema: [] } } };
    render(<ExtensionSettingsForm projectId="proj-1" extension={ext as any} />);
    await waitFor(() => {
      expect(screen.getByText("This extension has no configurable settings.")).toBeTruthy();
    });
  });

  it("renders form fields after loading", async () => {
    render(<ExtensionSettingsForm projectId="proj-1" extension={extension as any} />);
    await waitFor(() => {
      expect(screen.getByText("API Key")).toBeTruthy();
      expect(screen.getAllByText("Enabled").length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText("Secret")).toBeTruthy();
      expect(screen.getByText("Count")).toBeTruthy();
      expect(screen.getByText("Mode")).toBeTruthy();
    });
  });

  it("renders save button", async () => {
    render(<ExtensionSettingsForm projectId="proj-1" extension={extension as any} />);
    await waitFor(() => {
      expect(screen.getByText("Save Settings")).toBeTruthy();
    });
  });
});
