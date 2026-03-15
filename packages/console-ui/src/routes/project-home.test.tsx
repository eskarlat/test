import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";
import { useProjectStore } from "../stores/project-store";
import { useExtensionStore } from "../stores/extension-store";

// Mock API client
const mockApiGet = vi.fn().mockResolvedValue({ data: null, error: null, status: 200 });
vi.mock("../api/client", () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
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

const { default: ProjectHomePage } = await import("./project-home");

function renderWithRouter(initialEntry = "/proj-1") {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <Routes>
        <Route path=":projectId" element={<ProjectHomePage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProjectHomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({ projects: [{ id: "proj-1", name: "Test Project", path: "/tmp" }] });
    useExtensionStore.setState({ extensions: {}, loading: false, error: null });

    mockApiGet.mockImplementation((url: string) => {
      if (url.includes("/projects/proj-1")) {
        return Promise.resolve({
          data: { id: "proj-1", name: "Test Project", path: "/tmp" },
          error: null,
          status: 200,
        });
      }
      if (url.includes("/sessions")) return Promise.resolve({ data: [], error: null, status: 200 });
      if (url.includes("/observations")) return Promise.resolve({ data: [], error: null, status: 200 });
      if (url.includes("/errors")) return Promise.resolve({ data: [], error: null, status: 200 });
      if (url.includes("/prompts/stats")) return Promise.resolve({ data: { total: 5 }, error: null, status: 200 });
      if (url.includes("/tool-rules")) return Promise.resolve({ data: [], error: null, status: 200 });
      if (url.includes("/tool-analytics")) return Promise.resolve({ data: { totalCount: 10 }, error: null, status: 200 });
      return Promise.resolve({ data: null, error: null, status: 200 });
    });
  });

  it("renders project name", async () => {
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("Test Project")).toBeTruthy();
    });
  });

  it("renders stats cards", async () => {
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("Sessions")).toBeTruthy();
      expect(screen.getByText("Observations")).toBeTruthy();
      expect(screen.getByText("Prompts")).toBeTruthy();
      expect(screen.getByText("Errors")).toBeTruthy();
      expect(screen.getByText("Tool Rules")).toBeTruthy();
      expect(screen.getByText("Tool Uses")).toBeTruthy();
    });
  });

  it("renders dashboard cards", async () => {
    renderWithRouter();
    await waitFor(() => {
      expect(screen.getByText("Active Sessions")).toBeTruthy();
      expect(screen.getByText("MCP Connections")).toBeTruthy();
      expect(screen.getByText("Hook Activity")).toBeTruthy();
      expect(screen.getByText("Recent Logs")).toBeTruthy();
    });
  });
});
