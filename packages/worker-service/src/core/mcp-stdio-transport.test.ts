import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter, Readable, Writable } from "node:events";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

vi.mock("./paths.js", () => ({
  globalPaths: () => ({ globalDir: "/tmp/test-global" }),
}));

const mocks = vi.hoisted(() => ({
  spawn: vi.fn(),
  existsSync: vi.fn().mockReturnValue(false),
  readFileSync: vi.fn(),
}));

vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
}));

import { validateStdioCommand, StdioTransport } from "./mcp-stdio-transport.js";

describe("validateStdioCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.existsSync.mockReturnValue(false);
  });

  it("allows built-in commands", () => {
    for (const cmd of ["node", "npx", "python", "python3", "deno", "bun", "uvx", "docker"]) {
      expect(() => validateStdioCommand(cmd, [])).not.toThrow();
    }
  });

  it("rejects unknown commands", () => {
    expect(() => validateStdioCommand("rm", [])).toThrow(/not in allowlist/);
  });

  it("rejects shell metacharacters in args", () => {
    expect(() => validateStdioCommand("node", ["script.js; rm -rf /"])).toThrow(/shell metacharacter/);
    expect(() => validateStdioCommand("node", ["$(whoami)"])).toThrow(/shell metacharacter/);
    expect(() => validateStdioCommand("node", ["a | b"])).toThrow(/shell metacharacter/);
    expect(() => validateStdioCommand("node", ["a & b"])).toThrow(/shell metacharacter/);
    expect(() => validateStdioCommand("node", ["`cmd`"])).toThrow(/shell metacharacter/);
  });

  it("allows safe args", () => {
    expect(() => validateStdioCommand("node", ["--port=3000", "server.js"])).not.toThrow();
  });

  it("reads extra allowed commands from config", () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify({ mcp: { allowedCommands: ["custom-tool"] } }));
    expect(() => validateStdioCommand("custom-tool", [])).not.toThrow();
  });

  it("handles malformed config gracefully", () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockImplementation(() => { throw new Error("read error"); });
    // Should still work with built-in commands
    expect(() => validateStdioCommand("node", [])).not.toThrow();
    expect(() => validateStdioCommand("custom-tool", [])).toThrow(/not in allowlist/);
  });
});

describe("StdioTransport", () => {
  function createMockProcess() {
    const stdout = new EventEmitter();
    const stderr = new EventEmitter();
    const stdin = { writable: true, write: vi.fn() };
    const proc = Object.assign(new EventEmitter(), {
      stdout,
      stderr,
      stdin,
      pid: 1234,
      kill: vi.fn(),
    });
    return proc;
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("spawns a process and emits messages from stdout", () => {
    const proc = createMockProcess();
    mocks.spawn.mockReturnValue(proc);

    const transport = new StdioTransport("node", ["server.js"], {});
    const messages: string[] = [];
    transport.onMessage((msg) => messages.push(msg));

    // Simulate stdout data
    proc.stdout.emit("data", Buffer.from('{"jsonrpc":"2.0","id":1}\n'));

    expect(messages).toEqual(['{"jsonrpc":"2.0","id":1}']);
    expect(transport.pid).toBe(1234);
    transport.close();
  });

  it("buffers partial lines", () => {
    const proc = createMockProcess();
    mocks.spawn.mockReturnValue(proc);

    const transport = new StdioTransport("node", [], {});
    const messages: string[] = [];
    transport.onMessage((msg) => messages.push(msg));

    proc.stdout.emit("data", Buffer.from('{"partial":'));
    expect(messages).toHaveLength(0);

    proc.stdout.emit("data", Buffer.from('"value"}\n'));
    expect(messages).toEqual(['{"partial":"value"}']);
    transport.close();
  });

  it("sends message to stdin", () => {
    const proc = createMockProcess();
    mocks.spawn.mockReturnValue(proc);

    const transport = new StdioTransport("node", [], {});
    transport.send("hello");
    expect(proc.stdin.write).toHaveBeenCalledWith("hello\n");
    transport.close();
  });

  it("throws when sending to non-writable stdin", () => {
    const proc = createMockProcess();
    proc.stdin.writable = false;
    mocks.spawn.mockReturnValue(proc);

    const transport = new StdioTransport("node", [], {});
    expect(() => transport.send("hello")).toThrow("MCP stdio process not running");
    transport.close();
  });

  it("closes process on close()", () => {
    const proc = createMockProcess();
    mocks.spawn.mockReturnValue(proc);

    const transport = new StdioTransport("node", [], {});
    transport.close();
    expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("emits disconnected on process exit", () => {
    const proc = createMockProcess();
    mocks.spawn.mockReturnValue(proc);

    const transport = new StdioTransport("node", [], {});
    const disconnected = vi.fn();
    transport.on("disconnected", disconnected);

    proc.emit("exit", 1);
    expect(disconnected).toHaveBeenCalled();
    transport.close();
  });
});
