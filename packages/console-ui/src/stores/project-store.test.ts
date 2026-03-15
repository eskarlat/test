import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the API client (project-store imports BASE_URL from it)
vi.mock("../api/client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  BASE_URL: "http://localhost:42888",
}));

// Mock the socket store
vi.mock("../api/socket", () => ({
  useSocketStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({ socket: { emit: vi.fn() } }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

const mockFetch = vi.fn();
global.fetch = mockFetch;

import { useProjectStore } from "./project-store";
import type { ActiveProject } from "./project-store";

function makeProject(overrides: Partial<ActiveProject> = {}): ActiveProject {
  return {
    id: "proj-1",
    name: "Test Project",
    path: "/home/user/test-project",
    extensionCount: 2,
    mountedExtensions: [
      { name: "ext-a", version: "1.0.0", status: "mounted" },
    ],
    ...overrides,
  };
}

describe("project-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProjectStore.setState({
      activeProjectId: null,
      projects: [],
    });
  });

  describe("initial state", () => {
    it("has null activeProjectId and empty projects", () => {
      const state = useProjectStore.getState();
      expect(state.activeProjectId).toBeNull();
      expect(state.projects).toEqual([]);
    });
  });

  describe("setActiveProject", () => {
    it("updates activeProjectId", () => {
      useProjectStore.getState().setActiveProject("proj-1");
      expect(useProjectStore.getState().activeProjectId).toBe("proj-1");
    });

    it("sets activeProjectId to null", () => {
      useProjectStore.setState({ activeProjectId: "proj-1" });
      useProjectStore.getState().setActiveProject(null);
      expect(useProjectStore.getState().activeProjectId).toBeNull();
    });
  });

  describe("fetchProjects", () => {
    it("populates projects and auto-selects first if activeProjectId invalid", async () => {
      const projects = [
        makeProject({ id: "proj-1" }),
        makeProject({ id: "proj-2", name: "Second" }),
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => projects,
      });

      useProjectStore.setState({ activeProjectId: "non-existent" });
      await useProjectStore.getState().fetchProjects();

      expect(mockFetch).toHaveBeenCalledWith("http://localhost:42888/api/projects");
      expect(useProjectStore.getState().projects).toEqual(projects);
      expect(useProjectStore.getState().activeProjectId).toBe("proj-1");
    });

    it("keeps valid activeProjectId", async () => {
      const projects = [
        makeProject({ id: "proj-1" }),
        makeProject({ id: "proj-2", name: "Second" }),
      ];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => projects,
      });

      useProjectStore.setState({ activeProjectId: "proj-2" });
      await useProjectStore.getState().fetchProjects();

      expect(useProjectStore.getState().activeProjectId).toBe("proj-2");
    });

    it("auto-selects first project when activeProjectId is null", async () => {
      const projects = [makeProject({ id: "proj-1" })];
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => projects,
      });

      await useProjectStore.getState().fetchProjects();

      expect(useProjectStore.getState().activeProjectId).toBe("proj-1");
    });

    it("handles non-ok response by keeping cached data", async () => {
      useProjectStore.setState({
        projects: [makeProject({ id: "proj-1" })],
        activeProjectId: "proj-1",
      });
      mockFetch.mockResolvedValueOnce({ ok: false, status: 500 });

      await useProjectStore.getState().fetchProjects();

      expect(useProjectStore.getState().projects).toHaveLength(1);
      expect(useProjectStore.getState().activeProjectId).toBe("proj-1");
    });

    it("handles network error by keeping cached data", async () => {
      useProjectStore.setState({
        projects: [makeProject({ id: "proj-1" })],
        activeProjectId: "proj-1",
      });
      mockFetch.mockRejectedValueOnce(new Error("Network failure"));

      await useProjectStore.getState().fetchProjects();

      expect(useProjectStore.getState().projects).toHaveLength(1);
      expect(useProjectStore.getState().activeProjectId).toBe("proj-1");
    });
  });
});
