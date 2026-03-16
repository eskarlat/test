import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return memfs.fs;
});

vi.mock("../utils/paths.js", () => ({
  globalPaths: () => ({
    globalDir: "/home/test/.renre-kit",
    configFile: "/home/test/.renre-kit/config.json",
    projectsDir: "/home/test/.renre-kit/projects",
  }),
  projectPaths: (dir: string) => ({
    renreKitDir: `${dir}/.renre-kit`,
    projectJson: `${dir}/.renre-kit/project.json`,
    extensionsJson: `${dir}/.renre-kit/extensions.json`,
    hooksDir: `${dir}/.github/hooks`,
    hooksJson: `${dir}/.github/hooks/renre-kit.json`,
    skillsDir: `${dir}/.github/skills`,
    scriptsDir: `${dir}/.renre-kit/scripts`,
    gitignore: `${dir}/.gitignore`,
  }),
}));

describe("project-manager", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync("/test-project/.renre-kit", { recursive: true });
    vol.mkdirSync("/home/test/.renre-kit/projects", { recursive: true });
  });

  afterEach(() => {
    vol.reset();
  });

  it("writeProjectJson creates project.json", async () => {
    const { writeProjectJson, readProjectJson } = await import("./project-manager.js");
    writeProjectJson("/test-project", {
      $schema: "https://example.com/project.json",
      id: "proj-123",
      name: "My Project",
    });
    const data = readProjectJson("/test-project");
    expect(data).not.toBeNull();
    expect(data!.id).toBe("proj-123");
    expect(data!.name).toBe("My Project");
  });

  it("readProjectJson returns null when file missing", async () => {
    const { readProjectJson } = await import("./project-manager.js");
    expect(readProjectJson("/nonexistent")).toBeNull();
  });

  it("writeExtensionsJson creates extensions.json", async () => {
    const { writeExtensionsJson, readExtensionsJson } = await import("./project-manager.js");
    writeExtensionsJson("/test-project", {
      $schema: "https://example.com/extensions.json",
      extensions: [
        { name: "ext-a", version: "1.0.0", enabled: true, source: "marketplace" },
      ],
    });
    const data = readExtensionsJson("/test-project");
    expect(data).not.toBeNull();
    expect(data!.extensions).toHaveLength(1);
    expect(data!.extensions[0]!.name).toBe("ext-a");
  });

  it("readExtensionsJson returns null when file missing", async () => {
    const { readExtensionsJson } = await import("./project-manager.js");
    expect(readExtensionsJson("/nonexistent")).toBeNull();
  });

  it("writeGlobalProjectMeta creates meta file", async () => {
    const { writeGlobalProjectMeta, readGlobalProjectMeta } = await import("./project-manager.js");
    writeGlobalProjectMeta("proj-abc", { name: "Test", path: "/test-project" });
    const data = readGlobalProjectMeta("proj-abc");
    expect(data).not.toBeNull();
    expect(data!.name).toBe("Test");
    expect(data!.path).toBe("/test-project");
  });

  it("readGlobalProjectMeta returns null when file missing", async () => {
    const { readGlobalProjectMeta } = await import("./project-manager.js");
    expect(readGlobalProjectMeta("nonexistent")).toBeNull();
  });
});
