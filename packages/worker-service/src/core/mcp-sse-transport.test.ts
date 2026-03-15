import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// We need to prevent the constructor from immediately calling connect/fetch
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
}));

vi.stubGlobal("fetch", mocks.fetch);

import { SSETransport } from "./mcp-sse-transport.js";
import { logger } from "./logger.js";

describe("SSETransport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: fetch hangs forever (doesn't resolve)
    mocks.fetch.mockImplementation(() => new Promise(() => {}));
  });

  it("calls fetch with SSE headers on construction", () => {
    const transport = new SSETransport("http://localhost:3000/sse", { Authorization: "Bearer test" });
    expect(mocks.fetch).toHaveBeenCalledWith(
      "http://localhost:3000/sse",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "text/event-stream",
          Authorization: "Bearer test",
        }),
      }),
    );
    transport.close();
  });

  it("emits messages from SSE data lines", async () => {
    // Create a readable stream that emits SSE data
    const encoder = new TextEncoder();
    let controller: ReadableStreamDefaultController;
    const stream = new ReadableStream({
      start(c) { controller = c; },
    });

    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      body: stream,
    });

    const transport = new SSETransport("http://localhost:3000/sse", {});
    const messages: string[] = [];
    transport.onMessage((msg) => messages.push(msg));

    // Wait for connect to resolve
    await vi.waitFor(() => {
      expect(mocks.fetch).toHaveBeenCalled();
    });

    // Give the connect() async function time to process
    await new Promise((r) => setTimeout(r, 10));

    // Send SSE data
    controller!.enqueue(encoder.encode('data: {"id":1}\n'));
    await new Promise((r) => setTimeout(r, 10));

    expect(messages).toContain('{"id":1}');
    transport.close();
  });

  it("send logs a warning (SSE is receive-only)", () => {
    const transport = new SSETransport("http://localhost:3000/sse", {});
    transport.send("test message");
    expect(logger.warn).toHaveBeenCalledWith("ext:mcp:sse", expect.stringContaining("Cannot send"));
    transport.close();
  });

  it("close aborts the connection", () => {
    const transport = new SSETransport("http://localhost:3000/sse", {});
    transport.close();
    // Second close should be safe
    transport.close();
  });

  it("emits disconnected on fetch error", async () => {
    mocks.fetch.mockRejectedValueOnce(new Error("Network error"));
    // Prevent reconnect
    const transport = new SSETransport("http://localhost:3000/sse", {});
    const disconnected = vi.fn();
    transport.on("disconnected", disconnected);

    await new Promise((r) => setTimeout(r, 20));
    expect(disconnected).toHaveBeenCalled();
    transport.close();
  });

  it("emits disconnected on non-ok response", async () => {
    mocks.fetch.mockResolvedValueOnce({ ok: false, status: 500 });
    const transport = new SSETransport("http://localhost:3000/sse", {});
    const disconnected = vi.fn();
    transport.on("disconnected", disconnected);

    await new Promise((r) => setTimeout(r, 20));
    expect(disconnected).toHaveBeenCalled();
    transport.close();
  });
});
