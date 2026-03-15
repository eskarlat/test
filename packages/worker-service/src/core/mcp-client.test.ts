import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { MCPClientImpl, type JsonRpcTransport } from "./mcp-client.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockTransport(): JsonRpcTransport & {
  _messageHandler: ((data: string) => void) | null;
  _simulateResponse: (data: string) => void;
} {
  let handler: ((data: string) => void) | null = null;
  return {
    send: vi.fn(),
    onMessage(h) {
      handler = h;
    },
    close: vi.fn(),
    get _messageHandler() {
      return handler;
    },
    _simulateResponse(data: string) {
      if (handler) handler(data);
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("MCPClientImpl", () => {
  let transport: ReturnType<typeof createMockTransport>;
  let client: MCPClientImpl;

  beforeEach(() => {
    vi.useFakeTimers();
    transport = createMockTransport();
    client = new MCPClientImpl(transport);
  });

  afterEach(() => {
    client.close();
    vi.useRealTimers();
  });

  // -----------------------------------------------------------------------
  // JSON-RPC request/response basics
  // -----------------------------------------------------------------------

  describe("request/response handling", () => {
    it("sends a valid JSON-RPC request via transport", async () => {
      const promise = client.listTools();

      // Respond immediately
      const sentMsg = JSON.parse((transport.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(sentMsg.jsonrpc).toBe("2.0");
      expect(sentMsg.method).toBe("tools/list");
      expect(sentMsg.id).toBe(1);

      transport._simulateResponse(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }),
      );

      const tools = await promise;
      expect(tools).toEqual([]);
    });

    it("increments request IDs", async () => {
      const p1 = client.listTools();
      const p2 = client.listResources();

      const call1 = JSON.parse((transport.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      const call2 = JSON.parse((transport.send as ReturnType<typeof vi.fn>).mock.calls[1][0]);
      expect(call1.id).toBe(1);
      expect(call2.id).toBe(2);

      transport._simulateResponse(JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }));
      transport._simulateResponse(JSON.stringify({ jsonrpc: "2.0", id: 2, result: { resources: [] } }));

      await p1;
      await p2;
    });

    it("resolves the correct pending request when responses arrive out of order", async () => {
      const p1 = client.listTools();
      const p2 = client.callTool("echo", { msg: "hi" });

      // Respond to id=2 first
      transport._simulateResponse(
        JSON.stringify({ jsonrpc: "2.0", id: 2, result: { text: "hi" } }),
      );
      transport._simulateResponse(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [{ name: "echo", description: "echo", inputSchema: {} }] } }),
      );

      const tools = await p1;
      const callResult = await p2;

      expect(tools).toHaveLength(1);
      expect(tools[0].name).toBe("echo");
      expect(callResult).toEqual({ text: "hi" });
    });
  });

  // -----------------------------------------------------------------------
  // Error handling
  // -----------------------------------------------------------------------

  describe("error handling", () => {
    it("rejects with the error message from a JSON-RPC error response", async () => {
      const promise = client.callTool("bad-tool", {});

      transport._simulateResponse(
        JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32601, message: "Method not found" } }),
      );

      await expect(promise).rejects.toThrow("Method not found");
    });

    it("ignores responses with unknown IDs", () => {
      // Should not throw
      transport._simulateResponse(
        JSON.stringify({ jsonrpc: "2.0", id: 999, result: "stale" }),
      );
    });

    it("ignores malformed JSON messages", () => {
      // Should not throw
      transport._simulateResponse("not valid json {{{");
    });
  });

  // -----------------------------------------------------------------------
  // Timeout
  // -----------------------------------------------------------------------

  describe("timeout", () => {
    it("rejects after 30s timeout", async () => {
      const promise = client.listTools();

      vi.advanceTimersByTime(30_000);

      await expect(promise).rejects.toThrow("MCP request timeout: tools/list");
    });

    it("does not reject if response arrives before timeout", async () => {
      const promise = client.listTools();

      vi.advanceTimersByTime(15_000);

      transport._simulateResponse(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools: [] } }),
      );

      const result = await promise;
      expect(result).toEqual([]);

      // Advancing past timeout should not cause issues
      vi.advanceTimersByTime(20_000);
    });
  });

  // -----------------------------------------------------------------------
  // API methods
  // -----------------------------------------------------------------------

  describe("listTools()", () => {
    it("returns tools from the result", async () => {
      const promise = client.listTools();
      const tools = [
        { name: "read_file", description: "Read a file", inputSchema: { type: "object" } },
        { name: "write_file", description: "Write a file", inputSchema: { type: "object" } },
      ];
      transport._simulateResponse(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { tools } }),
      );
      expect(await promise).toEqual(tools);
    });

    it("returns empty array when tools key is missing", async () => {
      const promise = client.listTools();
      transport._simulateResponse(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
      );
      expect(await promise).toEqual([]);
    });
  });

  describe("callTool()", () => {
    it("sends name and arguments as params", async () => {
      const promise = client.callTool("do_thing", { x: 1, y: "hello" });
      const sent = JSON.parse((transport.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(sent.method).toBe("tools/call");
      expect(sent.params).toEqual({ name: "do_thing", arguments: { x: 1, y: "hello" } });

      transport._simulateResponse(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } }),
      );
      expect(await promise).toEqual({ ok: true });
    });
  });

  describe("listResources()", () => {
    it("returns resources from the result", async () => {
      const promise = client.listResources();
      const resources = [{ uri: "file:///a.txt", name: "a.txt" }];
      transport._simulateResponse(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { resources } }),
      );
      expect(await promise).toEqual(resources);
    });

    it("returns empty array when resources key is missing", async () => {
      const promise = client.listResources();
      transport._simulateResponse(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: null }),
      );
      expect(await promise).toEqual([]);
    });
  });

  describe("readResource()", () => {
    it("sends the URI as params and returns result", async () => {
      const promise = client.readResource("file:///test.txt");
      const sent = JSON.parse((transport.send as ReturnType<typeof vi.fn>).mock.calls[0][0]);
      expect(sent.method).toBe("resources/read");
      expect(sent.params).toEqual({ uri: "file:///test.txt" });

      transport._simulateResponse(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { contents: [{ text: "hello" }] } }),
      );
      expect(await promise).toEqual({ contents: [{ text: "hello" }] });
    });
  });

  // -----------------------------------------------------------------------
  // close()
  // -----------------------------------------------------------------------

  describe("close()", () => {
    it("rejects all pending requests with 'MCP client closed'", async () => {
      const p1 = client.listTools();
      const p2 = client.callTool("foo", {});

      client.close();

      await expect(p1).rejects.toThrow("MCP client closed");
      await expect(p2).rejects.toThrow("MCP client closed");
    });

    it("calls transport.close()", () => {
      client.close();
      expect(transport.close).toHaveBeenCalledTimes(1);
    });

    it("clears pending map so no further responses match", async () => {
      const p1 = client.listTools();
      client.close();
      await expect(p1).rejects.toThrow("MCP client closed");

      // Late response should not cause errors
      transport._simulateResponse(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: {} }),
      );
    });
  });
});
