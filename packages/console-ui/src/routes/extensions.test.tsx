import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { useProjectStore } from "../stores/project-store";
import { useExtensionStore } from "../stores/extension-store";

// Mock API client
vi.mock("../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  apiPost: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
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

vi.mock("../stores/vault-store", () => ({
  useVaultStore: Object.assign(
    vi.fn((sel: (s: { keys: string[]; fetchKeys: () => Promise<void> }) => unknown) =>
      sel({ keys: [], fetchKeys: () => Promise.resolve() }),
    ),
    {
      getState: () => ({ keys: [], fetchKeys: () => Promise.resolve() }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

vi.mock("../stores/notification-store", () => ({
  useNotificationStore: Object.assign(
    vi.fn((sel: (s: { addToast: () => void }) => unknown) => sel({ addToast: vi.fn() })),
    {
      getState: () => ({ addToast: vi.fn() }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

const { default: ExtensionsPage } = await import("./extensions");

function renderWithRouter(path = "/extensions") {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="extensions" element={<ExtensionsPage />} />
        <Route path="extensions/:extensionName" element={<ExtensionsPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ExtensionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({ activeProjectId: null, projects: [] });
    useExtensionStore.setState({ extensions: {} });
  });

  it("renders page heading", () => {
    renderWithRouter();
    expect(screen.getByText("Extension Manager")).toBeTruthy();
  });

  it("shows no-project message when no project is selected", () => {
    renderWithRouter();
    expect(
      screen.getByText("Select a project to manage its extensions."),
    ).toBeTruthy();
  });

  it("renders tab layout when project is active", async () => {
    useProjectStore.setState({ activeProjectId: "proj-1", projects: [] });
    useExtensionStore.setState({
      extensions: {
        "proj-1": [
          {
            name: "ext-a",
            version: "1.0.0",
            status: "healthy",
          },
        ],
      },
    });
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("Extension Manager")).toBeTruthy();
      expect(screen.getByRole("tab", { name: /Installed/i })).toBeTruthy();
      expect(screen.getByRole("tab", { name: /Marketplace/i })).toBeTruthy();
    });
  });

  it("shows installed count badge", async () => {
    useProjectStore.setState({ activeProjectId: "proj-1", projects: [] });
    useExtensionStore.setState({
      extensions: {
        "proj-1": [
          { name: "ext-a", version: "1.0.0", status: "healthy" },
          { name: "ext-b", version: "2.0.0", status: "healthy" },
        ],
      },
    });
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("(2)")).toBeTruthy();
    });
  });

  it("renders description text when project is active", async () => {
    useProjectStore.setState({ activeProjectId: "proj-1", projects: [] });
    renderWithRouter();
    await waitFor(() => {
      expect(
        screen.getByText("Browse, install, and manage extensions for this project."),
      ).toBeTruthy();
    });
  });
});
