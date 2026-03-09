import type { MCPClient, MCPTool, MCPResource } from "@renre-kit/extension-sdk";

export type JsonRpcTransport = {
  send(message: string): void;
  onMessage(handler: (data: string) => void): void;
  close(): void;
};

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string };
}

const REQUEST_TIMEOUT_MS = 30_000;

export class MCPClientImpl implements MCPClient {
  private nextId = 1;
  private pending = new Map<
    number,
    { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >();

  constructor(private transport: JsonRpcTransport) {
    transport.onMessage((data) => { this.handleMessage(data); });
  }

  private handleMessage(data: string): void {
    let msg: JsonRpcResponse;
    try {
      msg = JSON.parse(data) as JsonRpcResponse;
    } catch {
      return;
    }
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pending.delete(msg.id);
    if (msg.error) {
      pending.reject(new Error(msg.error.message));
    } else {
      pending.resolve(msg.result);
    }
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`MCP request timeout: ${method}`));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(id, { resolve, reject, timer });
      const req: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };
      this.transport.send(JSON.stringify(req));
    });
  }

  async listTools(): Promise<MCPTool[]> {
    const result = await this.request("tools/list");
    return ((result as Record<string, unknown>)?.tools ?? []) as MCPTool[];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.request("tools/call", { name, arguments: args });
  }

  async listResources(): Promise<MCPResource[]> {
    const result = await this.request("resources/list");
    return ((result as Record<string, unknown>)?.resources ?? []) as MCPResource[];
  }

  async readResource(uri: string): Promise<unknown> {
    return this.request("resources/read", { uri });
  }

  close(): void {
    for (const { reject, timer } of this.pending.values()) {
      clearTimeout(timer);
      reject(new Error("MCP client closed"));
    }
    this.pending.clear();
    this.transport.close();
  }
}
