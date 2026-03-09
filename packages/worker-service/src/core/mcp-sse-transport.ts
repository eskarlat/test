import { EventEmitter } from "node:events";
import type { JsonRpcTransport } from "./mcp-client.js";
import { logger } from "./logger.js";

const RECONNECT_BASE_MS = 1000;
const MAX_RECONNECT_MS = 30_000;

export class SSETransport extends EventEmitter implements JsonRpcTransport {
  private controller: AbortController | null = null;
  private reconnectMs = RECONNECT_BASE_MS;
  private closed = false;

  constructor(
    private url: string,
    private headers: Record<string, string>,
  ) {
    super();
    // eslint-disable-next-line sonarjs/void-use
    void this.connect();
  }

  private async connect(): Promise<void> {
    if (this.closed) return;
    this.controller = new AbortController();
    try {
      const res = await fetch(this.url, {
        headers: { ...this.headers, Accept: "text/event-stream" },
        signal: this.controller.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(`SSE connect failed: ${res.status}`);
      }
      this.reconnectMs = RECONNECT_BASE_MS; // reset on success
      this.emit("connected");

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (line.startsWith("data: ")) {
            this.emit("message", line.slice(6));
          }
        }
      }
    } catch (err) {
      if (this.closed) return;
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn("ext:mcp:sse", `Connection lost: ${msg}`);
      this.emit("disconnected");
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.closed) return;
    // eslint-disable-next-line sonarjs/void-use
    setTimeout(() => { void this.connect(); }, this.reconnectMs).unref();
    this.reconnectMs = Math.min(this.reconnectMs * 2, MAX_RECONNECT_MS);
  }

  send(message: string): void {
    // SSE is receive-only for standard transport; POST to a companion endpoint
    logger.warn("ext:mcp:sse", `Cannot send over SSE: ${message.slice(0, 50)}`);
  }

  onMessage(handler: (data: string) => void): void {
    this.on("message", handler);
  }

  close(): void {
    this.closed = true;
    this.controller?.abort();
  }
}
