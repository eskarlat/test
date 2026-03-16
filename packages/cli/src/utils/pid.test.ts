import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return memfs.fs;
});

vi.mock("./paths.js", () => ({
  globalPaths: () => ({
    globalDir: "/home/test/.renre-kit",
    serverPid: "/home/test/.renre-kit/server.pid",
    serverJson: "/home/test/.renre-kit/server.json",
  }),
}));

vi.mock("../shared/platform.js", () => ({
  setFilePermissions: vi.fn(),
}));

describe("pid utilities", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync("/home/test/.renre-kit", { recursive: true });
  });

  afterEach(() => {
    vol.reset();
  });

  describe("readPid / writePid / deletePid", () => {
    it("returns null when no PID file", async () => {
      const { readPid } = await import("./pid.js");
      expect(readPid()).toBeNull();
    });

    it("writes and reads PID", async () => {
      const { writePid, readPid } = await import("./pid.js");
      writePid(12345);
      expect(readPid()).toBe(12345);
    });

    it("deletePid removes PID file", async () => {
      const { writePid, readPid, deletePid } = await import("./pid.js");
      writePid(12345);
      deletePid();
      expect(readPid()).toBeNull();
    });

    it("returns null for invalid PID content", async () => {
      vol.writeFileSync("/home/test/.renre-kit/server.pid", "not-a-number\n");
      const { readPid } = await import("./pid.js");
      expect(readPid()).toBeNull();
    });
  });

  describe("readServerState / writeServerState / deleteServerState", () => {
    it("returns null when no server.json", async () => {
      const { readServerState } = await import("./pid.js");
      expect(readServerState()).toBeNull();
    });

    it("writes and reads server state", async () => {
      const { writeServerState, readServerState } = await import("./pid.js");
      const state = {
        pid: 1234,
        port: 42888,
        startedAt: "2026-01-01T00:00:00Z",
        activeProjects: ["proj-1"],
      };
      writeServerState(state);
      const result = readServerState();
      expect(result).toEqual(state);
    });

    it("deleteServerState removes server.json", async () => {
      const { writeServerState, readServerState, deleteServerState } = await import("./pid.js");
      writeServerState({ pid: 1, port: 42888, startedAt: "now", activeProjects: [] });
      deleteServerState();
      expect(readServerState()).toBeNull();
    });

    it("returns null on invalid JSON", async () => {
      vol.writeFileSync("/home/test/.renre-kit/server.json", "not json");
      const { readServerState } = await import("./pid.js");
      expect(readServerState()).toBeNull();
    });
  });

  describe("isPidAlive", () => {
    it("returns true for current process", async () => {
      const { isPidAlive } = await import("./pid.js");
      expect(isPidAlive(process.pid)).toBe(true);
    });

    it("returns false for non-existent PID", async () => {
      const { isPidAlive } = await import("./pid.js");
      // Use a very high PID unlikely to exist
      expect(isPidAlive(999999)).toBe(false);
    });
  });

  describe("isServerRunning", () => {
    it("returns false when no PID file", async () => {
      const { isServerRunning } = await import("./pid.js");
      expect(isServerRunning()).toBe(false);
    });

    it("returns true when PID is alive", async () => {
      const { writePid, isServerRunning } = await import("./pid.js");
      writePid(process.pid);
      expect(isServerRunning()).toBe(true);
    });
  });
});
