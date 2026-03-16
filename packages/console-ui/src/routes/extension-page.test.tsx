import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../api/client", () => ({
  apiGet: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  apiPost: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  apiPut: vi.fn().mockResolvedValue({ data: null, error: null, status: 200 }),
  BASE_URL: "http://localhost:42888",
}));

const mockProjectStoreState: Record<string, unknown> = {
  projects: [
    { id: "proj-1", name: "My Project", path: "/projects/my-project", extensionCount: 2, mountedExtensions: [] },
  ],
  activeProjectId: "proj-1",
  setActiveProject: vi.fn(),
  fetchProjects: vi.fn(),
};

vi.mock("../stores/project-store", () => ({
  useProjectStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockProjectStoreState),
    { setState: vi.fn(), getState: () => mockProjectStoreState },
  ),
}));

const mockExtensionStoreState: Record<string, unknown> = {
  extensions: {
    "proj-1": [
      { name: "analytics", version: "1.0.0", status: "active" },
      { name: "dashboard", version: "2.0.0", status: "active" },
    ],
  },
  getExtensionsForProject: (projectId: string) => {
    const exts = (mockExtensionStoreState.extensions as Record<string, unknown[]>)[projectId];
    return exts ?? [];
  },
  fetchExtensions: vi.fn(),
};

vi.mock("../stores/extension-store", () => ({
  useExtensionStore: Object.assign(
    (selector: (s: Record<string, unknown>) => unknown) => selector(mockExtensionStoreState),
    { setState: vi.fn(), getState: () => mockExtensionStoreState },
  ),
}));

vi.mock("../components/extensions/ExtensionLoader", () => ({
  ExtensionLoader: ({
    extensionName,
    pageId,
    projectId,
  }: {
    extensionName: string;
    pageId: string;
    projectId: string;
  }) => (
    <div data-testid="extension-loader">
      {extensionName}/{pageId}/{projectId}
    </div>
  ),
}));

// ---------------------------------------------------------------------------
// Import under test
// ---------------------------------------------------------------------------

import ExtensionPageRoute from "./extension-page";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function renderRoute(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/projects/:projectId/extensions/:extensionName/pages/:pageId" element={<ExtensionPageRoute />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockProjectStoreState.projects = [
    { id: "proj-1", name: "My Project", path: "/projects/my-project", extensionCount: 2, mountedExtensions: [] },
  ];
  (mockExtensionStoreState.extensions as Record<string, unknown[]>)["proj-1"] = [
    { name: "analytics", version: "1.0.0", status: "active" },
    { name: "dashboard", version: "2.0.0", status: "active" },
  ];
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ExtensionPageRoute", () => {
  it("renders ExtensionLoader for valid route", () => {
    renderRoute("/projects/proj-1/extensions/analytics/pages/overview");
    expect(screen.getByTestId("extension-loader")).toBeInTheDocument();
    expect(screen.getByTestId("extension-loader")).toHaveTextContent("analytics/overview/proj-1");
  });

  it("shows project not found when project does not exist", () => {
    renderRoute("/projects/unknown-proj/extensions/analytics/pages/overview");
    expect(screen.getByText("Project not found.")).toBeInTheDocument();
  });

  it("shows extension not mounted when extension does not exist", () => {
    renderRoute("/projects/proj-1/extensions/nonexistent/pages/overview");
    expect(screen.getByText(/is not mounted/)).toBeInTheDocument();
    expect(screen.getByText("nonexistent")).toBeInTheDocument();
  });

  it("renders with different extension and page", () => {
    renderRoute("/projects/proj-1/extensions/dashboard/pages/settings");
    expect(screen.getByTestId("extension-loader")).toHaveTextContent("dashboard/settings/proj-1");
  });

  it("shows error for empty projects list", () => {
    mockProjectStoreState.projects = [];
    renderRoute("/projects/proj-1/extensions/analytics/pages/overview");
    expect(screen.getByText("Project not found.")).toBeInTheDocument();
  });

  it("shows extension not mounted when project has no extensions", () => {
    (mockExtensionStoreState.extensions as Record<string, unknown[]>)["proj-1"] = [];
    renderRoute("/projects/proj-1/extensions/analytics/pages/overview");
    expect(screen.getByText(/is not mounted/)).toBeInTheDocument();
  });
});
