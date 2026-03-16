import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";
import { Command } from "commander";

// Mock node:fs with memfs
vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return memfs.fs;
});

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
  intro: vi.fn(),
  outro: vi.fn(),
  confirm: vi.fn(),
  isCancel: vi.fn(() => false),
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), success: vi.fn() },
}));

// Mock paths
vi.mock("../utils/paths.js", () => ({
  globalPaths: vi.fn(() => ({
    globalDir: "/home/user/.renre-kit",
    backupsDir: "/home/user/.renre-kit/backups",
    dataDb: "/home/user/.renre-kit/data.db",
  })),
}));

// Mock server-client
vi.mock("../services/server-client.js", () => ({
  readServerState: vi.fn(),
  checkHealth: vi.fn(),
}));

// Mock logger — provide all used functions
vi.mock("../utils/logger.js", () => ({
  info: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
  warn: vi.fn(),
  spinner: vi.fn(() => ({
    stop: vi.fn(),
    message: vi.fn(),
  })),
  isInteractive: vi.fn(() => false),
}));

import { readServerState, checkHealth } from "../services/server-client.js";
import * as clack from "@clack/prompts";

const mockReadServerState = vi.mocked(readServerState);
const mockCheckHealth = vi.mocked(checkHealth);

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe("backup command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vol.reset();
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vol.reset();
    vi.restoreAllMocks();
  });

  async function runBackup(...args: string[]) {
    const { registerBackupCommand } = await import("./backup.js");
    const program = new Command();
    program.exitOverride();
    registerBackupCommand(program);
    return program.parseAsync(["node", "test", "backup", ...args]);
  }

  const serverState = {
    pid: 1234,
    port: 42888,
    startedAt: "2026-01-01T00:00:00Z",
    activeProjects: [] as string[],
  };

  const healthResponse = {
    status: "ok" as const,
    uptime: 100,
    memoryUsage: { heapUsed: 0, heapTotal: 0, rss: 0, external: 0, arrayBuffers: 0 },
    port: 42888,
    version: "0.1.0",
  };

  function mockServerRunning() {
    mockReadServerState.mockReturnValue(serverState);
    mockCheckHealth.mockResolvedValue(healthResponse);
  }

  describe("backup (create)", () => {
    it("exits if server is not running", async () => {
      mockReadServerState.mockReturnValue(null);

      await expect(runBackup()).rejects.toThrow("process.exit called");
    });

    it("exits if server is not responding to health check", async () => {
      mockReadServerState.mockReturnValue(serverState);
      mockCheckHealth.mockResolvedValue(null);

      await expect(runBackup()).rejects.toThrow("process.exit called");
    });

    it("creates backup successfully", async () => {
      mockServerRunning();
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ ok: true, path: "/backups/data-123.db" }),
      });

      await runBackup();

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:42888/api/backup",
        expect.objectContaining({ method: "POST" }),
      );
    });

    it("exits on backup API error", async () => {
      mockServerRunning();
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: () => Promise.resolve("Internal error"),
      });

      await expect(runBackup()).rejects.toThrow("process.exit called");
    });

    it("exits on fetch exception", async () => {
      mockServerRunning();
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(runBackup()).rejects.toThrow("process.exit called");
    });
  });

  describe("backup list", () => {
    it("shows message when no backups directory exists", async () => {
      await expect(runBackup("list")).resolves.not.toThrow();
    });

    it("shows message when backups directory is empty", async () => {
      vol.mkdirSync("/home/user/.renre-kit/backups", { recursive: true });

      await expect(runBackup("list")).resolves.not.toThrow();
    });

    it("lists .db files sorted by mtime", async () => {
      vol.mkdirSync("/home/user/.renre-kit/backups", { recursive: true });
      vol.writeFileSync("/home/user/.renre-kit/backups/data-001.db", "x".repeat(1024));
      vol.writeFileSync("/home/user/.renre-kit/backups/data-002.db", "y".repeat(2048));
      // Non-db files should be ignored
      vol.writeFileSync("/home/user/.renre-kit/backups/readme.txt", "ignore me");

      await runBackup("list");

      expect(consoleLogSpy).toHaveBeenCalled();
    });
  });

  describe("backup restore", () => {
    it("exits if backup file does not exist", async () => {
      vol.mkdirSync("/home/user/.renre-kit/backups", { recursive: true });

      await expect(runBackup("restore", "missing.db")).rejects.toThrow(
        "process.exit called",
      );
    });

    it("exits if server is running", async () => {
      vol.mkdirSync("/home/user/.renre-kit/backups", { recursive: true });
      vol.writeFileSync("/home/user/.renre-kit/backups/data-001.db", "backup-data");

      mockServerRunning();

      await expect(runBackup("restore", "data-001.db")).rejects.toThrow(
        "process.exit called",
      );
    });

    it("restores backup with -y flag (non-interactive)", async () => {
      vol.mkdirSync("/home/user/.renre-kit/backups", { recursive: true });
      vol.writeFileSync("/home/user/.renre-kit/backups/data-001.db", "backup-data");
      // Create the target database file
      vol.writeFileSync("/home/user/.renre-kit/data.db", "old-data");

      mockReadServerState.mockReturnValue(null);

      await runBackup("restore", "data-001.db", "-y");

      // Verify the database was overwritten
      const restored = vol.readFileSync("/home/user/.renre-kit/data.db", "utf8");
      expect(restored).toBe("backup-data");
    });

    it("cancels restore when user declines confirmation", async () => {
      vol.mkdirSync("/home/user/.renre-kit/backups", { recursive: true });
      vol.writeFileSync("/home/user/.renre-kit/backups/data-001.db", "backup-data");
      vol.writeFileSync("/home/user/.renre-kit/data.db", "old-data");

      mockReadServerState.mockReturnValue(null);

      // Simulate interactive mode
      const origTTY = process.stdout.isTTY;
      process.stdout.isTTY = true as any;

      vi.mocked(clack.confirm).mockResolvedValue(false);
      vi.mocked(clack.isCancel).mockReturnValue(false);

      const { isInteractive } = await import("../utils/logger.js");
      vi.mocked(isInteractive).mockReturnValue(true);

      await runBackup("restore", "data-001.db");

      // data.db should remain unchanged
      const data = vol.readFileSync("/home/user/.renre-kit/data.db", "utf8");
      expect(data).toBe("old-data");

      process.stdout.isTTY = origTTY as any;
    });
  });
});
