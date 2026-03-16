import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectionStatus } from "./ConnectionStatus";

const mockUseConnectionStore = vi.fn();

vi.mock("@/stores/connection-store", () => ({
  useConnectionStore: (selector: (s: { status: string }) => string) =>
    selector({ status: mockUseConnectionStore() }),
}));

describe("ConnectionStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows connected indicator when connected", () => {
    mockUseConnectionStore.mockReturnValue("connected");
    render(<ConnectionStatus />);

    expect(screen.getByText("Connected")).toBeInTheDocument();
  });

  it("shows disconnected indicator when disconnected", () => {
    mockUseConnectionStore.mockReturnValue("disconnected");
    render(<ConnectionStatus />);

    expect(screen.getByText("Server offline")).toBeInTheDocument();
  });

  it("shows reconnecting indicator when reconnecting", () => {
    mockUseConnectionStore.mockReturnValue("reconnecting");
    render(<ConnectionStatus />);

    expect(screen.getByText("Reconnecting...")).toBeInTheDocument();
  });
});
