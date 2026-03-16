import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { EmptyState } from "./EmptyState";

describe("EmptyState", () => {
  it("renders title", () => {
    render(<EmptyState title="No items found" />);

    expect(screen.getByText("No items found")).toBeInTheDocument();
  });

  it("renders description when provided", () => {
    render(<EmptyState title="No items" description="Try adjusting your filters" />);

    expect(screen.getByText("Try adjusting your filters")).toBeInTheDocument();
  });

  it("does not render description when not provided", () => {
    const { container } = render(<EmptyState title="No items" />);

    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs.length).toBe(0);
  });

  it("renders action button when provided", () => {
    render(
      <EmptyState
        title="No items"
        action={<button>Create Item</button>}
      />
    );

    expect(screen.getByText("Create Item")).toBeInTheDocument();
  });

  it("does not render action area when not provided", () => {
    render(<EmptyState title="No items" />);

    // The heading should be present but no action button
    const heading = screen.getByText("No items");
    expect(heading.tagName).toBe("H3");
    // No buttons or action elements should be rendered
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("renders icon when provided", () => {
    render(
      <EmptyState
        title="No items"
        icon={<span data-testid="empty-icon">ICON</span>}
      />
    );

    expect(screen.getByTestId("empty-icon")).toBeInTheDocument();
  });
});
