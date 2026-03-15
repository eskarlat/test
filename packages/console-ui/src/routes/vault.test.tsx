import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useVaultStore } from "../stores/vault-store";
import { useNotificationStore } from "../stores/notification-store";

// Mock API client
vi.mock("../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: { keys: [] }, error: null, status: 200 }),
  apiPost: vi.fn().mockResolvedValue({ data: { ok: true }, error: null, status: 200 }),
  apiDelete: vi.fn().mockResolvedValue({ data: { ok: true }, error: null, status: 200 }),
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

const { default: VaultPage } = await import("./vault");

describe("VaultPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useVaultStore.setState({ keys: [], loading: false, error: null });
    useNotificationStore.setState({ toasts: [], events: [] });
  });

  it("renders vault heading", async () => {
    render(<VaultPage />);
    expect(screen.getByText("Vault")).toBeTruthy();
    expect(screen.getByText("Manage encrypted secrets used by extensions.")).toBeTruthy();
  });

  it("renders Add Secret button", async () => {
    render(<VaultPage />);
    await waitFor(() => {
      expect(screen.getByText("Add Secret")).toBeTruthy();
    });
  });

  it("renders vault key list when keys are set", async () => {
    useVaultStore.setState({ keys: ["API_KEY", "DB_PASSWORD"] });
    render(<VaultPage />);
    await waitFor(() => {
      expect(screen.getByText("API_KEY")).toBeTruthy();
      expect(screen.getByText("DB_PASSWORD")).toBeTruthy();
    });
  });

  it("shows add form when Add Secret clicked", async () => {
    const user = userEvent.setup();
    render(<VaultPage />);
    await waitFor(() => {
      expect(screen.getByText("Add Secret")).toBeTruthy();
    });
    await user.click(screen.getByText("Add Secret"));
    expect(screen.getByLabelText(/key/i)).toBeTruthy();
  });

  it("renders security info text", () => {
    render(<VaultPage />);
    expect(
      screen.getByText(/Secrets are encrypted with AES-256-GCM/)
    ).toBeTruthy();
  });
});
