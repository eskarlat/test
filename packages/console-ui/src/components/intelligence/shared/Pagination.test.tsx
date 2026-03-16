import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Pagination } from "./Pagination";

describe("Pagination", () => {
  it("renders page info", () => {
    render(<Pagination page={2} total={50} pageSize={10} onPageChange={vi.fn()} />);

    expect(screen.getByText(/Page 2 of 5/)).toBeInTheDocument();
    expect(screen.getByText(/50 total/)).toBeInTheDocument();
  });

  it("returns null when there is only one page", () => {
    const { container } = render(
      <Pagination page={1} total={5} pageSize={10} onPageChange={vi.fn()} />
    );

    expect(container.innerHTML).toBe("");
  });

  it("returns null when total is zero", () => {
    const { container } = render(
      <Pagination page={1} total={0} pageSize={10} onPageChange={vi.fn()} />
    );

    expect(container.innerHTML).toBe("");
  });

  it("calls onPageChange with next page when clicking Next", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    render(<Pagination page={1} total={30} pageSize={10} onPageChange={onPageChange} />);

    await user.click(screen.getByText("Next"));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it("calls onPageChange with previous page when clicking Previous", async () => {
    const user = userEvent.setup();
    const onPageChange = vi.fn();

    render(<Pagination page={2} total={30} pageSize={10} onPageChange={onPageChange} />);

    await user.click(screen.getByText("Previous"));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it("disables Previous button on first page", () => {
    render(<Pagination page={1} total={30} pageSize={10} onPageChange={vi.fn()} />);

    expect(screen.getByText("Previous")).toBeDisabled();
    expect(screen.getByText("Next")).toBeEnabled();
  });

  it("disables Next button on last page", () => {
    render(<Pagination page={3} total={30} pageSize={10} onPageChange={vi.fn()} />);

    expect(screen.getByText("Next")).toBeDisabled();
    expect(screen.getByText("Previous")).toBeEnabled();
  });
});
