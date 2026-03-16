import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../core/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../core/paths.js", () => ({
  globalPaths: () => ({
    globalDir: "/tmp/test-renre-kit",
    serverJson: "/tmp/test-renre-kit/server.json",
    configFile: "/tmp/test-renre-kit/config.json",
  }),
}));

vi.mock("../shared/platform.js", () => ({
  setFilePermissions: vi.fn(),
}));

vi.mock("node:fs", () => ({
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

vi.mock("../core/extension-registry.js", () => ({
  mountProjectExtensions: vi.fn().mockResolvedValue([]),
  unmountAllForProject: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../core/event-bus.js", () => ({
  eventBus: { publish: vi.fn() },
}));

import { createTestApp, request } from "../test-helpers.js";
import router, { getRegistry } from "./projects.js";

describe("projects routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    getRegistry().clear();
    app = createTestApp(router);
  });

  describe("POST /api/projects/register", () => {
    it("registers a project successfully", async () => {
      const res = await request(app, "POST", "/api/projects/register", {
        id: "proj-1",
        name: "Test Project",
        path: "/tmp/test",
      });
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body.success).toBe(true);
      expect(body.projectId).toBe("proj-1");
      expect(getRegistry().has("proj-1")).toBe(true);
    });

    it("returns 400 when missing required fields", async () => {
      const res = await request(app, "POST", "/api/projects/register", { id: "p1" });
      expect(res.status).toBe(400);
    });

    it("updates existing project on re-register", async () => {
      await request(app, "POST", "/api/projects/register", {
        id: "proj-1", name: "Project v1", path: "/tmp/test",
      });
      const res = await request(app, "POST", "/api/projects/register", {
        id: "proj-1", name: "Project v2", path: "/tmp/test2",
      });
      expect(res.status).toBe(200);
      const project = getRegistry().get("proj-1");
      expect(project?.name).toBe("Project v2");
    });
  });

  describe("POST /api/projects/unregister", () => {
    it("unregisters a registered project", async () => {
      await request(app, "POST", "/api/projects/register", {
        id: "proj-1", name: "Test", path: "/tmp",
      });
      const res = await request(app, "POST", "/api/projects/unregister", { id: "proj-1" });
      expect(res.status).toBe(200);
      expect(getRegistry().has("proj-1")).toBe(false);
    });

    it("returns 404 if project not registered", async () => {
      const res = await request(app, "POST", "/api/projects/unregister", { id: "nonexistent" });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/projects", () => {
    it("returns empty array when no projects", async () => {
      const res = await request(app, "GET", "/api/projects");
      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it("returns registered projects", async () => {
      await request(app, "POST", "/api/projects/register", {
        id: "proj-1", name: "Project 1", path: "/p1",
      });
      await request(app, "POST", "/api/projects/register", {
        id: "proj-2", name: "Project 2", path: "/p2",
      });
      const res = await request(app, "GET", "/api/projects");
      expect(res.status).toBe(200);
      const projects = res.body as Array<Record<string, unknown>>;
      expect(projects).toHaveLength(2);
    });
  });
});
