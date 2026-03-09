import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import type { JsonRpcTransport } from "./mcp-client.js";
import { logger } from "./logger.js";
import { globalPaths } from "./paths.js";

const BUILTIN_ALLOWED = new Set([
  "node",
  "npx",
  "python",
  "python3",
  "deno",
  "bun",
  "uvx",
  "docker",
]);

const SHELL_METACHAR_RE = /[;&|`$()><]/;
const MAX_RETRIES = 3;
const RETRY_BASE_MS = 1000;

function getAllowedCommands(): string[] {
  try {
    const { globalDir } = globalPaths();
    const configFile = join(globalDir, "config.json");
    if (!existsSync(configFile)) return [];
    const config = JSON.parse(
      readFileSync(configFile, "utf8"),
    ) as { mcp?: { allowedCommands?: string[] } };
    return config.mcp?.allowedCommands ?? [];
  } catch {
    return [];
  }
}

export function validateStdioCommand(command: string, args: string[]): void {
  const extraAllowed = getAllowedCommands();
  const allowed = new Set([...BUILTIN_ALLOWED, ...extraAllowed]);

  if (!allowed.has(command)) {
    throw new Error(
      `MCP command "${command}" not in allowlist. Allowed: ${[...allowed].join(", ")}`,
    );
  }

  for (const arg of args) {
    if (SHELL_METACHAR_RE.test(arg)) {
      throw new Error(`MCP arg contains shell metacharacter: "${arg}"`);
    }
  }
}

export class StdioTransport extends EventEmitter implements JsonRpcTransport {
  private process: ChildProcess | null = null;
  private buffer = "";
  private retries = 0;
  private closed = false;
  private _pid: number | undefined;

  constructor(
    private command: string,
    private args: string[],
    private env: Record<string, string>,
    private cwd?: string,
  ) {
    super();
    this.spawnProcess();
  }

  get pid(): number | undefined {
    return this._pid;
  }

  private spawnProcess(): void {
    if (this.closed) return;

    this.process = spawn(this.command, this.args, {
      env: { ...process.env, ...this.env },
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });

    this._pid = this.process.pid;

    this.process.stdout?.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      const lines = this.buffer.split("\n");
      this.buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (line.trim()) this.emit("message", line);
      }
    });

    this.process.stderr?.on("data", (chunk: Buffer) => {
      logger.debug(`ext:mcp:${this.command}`, chunk.toString().trim());
    });

    this.process.on("exit", (code) => {
      if (this.closed) return;
      logger.warn(
        `ext:mcp:${this.command}`,
        `Process exited with code ${code ?? "null"}`,
      );
      this.emit("disconnected");
      this.scheduleRestart();
    });
  }

  private scheduleRestart(): void {
    if (this.closed || this.retries >= MAX_RETRIES) {
      logger.error(`ext:mcp:${this.command}`, "Max retries reached, giving up");
      return;
    }
    const delay = RETRY_BASE_MS * Math.pow(2, this.retries);
    this.retries++;
    setTimeout(() => {
      this.spawnProcess();
      this.emit("reconnected");
    }, delay).unref();
  }

  send(message: string): void {
    if (!this.process?.stdin?.writable) {
      throw new Error("MCP stdio process not running");
    }
    this.process.stdin.write(message + "\n");
  }

  onMessage(handler: (data: string) => void): void {
    this.on("message", handler);
  }

  close(): void {
    this.closed = true;
    try {
      this.process?.kill("SIGTERM");
    } catch {
      // already dead
    }
    this.process = null;
  }
}
