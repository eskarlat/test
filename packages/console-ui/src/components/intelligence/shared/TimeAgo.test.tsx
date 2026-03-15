import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimeAgo } from "./TimeAgo";

describe("TimeAgo", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  function renderAt(fixedNow: number, timestamp: string) {
    vi.useFakeTimers();
    vi.setSystemTime(fixedNow);
    return render(<TimeAgo timestamp={timestamp} />);
  }

  it("shows 'just now' for timestamps less than a minute ago", () => {
    const now = Date.now();
    renderAt(now, new Date(now - 30_000).toISOString());

    expect(screen.getByText("just now")).toBeInTheDocument();
  });

  it("shows minutes ago", () => {
    const now = Date.now();
    renderAt(now, new Date(now - 5 * 60_000).toISOString());

    expect(screen.getByText("5 minutes ago")).toBeInTheDocument();
  });

  it("shows singular minute", () => {
    const now = Date.now();
    renderAt(now, new Date(now - 60_000).toISOString());

    expect(screen.getByText("1 minute ago")).toBeInTheDocument();
  });

  it("shows hours ago", () => {
    const now = Date.now();
    renderAt(now, new Date(now - 3 * 3600_000).toISOString());

    expect(screen.getByText("3 hours ago")).toBeInTheDocument();
  });

  it("shows singular hour", () => {
    const now = Date.now();
    renderAt(now, new Date(now - 3600_000).toISOString());

    expect(screen.getByText("1 hour ago")).toBeInTheDocument();
  });

  it("shows 'yesterday' for one day ago", () => {
    const now = Date.now();
    renderAt(now, new Date(now - 24 * 3600_000).toISOString());

    expect(screen.getByText("yesterday")).toBeInTheDocument();
  });

  it("shows days ago for 2-6 days", () => {
    const now = Date.now();
    renderAt(now, new Date(now - 3 * 24 * 3600_000).toISOString());

    expect(screen.getByText("3 days ago")).toBeInTheDocument();
  });

  it("shows month and day for older dates", () => {
    const now = new Date("2026-03-15T12:00:00Z").getTime();
    renderAt(now, "2026-02-01T12:00:00Z");

    expect(screen.getByText("Feb 1")).toBeInTheDocument();
  });

  it("sets title attribute to full date string", () => {
    const now = Date.now();
    const ts = new Date(now - 5000).toISOString();
    renderAt(now, ts);

    const el = screen.getByText("just now");
    expect(el).toHaveAttribute("title");
  });

  it("applies className prop", () => {
    const now = Date.now();
    renderAt(now, new Date(now - 5000).toISOString());

    // Re-render with className
    vi.useRealTimers();
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { container } = render(<TimeAgo timestamp={new Date(now - 5000).toISOString()} className="text-xs" />);

    expect(container.firstElementChild).toHaveClass("text-xs");
  });
});
