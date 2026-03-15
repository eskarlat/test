import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mocks — must be set up before importing the module under test
// ---------------------------------------------------------------------------

vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("./event-bus.js", () => ({
  eventBus: {
    publish: vi.fn(),
    on: vi.fn(),
    removeAllListeners: vi.fn(),
  },
}));

vi.mock("./vault-resolver.js", () => ({
  getSecret: vi.fn((key: string) => {
    if (key === "my-api-key") return "resolved-secret-123";
    return undefined;
  }),
}));

const mockStdioTransportInstance = {
  send: vi.fn(),
  onMessage: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
  pid: 12345,
};

const mockSSETransportInstance = {
  send: vi.fn(),
  onMessage: vi.fn(),
  close: vi.fn(),
  on: vi.fn(),
};

vi.mock("./mcp-stdio-transport.js", () => ({
  StdioTransport: vi.fn().mockImplementation(() => mockStdioTransportInstance),
  validateStdioCommand: vi.fn(),
}));

vi.mock("./mcp-sse-transport.js", () => ({
  SSETransport: vi.fn().mockImplementation(() => mockSSETransportInstance),
}));

// ---------------------------------------------------------------------------
// Imports (after mocks)
// ---------------------------------------------------------------------------

import * as mcpManager from "./mcp-manager.js";
import { validateStdioCommand } from "./mcp-stdio-transport.js";
import { SSETransport } from "./mcp-sse-transport.js";
import { StdioTransport } from "./mcp-stdio-transport.js";
import { eventBus } from "./event-bus.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("mcp-manager", () => {
  beforeEach(() => {
    // Disconnect everything to start fresh (the module uses a module-level Map)
    // We must be careful because connections persist across tests
    mcpManager.disconnectAll("proj-test");
    mcpManager.disconnectAll("proj-other");
    vi.clearAllMocks();
  });

  // -----------------------------------------------------------------------
  // connect() — stdio
  // -----------------------------------------------------------------------

  describe("connect() — stdio transport", () => {
    it("creates a new stdio connection and returns a client", () => {
      const client = mcpManager.connect("proj-test", "ext-a", {
        transport: "stdio",
        command: "node",
        args: ["server.js"],
      });

      expect(client).toBeDefined();
      expect(validateStdioCommand).toHaveBeenCalledWith("node", ["server.js"]);
      expect(StdioTransport).toHaveBeenCalledWith("node", ["server.js"], {});
    });

    it("returns the same client on subsequent calls for the same project+extension", () => {
      const client1 = mcpManager.connect("proj-test", "ext-a", {
        transport: "stdio",
        command: "node",
        args: ["server.js"],
      });
      const client2 = mcpManager.connect("proj-test", "ext-a", {
        transport: "stdio",
        command: "node",
        args: ["server.js"],
      });

      expect(client1).toBe(client2);
      // StdioTransport should only be constructed once
      expect(StdioTransport).toHaveBeenCalledTimes(1);
    });

    it("resolves vault references in env", () => {
      mcpManager.connect("proj-test", "ext-vault", {
        transport: "stdio",
        command: "node",
        args: ["server.js"],
        env: {
          API_KEY: "${VAULT:my-api-key}",
          PLAIN: "plain-value",
        },
      });

      expect(StdioTransport).toHaveBeenCalledWith("node", ["server.js"], {
        API_KEY: "resolved-secret-123",
        PLAIN: "plain-value",
      });
    });

    it("keeps vault placeholder when secret is not found", () => {
      mcpManager.connect("proj-test", "ext-missing", {
        transport: "stdio",
        command: "node",
        args: [],
        env: { TOKEN: "${VAULT:unknown-key}" },
      });

      expect(StdioTransport).toHaveBeenCalledWith("node", [], {
        TOKEN: "${VAULT:unknown-key}",
      });
    });

    it("throws when validateStdioCommand fails", () => {
      (validateStdioCommand as ReturnType<typeof vi.fn>).mockImplementationOnce(() => {
        throw new Error("Command not allowed: rm");
      });

      expect(() =>
        mcpManager.connect("proj-test", "ext-bad", {
          transport: "stdio",
          command: "rm",
          args: ["-rf", "/"],
        }),
      ).toThrow("Command not allowed: rm");
    });

    it("registers disconnected/reconnected event handlers on transport", () => {
      mcpManager.connect("proj-test", "ext-events", {
        transport: "stdio",
        command: "node",
        args: [],
      });

      // Check that .on was called for both events
      const onCalls = mockStdioTransportInstance.on.mock.calls;
      const eventNames = onCalls.map((c: unknown[]) => c[0]);
      expect(eventNames).toContain("disconnected");
      expect(eventNames).toContain("reconnected");
    });

    it("publishes mcp:disconnected when transport emits disconnected", () => {
      mcpManager.connect("proj-test", "ext-disc", {
        transport: "stdio",
        command: "node",
        args: [],
      });

      // Find and invoke the disconnected handler
      const disconnectedCall = mockStdioTransportInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === "disconnected",
      );
      disconnectedCall[1]();

      expect(eventBus.publish).toHaveBeenCalledWith("mcp:disconnected", {
        name: "ext-disc",
        projectId: "proj-test",
      });
    });

    it("publishes mcp:connected when transport emits reconnected", () => {
      mcpManager.connect("proj-test", "ext-recon", {
        transport: "stdio",
        command: "node",
        args: [],
      });

      const reconnectedCall = mockStdioTransportInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === "reconnected",
      );
      reconnectedCall[1]();

      expect(eventBus.publish).toHaveBeenCalledWith("mcp:connected", {
        name: "ext-recon",
        projectId: "proj-test",
      });
    });
  });

  // -----------------------------------------------------------------------
  // connect() — SSE
  // -----------------------------------------------------------------------

  describe("connect() — SSE transport", () => {
    it("creates an SSE connection", () => {
      const client = mcpManager.connect("proj-test", "ext-sse", {
        transport: "sse",
        url: "https://example.com/sse",
        headers: { Authorization: "Bearer token" },
      });

      expect(client).toBeDefined();
      expect(SSETransport).toHaveBeenCalledWith("https://example.com/sse", {
        Authorization: "Bearer token",
      });
    });

    it("resolves vault references in headers", () => {
      mcpManager.connect("proj-test", "ext-sse-vault", {
        transport: "sse",
        url: "https://example.com/sse",
        headers: { Authorization: "${VAULT:my-api-key}" },
      });

      expect(SSETransport).toHaveBeenCalledWith("https://example.com/sse", {
        Authorization: "resolved-secret-123",
      });
    });

    it("registers connected/disconnected event handlers", () => {
      mcpManager.connect("proj-test", "ext-sse-ev", {
        transport: "sse",
        url: "https://example.com/sse",
      });

      const onCalls = mockSSETransportInstance.on.mock.calls;
      const eventNames = onCalls.map((c: unknown[]) => c[0]);
      expect(eventNames).toContain("connected");
      expect(eventNames).toContain("disconnected");
    });
  });

  // -----------------------------------------------------------------------
  // disconnect()
  // -----------------------------------------------------------------------

  describe("disconnect()", () => {
    it("closes the client and removes the entry", () => {
      mcpManager.connect("proj-test", "ext-close", {
        transport: "stdio",
        command: "node",
        args: [],
      });

      mcpManager.disconnect("proj-test", "ext-close");

      expect(mcpManager.getClient("proj-test", "ext-close")).toBeNull();
    });

    it("is a no-op for non-existent project", () => {
      // Should not throw
      mcpManager.disconnect("nonexistent-project", "ext");
    });

    it("is a no-op for non-existent extension", () => {
      mcpManager.connect("proj-test", "ext-x", {
        transport: "stdio",
        command: "node",
        args: [],
      });

      // Disconnecting a different extension should not affect ext-x
      mcpManager.disconnect("proj-test", "ext-y");
      expect(mcpManager.getClient("proj-test", "ext-x")).not.toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // disconnectAll()
  // -----------------------------------------------------------------------

  describe("disconnectAll()", () => {
    it("disconnects all extensions for a project", () => {
      mcpManager.connect("proj-test", "ext-1", {
        transport: "stdio",
        command: "node",
        args: [],
      });
      mcpManager.connect("proj-test", "ext-2", {
        transport: "sse",
        url: "https://example.com/sse",
      });

      mcpManager.disconnectAll("proj-test");

      expect(mcpManager.getClient("proj-test", "ext-1")).toBeNull();
      expect(mcpManager.getClient("proj-test", "ext-2")).toBeNull();
    });

    it("is a no-op for non-existent project", () => {
      // Should not throw
      mcpManager.disconnectAll("nonexistent");
    });
  });

  // -----------------------------------------------------------------------
  // getClient()
  // -----------------------------------------------------------------------

  describe("getClient()", () => {
    it("returns the client for an active connection", () => {
      const connected = mcpManager.connect("proj-test", "ext-get", {
        transport: "stdio",
        command: "node",
        args: [],
      });

      const retrieved = mcpManager.getClient("proj-test", "ext-get");
      expect(retrieved).toBe(connected);
    });

    it("returns null when no connection exists", () => {
      expect(mcpManager.getClient("proj-test", "no-such-ext")).toBeNull();
    });

    it("returns null for non-existent project", () => {
      expect(mcpManager.getClient("no-project", "ext")).toBeNull();
    });
  });

  // -----------------------------------------------------------------------
  // getStatus()
  // -----------------------------------------------------------------------

  describe("getStatus()", () => {
    it("returns status for all connections in a project", () => {
      mcpManager.connect("proj-test", "ext-s1", {
        transport: "stdio",
        command: "node",
        args: [],
      });
      mcpManager.connect("proj-test", "ext-s2", {
        transport: "sse",
        url: "https://example.com",
      });

      const statuses = mcpManager.getStatus("proj-test");
      expect(statuses).toHaveLength(2);

      const s1 = statuses.find((s) => s.extensionName === "ext-s1");
      expect(s1).toBeDefined();
      expect(s1!.transport).toBe("stdio");
      expect(s1!.pid).toBe(12345);
      expect(typeof s1!.uptime).toBe("number");

      const s2 = statuses.find((s) => s.extensionName === "ext-s2");
      expect(s2).toBeDefined();
      expect(s2!.transport).toBe("sse");
      expect(s2!.url).toBe("https://example.com");
    });

    it("returns empty array for non-existent project", () => {
      expect(mcpManager.getStatus("no-project")).toEqual([]);
    });

    it("reports connected status for stdio after connect", () => {
      mcpManager.connect("proj-test", "ext-status", {
        transport: "stdio",
        command: "node",
        args: [],
      });

      const statuses = mcpManager.getStatus("proj-test");
      expect(statuses[0]!.status).toBe("connected");
    });
  });
});
