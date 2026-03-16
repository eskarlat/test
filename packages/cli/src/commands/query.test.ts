import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Command } from "commander";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
  intro: vi.fn(),
  outro: vi.fn(),
  log: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), success: vi.fn() },
}));

// Mock paths
vi.mock("../utils/paths.js", () => ({
  findProjectDir: vi.fn(),
}));

// Mock project-manager
vi.mock("../services/project-manager.js", () => ({
  readProjectJson: vi.fn(),
  readExtensionsJson: vi.fn(),
}));

// Mock pid
vi.mock("../utils/pid.js", () => ({
  readServerState: vi.fn(),
}));

// Mock formatter
vi.mock("../utils/formatter.js", () => ({
  formatJson: vi.fn((data: unknown) => JSON.stringify(data, null, 2)),
  formatTable: vi.fn((_h: string[], _r: string[][]) => "table-output"),
}));

// Mock logger
vi.mock("../utils/logger.js", () => ({
  isInteractive: vi.fn(() => false),
}));

import { findProjectDir } from "../utils/paths.js";
import { readProjectJson, readExtensionsJson } from "../services/project-manager.js";
import { readServerState } from "../utils/pid.js";
import { isInteractive } from "../utils/logger.js";
import { formatTable } from "../utils/formatter.js";

const mockFindProjectDir = vi.mocked(findProjectDir);
const mockReadProjectJson = vi.mocked(readProjectJson);
const mockReadExtensionsJson = vi.mocked(readExtensionsJson);
const mockReadServerState = vi.mocked(readServerState);
const mockIsInteractive = vi.mocked(isInteractive);
const mockFormatTable = vi.mocked(formatTable);

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch as unknown as typeof fetch;

describe("query command", () => {
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as any);
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Default: inside a project with a running server
    mockFindProjectDir.mockReturnValue("/my-project");
    mockReadProjectJson.mockReturnValue({ id: "proj-1", name: "My Project" });
    mockReadExtensionsJson.mockReturnValue({
      extensions: [{ name: "my-ext", version: "1.0.0", enabled: true, source: "repo" }],
    });
    mockReadServerState.mockReturnValue({
      pid: 1234,
      port: 42888,
      startedAt: "2026-01-01T00:00:00Z",
      activeProjects: ["proj-1"],
    });
  });

  afterEach(() => {
    exitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  async function runQuery(...args: string[]) {
    const { registerQueryCommand } = await import("./query.js");
    const program = new Command();
    program.exitOverride();
    registerQueryCommand(program);
    return program.parseAsync(["node", "test", "query", ...args]);
  }

  it("builds URL with project id, extension and action", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result: "ok" }),
    });

    await runQuery("my-ext", "do-thing");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:42888/api/proj-1/my-ext/do-thing",
      expect.any(Object),
    );
  });

  it("builds URL without action when action is omitted", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result: "ok" }),
    });

    await runQuery("my-ext");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:42888/api/proj-1/my-ext",
      expect.any(Object),
    );
  });

  it("appends extra args as query params", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ result: "ok" }),
    });

    await runQuery("my-ext", "action", "foo", "bar");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("arg0=foo");
    expect(calledUrl).toContain("arg1=bar");
  });

  it("defaults to GET when no --data provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await runQuery("my-ext", "action");

    const fetchOpts = mockFetch.mock.calls[0][1] as RequestInit;
    expect(fetchOpts.method).toBe("GET");
  });

  it("defaults to POST when --data is provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await runQuery("my-ext", "action", "--data", '{"key":"val"}');

    const fetchOpts = mockFetch.mock.calls[0][1] as RequestInit;
    expect(fetchOpts.method).toBe("POST");
    expect(fetchOpts.body).toBe('{"key":"val"}');
  });

  it("uses explicit --method override", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await runQuery("my-ext", "action", "--method", "PUT");

    const fetchOpts = mockFetch.mock.calls[0][1] as RequestInit;
    expect(fetchOpts.method).toBe("PUT");
  });

  it("exits with error on invalid --data JSON", async () => {
    await expect(
      runQuery("my-ext", "action", "--data", "not-json"),
    ).rejects.toThrow("process.exit called");

    const allErrors = consoleErrorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allErrors).toContain("Invalid JSON");
  });

  it("outputs JSON by default (non-interactive)", async () => {
    mockIsInteractive.mockReturnValue(false);
    const data = { foo: "bar" };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(data),
    });

    await runQuery("my-ext", "action");

    expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
  });

  it("outputs table for array-of-objects in interactive mode without --json", async () => {
    mockIsInteractive.mockReturnValue(true);
    const data = [
      { id: 1, name: "a" },
      { id: 2, name: "b" },
    ];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(data),
    });

    await runQuery("my-ext", "action");

    expect(mockFormatTable).toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith("table-output");
  });

  it("forces JSON output with --json flag even in interactive mode", async () => {
    mockIsInteractive.mockReturnValue(true);
    const data = [{ id: 1 }];
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(data),
    });

    await runQuery("my-ext", "action", "--json");

    expect(mockFormatTable).not.toHaveBeenCalled();
    expect(consoleLogSpy).toHaveBeenCalledWith(JSON.stringify(data, null, 2));
  });

  it("exits if not in a project and no --project flag", async () => {
    mockFindProjectDir.mockReturnValue(null);

    await expect(runQuery("my-ext", "action")).rejects.toThrow("process.exit called");

    const allErrors = consoleErrorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allErrors).toContain("Not inside a renre-kit project");
  });

  it("uses --project override for project ID", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({}),
    });

    await runQuery("my-ext", "action", "--project", "custom-id");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/api/custom-id/my-ext/action");
  });

  it("exits if extension is not installed", async () => {
    mockReadExtensionsJson.mockReturnValue({
      extensions: [{ name: "other-ext", version: "1.0.0", enabled: true, source: "repo" }],
    });

    await expect(runQuery("my-ext", "action")).rejects.toThrow("process.exit called");

    const allErrors = consoleErrorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allErrors).toContain('Extension "my-ext" not installed');
  });

  it("exits if server is not running", async () => {
    mockReadServerState.mockReturnValue(null);

    await expect(runQuery("my-ext", "action")).rejects.toThrow("process.exit called");

    const allErrors = consoleErrorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allErrors).toContain("Worker service not running");
  });

  it("handles HTTP error response with error body", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: () => Promise.resolve({ error: "Not found" }),
    });

    await expect(runQuery("my-ext", "action")).rejects.toThrow("process.exit called");

    const allErrors = consoleErrorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allErrors).toContain("Not found");
  });

  it("handles ECONNREFUSED fetch error", async () => {
    const err = new Error("fetch failed") as NodeJS.ErrnoException;
    err.code = "ECONNREFUSED";
    mockFetch.mockRejectedValueOnce(err);

    await expect(runQuery("my-ext", "action")).rejects.toThrow("process.exit called");

    const allErrors = consoleErrorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allErrors).toContain("Worker service not running");
  });

  it("handles timeout error", async () => {
    const err = new Error("The operation was aborted");
    err.name = "TimeoutError";
    mockFetch.mockRejectedValueOnce(err);

    await expect(runQuery("my-ext", "action")).rejects.toThrow("process.exit called");

    const allErrors = consoleErrorSpy.mock.calls.map((c) => c[0]).join("\n");
    expect(allErrors).toContain("not responding");
  });
});
