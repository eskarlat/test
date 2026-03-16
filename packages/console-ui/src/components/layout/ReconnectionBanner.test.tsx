import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ReconnectionBanner } from "./ReconnectionBanner";

const mockStatus = vi.fn();

vi.mock("@/stores/connection-store", () => ({
  useConnectionStore: (selector: (s: { status: string }) => string) =>
    selector({ status: mockStatus() }),
}));

vi.mock("@/api/socket", () => ({
  useSocketStore: Object.assign(vi.fn(), {
    getState: () => ({ connect: vi.fn() }),
  }),
}));

vi.mock("@/api/client", () => ({
  BASE_URL: "http://localhost:42888",
}));

describe("ReconnectionBanner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows banner when disconnected", () => {
    mockStatus.mockReturnValue("disconnected");
    render(<ReconnectionBanner />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText(/Server offline/)).toBeInTheDocument();
    expect(screen.getByText("Reconnect")).toBeInTheDocument();
  });

  it("hides banner when connected", () => {
    mockStatus.mockReturnValue("connected");
    const { container } = render(<ReconnectionBanner />);

    expect(container.innerHTML).toBe("");
  });

  it("hides banner when reconnecting", () => {
    mockStatus.mockReturnValue("reconnecting");
    const { container } = render(<ReconnectionBanner />);

    expect(container.innerHTML).toBe("");
  });
});
