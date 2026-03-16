import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the API client
vi.mock("../api/client", () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  BASE_URL: "http://localhost:42888",
}));

// Use vi.hoisted so the holder is available when the hoisted vi.mock runs
const callbackHolder = vi.hoisted(() => ({
  fn: null as ((state: { status: string; reconnectAttempts: number }) => void) | null,
}));

vi.mock("../api/socket", () => ({
  useSocketStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({ socket: { emit: vi.fn() }, status: "disconnected", reconnectAttempts: 0 }),
      subscribe: vi.fn((cb: (state: { status: string; reconnectAttempts: number }) => void) => {
        callbackHolder.fn = cb;
        return vi.fn(); // unsubscribe
      }),
      setState: vi.fn(),
    },
  ),
}));

import { useConnectionStore } from "./connection-store";

describe("connection-store", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConnectionStore.setState({
      status: "disconnected",
      reconnectAttempts: 0,
    });
  });

  describe("initial state", () => {
    it("starts as disconnected with zero reconnect attempts", () => {
      const state = useConnectionStore.getState();
      expect(state.status).toBe("disconnected");
      expect(state.reconnectAttempts).toBe(0);
    });
  });

  describe("socket store subscription", () => {
    it("maps connected socket status to connected", () => {
      expect(callbackHolder.fn).not.toBeNull();
      callbackHolder.fn!({ status: "connected", reconnectAttempts: 0 });

      expect(useConnectionStore.getState().status).toBe("connected");
      expect(useConnectionStore.getState().reconnectAttempts).toBe(0);
    });

    it("maps disconnected socket status to disconnected", () => {
      callbackHolder.fn!({ status: "disconnected", reconnectAttempts: 0 });

      expect(useConnectionStore.getState().status).toBe("disconnected");
    });

    it("maps reconnecting socket status to reconnecting", () => {
      callbackHolder.fn!({ status: "reconnecting", reconnectAttempts: 3 });

      expect(useConnectionStore.getState().status).toBe("reconnecting");
      expect(useConnectionStore.getState().reconnectAttempts).toBe(3);
    });

    it("maps connecting socket status to reconnecting", () => {
      callbackHolder.fn!({ status: "connecting", reconnectAttempts: 1 });

      expect(useConnectionStore.getState().status).toBe("reconnecting");
      expect(useConnectionStore.getState().reconnectAttempts).toBe(1);
    });
  });
});
