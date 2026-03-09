import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HelpDrawer } from "./HelpDrawer";

describe("HelpDrawer", () => {
  let onClose: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onClose = vi.fn();
  });

  it("renders when open", () => {
    render(<HelpDrawer open={true} onClose={onClose} />);

    expect(screen.getByText("Automation Help")).toBeTruthy();
  });

  it("does not render content when closed", () => {
    render(<HelpDrawer open={false} onClose={onClose} />);

    const drawer = screen.getByRole("dialog");
    expect(drawer.className).toContain("translate-x-full");
  });

  it("calls onClose when close button clicked", async () => {
    const user = userEvent.setup();
    render(<HelpDrawer open={true} onClose={onClose} />);

    const closeButton = screen.getByRole("button", { name: "Close help" });
    await user.click(closeButton);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("calls onClose on Escape key", async () => {
    const user = userEvent.setup();
    render(<HelpDrawer open={true} onClose={onClose} />);

    await user.keyboard("{Escape}");

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders all 8 sections", () => {
    render(<HelpDrawer open={true} onClose={onClose} />);

    const expectedSections = [
      "1. What is an Automation?",
      "2. Prompt Chain",
      "3. Template Variables",
      "4. Scheduling",
      "5. Worktrees",
      "6. Models & Effort",
      "7. Error Handling",
      "8. Tools",
    ];

    for (const heading of expectedSections) {
      expect(screen.getByText(heading)).toBeTruthy();
    }
  });

  it("renders complete template variables table", () => {
    render(<HelpDrawer open={true} onClose={onClose} />);

    const expectedVariables = [
      "{{prev.output}}",
      "{{prev.json.field}}",
      "{{steps.NAME.output}}",
      "{{variables.KEY}}",
      "{{project.name}}",
      "{{project.id}}",
      "{{now}}",
      "{{now.date}}",
      "{{now.time}}",
      "{{worktree.path}}",
      "{{worktree.branch}}",
    ];

    for (const variable of expectedVariables) {
      expect(screen.getByText(variable)).toBeTruthy();
    }
  });
});
