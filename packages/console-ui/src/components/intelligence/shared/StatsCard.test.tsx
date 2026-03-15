import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { StatsCard } from "./StatsCard";

describe("StatsCard", () => {
  it("renders label and value", () => {
    render(<StatsCard label="Total Errors" value={42} />);

    expect(screen.getByText("Total Errors")).toBeInTheDocument();
    expect(screen.getByText("42")).toBeInTheDocument();
  });

  it("renders string value", () => {
    render(<StatsCard label="Status" value="Active" />);

    expect(screen.getByText("Active")).toBeInTheDocument();
  });

  it("renders trend badge when trend is provided", () => {
    render(<StatsCard label="Errors" value={10} trend={15} />);

    expect(screen.getByText(/15%/)).toBeInTheDocument();
  });

  it("renders negative trend", () => {
    render(<StatsCard label="Errors" value={10} trend={-8} />);

    expect(screen.getByText(/8%/)).toBeInTheDocument();
  });

  it("renders zero trend", () => {
    render(<StatsCard label="Errors" value={10} trend={0} />);

    expect(screen.getByText(/0%/)).toBeInTheDocument();
  });

  it("does not render trend badge when trend is not provided", () => {
    const { container } = render(<StatsCard label="Errors" value={10} />);

    expect(container.textContent).not.toContain("%");
  });

  it("renders icon when provided", () => {
    render(<StatsCard label="Errors" value={5} icon={<span data-testid="icon">IC</span>} />);

    expect(screen.getByTestId("icon")).toBeInTheDocument();
  });

  it("is clickable when onClick is provided", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();

    render(<StatsCard label="Errors" value={5} onClick={onClick} />);

    const card = screen.getByRole("button");
    await user.click(card);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not have button role when onClick is not provided", () => {
    render(<StatsCard label="Errors" value={5} />);

    expect(screen.queryByRole("button")).toBeNull();
  });
});
