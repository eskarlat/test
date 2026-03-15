import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { Skeleton } from "./Skeleton";

describe("Skeleton", () => {
  it("renders a skeleton element", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild!;

    expect(el).toBeInTheDocument();
    expect(el.className).toContain("animate-pulse");
  });

  it("applies additional className", () => {
    const { container } = render(<Skeleton className="h-4 w-32" />);
    const el = container.firstElementChild!;

    expect(el.className).toContain("h-4");
    expect(el.className).toContain("w-32");
  });
});
