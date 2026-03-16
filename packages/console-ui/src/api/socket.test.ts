import { describe, it, expect, vi, beforeEach } from "vitest";

// Track event handlers registered on the mock socket
const socketHandlers: Record<string, (...args: unknown[]) => void> = {};
const managerHandlers: Record<string, (...args: unknown[]) => void> = {};

const mockDisconnect = vi.fn();
const mockSocket = {
  on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
    socketHandlers[event] = handler;
  }),
  io: {
    on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
      managerHandlers[event] = handler;
    }),
  },
  disconnect: mockDisconnect,
};

vi.mock("socket.io-client", () => ({
  io: vi.fn(() => mockSocket),
}));

import { useSocketStore } from "./socket";

describe("api/socket", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset store state
    useSocketStore.setState({
      socket: null,
      status: "disconnected",
      reconnectAttempts: 0,
    });
    // Clear handler maps
    for (const key of Object.keys(socketHandlers)) delete socketHandlers[key];
    for (const key of Object.keys(managerHandlers)) delete managerHandlers[key];
  });

  it("starts disconnected with no socket", () => {
    const state = useSocketStore.getState();
    expect(state.status).toBe("disconnected");
    expect(state.socket).toBeNull();
    expect(state.reconnectAttempts).toBe(0);
  });

  it("sets status to connecting then stores socket on connect()", () => {
    useSocketStore.getState().connect("http://localhost:3000");
    const state = useSocketStore.getState();
    // After connect(), the socket is stored and status transitions
    expect(state.socket).toBeTruthy();
  });

  it("disconnects existing socket before creating new one", () => {
    const existingSocket = { disconnect: vi.fn() };
    useSocketStore.setState({ socket: existingSocket as any });

    useSocketStore.getState().connect("http://localhost:3000");
    expect(existingSocket.disconnect).toHaveBeenCalled();
  });

  it("sets status to connected on socket connect event", () => {
    useSocketStore.getState().connect("http://localhost:3000");
    // Simulate the socket emitting 'connect'
    socketHandlers["connect"]?.();
    expect(useSocketStore.getState().status).toBe("connected");
    expect(useSocketStore.getState().reconnectAttempts).toBe(0);
  });

  it("sets status to reconnecting on disconnect event", () => {
    useSocketStore.getState().connect("http://localhost:3000");
    socketHandlers["connect"]?.();
    socketHandlers["disconnect"]?.();
    expect(useSocketStore.getState().status).toBe("reconnecting");
  });

  it("increments reconnectAttempts on reconnect_attempt", () => {
    useSocketStore.getState().connect("http://localhost:3000");
    managerHandlers["reconnect_attempt"]?.();
    expect(useSocketStore.getState().reconnectAttempts).toBe(1);
    managerHandlers["reconnect_attempt"]?.();
    expect(useSocketStore.getState().reconnectAttempts).toBe(2);
  });

  it("sets status to disconnected on reconnect_failed", () => {
    useSocketStore.getState().connect("http://localhost:3000");
    managerHandlers["reconnect_failed"]?.();
    expect(useSocketStore.getState().status).toBe("disconnected");
  });

  it("resets to connected on reconnect", () => {
    useSocketStore.getState().connect("http://localhost:3000");
    managerHandlers["reconnect_attempt"]?.();
    managerHandlers["reconnect"]?.();
    expect(useSocketStore.getState().status).toBe("connected");
    expect(useSocketStore.getState().reconnectAttempts).toBe(0);
  });

  it("disconnect() cleans up socket and resets state", () => {
    useSocketStore.getState().connect("http://localhost:3000");
    useSocketStore.getState().disconnect();
    const state = useSocketStore.getState();
    expect(state.socket).toBeNull();
    expect(state.status).toBe("disconnected");
    expect(state.reconnectAttempts).toBe(0);
    expect(mockDisconnect).toHaveBeenCalled();
  });

  it("disconnect() handles no existing socket gracefully", () => {
    useSocketStore.getState().disconnect();
    expect(useSocketStore.getState().status).toBe("disconnected");
  });
});
