import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { Toast } from "./Toast";
import type { Toast as ToastType } from "@/stores/notification-store";

describe("Toast", () => {
  const onRemove = vi.fn();

  function makeToast(overrides: Partial<ToastType> = {}): ToastType {
    return {
      id: "toast-1",
      type: "info",
      message: "Test message",
      ...overrides,
    };
  }

  it("renders toast message", () => {
    render(<Toast toast={makeToast()} onRemove={onRemove} />);

    expect(screen.getByText("Test message")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("renders success toast", () => {
    render(<Toast toast={makeToast({ type: "success", message: "Success!" })} onRemove={onRemove} />);

    expect(screen.getByText("Success!")).toBeInTheDocument();
  });

  it("renders error toast", () => {
    render(<Toast toast={makeToast({ type: "error", message: "Error occurred" })} onRemove={onRemove} />);

    expect(screen.getByText("Error occurred")).toBeInTheDocument();
  });

  it("renders warning toast", () => {
    render(<Toast toast={makeToast({ type: "warning", message: "Be careful" })} onRemove={onRemove} />);

    expect(screen.getByText("Be careful")).toBeInTheDocument();
  });

  it("renders info toast", () => {
    render(<Toast toast={makeToast({ type: "info", message: "FYI" })} onRemove={onRemove} />);

    expect(screen.getByText("FYI")).toBeInTheDocument();
  });

  it("has a dismiss button", () => {
    render(<Toast toast={makeToast()} onRemove={onRemove} />);

    expect(screen.getByRole("button", { name: "Dismiss notification" })).toBeInTheDocument();
  });
});
