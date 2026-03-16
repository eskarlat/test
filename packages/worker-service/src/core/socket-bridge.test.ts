import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest";
import { createServer, type Server as HttpServer } from "http";
import { Server as SocketIOServer } from "socket.io";
import { io as ioClient, type Socket as ClientSocket } from "socket.io-client";
import { eventBus } from "./event-bus.js";
import { attachSocketBridge, isSystemEvent, isProjectEvent } from "./socket-bridge.js";

// Suppress logger output in tests
vi.mock("./logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

let httpServer: HttpServer;
let io: SocketIOServer;
let port: number;
const clients: ClientSocket[] = [];

function createClient(): ClientSocket {
  const client = ioClient(`http://127.0.0.1:${port}`, {
    transports: ["websocket"],
    forceNew: true,
  });
  clients.push(client);
  return client;
}

function waitForEvent<T = unknown>(socket: ClientSocket, event: string): Promise<T> {
  return new Promise((resolve) => {
    socket.once(event, (data: T) => resolve(data));
  });
}

/** Wait for connect + event-history in one go to avoid race conditions */
async function connectAndWaitReady(client: ClientSocket): Promise<void> {
  const historyPromise = waitForEvent(client, "event-history");
  if (!client.connected) {
    await waitForEvent(client, "connect");
  }
  await historyPromise;
}

beforeAll(
  () =>
    new Promise<void>((resolve) => {
      httpServer = createServer();
      io = new SocketIOServer(httpServer, { cors: { origin: "*" } });
      attachSocketBridge(io);
      httpServer.listen(0, "127.0.0.1", () => {
        const addr = httpServer.address();
        port = typeof addr === "object" && addr ? addr.port : 0;
        resolve();
      });
    }),
);

afterEach(() => {
  for (const client of clients) {
    if (client.connected) client.disconnect();
  }
  clients.length = 0;
});

afterAll(
  () =>
    new Promise<void>((resolve) => {
      io.close(() => {
        httpServer.close(() => resolve());
      });
    }),
);

describe("socket-bridge", () => {
  describe("event classifiers", () => {
    it("identifies system events", () => {
      expect(isSystemEvent("extension:installed")).toBe(true);
      expect(isSystemEvent("project:registered")).toBe(true);
      expect(isSystemEvent("mcp:connected")).toBe(true);
      expect(isSystemEvent("vault:updated")).toBe(true);
      expect(isSystemEvent("updates:available")).toBe(true);
    });

    it("identifies project events", () => {
      expect(isProjectEvent("session:started")).toBe(true);
      expect(isProjectEvent("observation:created")).toBe(true);
      expect(isProjectEvent("tool:used")).toBe(true);
      expect(isProjectEvent("prompt:recorded")).toBe(true);
      expect(isProjectEvent("error:recorded")).toBe(true);
      expect(isProjectEvent("subagent:started")).toBe(true);
    });

    it("does not cross-classify", () => {
      expect(isSystemEvent("session:started")).toBe(false);
      expect(isProjectEvent("extension:installed")).toBe(false);
    });
  });

  describe("system room", () => {
    it("auto-joins system room and receives system events", async () => {
      const client = createClient();
      await connectAndWaitReady(client);

      const eventPromise = waitForEvent(client, "extension:installed");
      eventBus.publish("extension:installed", { projectId: "p1", name: "test-ext", version: "1.0.0" });
      const data = await eventPromise;

      expect(data).toEqual({ projectId: "p1", name: "test-ext", version: "1.0.0" });
    });

    it("sends event history on connect", async () => {
      // Publish an event so history is non-empty
      eventBus.publish("vault:updated", { action: "set", key: "test-key" });

      const client = createClient();
      // Listen for event-history before connect resolves
      const historyPromise = waitForEvent<unknown[]>(client, "event-history");
      const history = await historyPromise;

      expect(Array.isArray(history)).toBe(true);
      expect(history.length).toBeGreaterThan(0);
    });
  });

  describe("project room", () => {
    it("receives project events after joining room", async () => {
      const client = createClient();
      await connectAndWaitReady(client);

      client.emit("project:join", "proj-1");
      // Small delay for room join to process
      await new Promise((r) => setTimeout(r, 50));

      const eventPromise = waitForEvent(client, "session:started");
      eventBus.publish("session:started", { projectId: "proj-1" });
      const data = await eventPromise;

      expect(data).toEqual({ projectId: "proj-1" });
    });

    it("isolates project events to joined clients only", async () => {
      const client1 = createClient();
      const client2 = createClient();

      await connectAndWaitReady(client1);
      await connectAndWaitReady(client2);

      // Only client1 joins the project room
      client1.emit("project:join", "proj-2");
      await new Promise((r) => setTimeout(r, 50));

      let client2Received = false;
      client2.on("observation:created", () => {
        client2Received = true;
      });

      const eventPromise = waitForEvent(client1, "observation:created");
      eventBus.publish("observation:created", { projectId: "proj-2" });
      await eventPromise;

      // Give client2 a moment to potentially receive
      await new Promise((r) => setTimeout(r, 50));
      expect(client2Received).toBe(false);
    });
  });

  describe("chat:send with explicit sessionId (ADR-052)", () => {
    it("returns error when not joined to any chat room", async () => {
      const client = createClient();
      await connectAndWaitReady(client);

      const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        client.emit("chat:send", { prompt: "hello" }, resolve);
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Not joined to a chat session");
    });

    it("returns error when explicit sessionId room not joined", async () => {
      const client = createClient();
      await connectAndWaitReady(client);

      // Join a different chat room
      client.emit("chat:join", "session-A");
      await new Promise((r) => setTimeout(r, 50));

      const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        client.emit("chat:send", { prompt: "hello", sessionId: "session-B" }, resolve);
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Not joined to the specified chat session");
    });

    it("falls back to room inference when no explicit sessionId", async () => {
      const client = createClient();
      await connectAndWaitReady(client);

      client.emit("chat:join", "session-A");
      await new Promise((r) => setTimeout(r, 50));

      // Without explicit sessionId, withSession uses getSessionFromSocket()
      // which finds session-A. copilotBridge.sendMessage will reject since
      // no real bridge is running, but the session resolution itself succeeds.
      const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        client.emit("chat:send", { prompt: "hello" }, resolve);
      });

      // The bridge call will fail (no real copilot bridge), but the session
      // was resolved correctly (not "Not joined to a chat session")
      expect(result.error).not.toBe("Not joined to a chat session");
    });
  });

  describe("chat:cancel with explicit sessionId (ADR-052)", () => {
    it("returns error when explicit sessionId room not joined", async () => {
      const client = createClient();
      await connectAndWaitReady(client);

      client.emit("chat:join", "session-A");
      await new Promise((r) => setTimeout(r, 50));

      const result = await new Promise<{ ok: boolean; error?: string }>((resolve) => {
        client.emit("chat:cancel", { sessionId: "session-X" }, resolve);
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("Not joined to the specified chat session");
    });
  });
});
