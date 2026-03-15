import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const mockRespondToElicitation = vi.fn();

vi.mock("../../stores/chat-store", () => ({
  useChatStore: Object.assign(
    vi.fn(() => null),
    {
      getState: () => ({ respondToElicitation: mockRespondToElicitation }),
      subscribe: vi.fn(),
      setState: vi.fn(),
    },
  ),
}));

import { ChatElicitationDialog } from "./ChatElicitationDialog";

describe("ChatElicitationDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders header and submit button", () => {
    const request = {
      requestId: "req-1",
      message: "Please configure",
      schema: { properties: {} },
    };
    render(<ChatElicitationDialog request={request as any} />);
    expect(screen.getByText("Input Required")).toBeTruthy();
    expect(screen.getByText("Submit")).toBeTruthy();
    expect(screen.getByText("Please configure")).toBeTruthy();
  });

  it("renders text field for string property", () => {
    const request = {
      requestId: "req-1",
      message: "",
      schema: {
        properties: { name: { type: "string", description: "Your name" } },
      },
    };
    render(<ChatElicitationDialog request={request as any} />);
    expect(screen.getByText("name")).toBeTruthy();
    expect(screen.getByPlaceholderText("Your name")).toBeTruthy();
  });

  it("renders enum field as select", () => {
    const request = {
      requestId: "req-1",
      message: "",
      schema: {
        properties: { color: { type: "string", enum: ["red", "blue", "green"] } },
      },
    };
    render(<ChatElicitationDialog request={request as any} />);
    expect(screen.getByText("red")).toBeTruthy();
    expect(screen.getByText("blue")).toBeTruthy();
  });

  it("renders boolean field as checkbox", () => {
    const request = {
      requestId: "req-1",
      message: "",
      schema: {
        properties: { enabled: { type: "boolean", description: "Enable feature" } },
      },
    };
    render(<ChatElicitationDialog request={request as any} />);
    expect(screen.getByText("Enable feature")).toBeTruthy();
    const checkbox = screen.getByRole("checkbox");
    expect(checkbox).toBeTruthy();
  });

  it("renders number field", () => {
    const request = {
      requestId: "req-1",
      message: "",
      schema: {
        properties: { count: { type: "number" } },
      },
    };
    render(<ChatElicitationDialog request={request as any} />);
    expect(screen.getByText("count")).toBeTruthy();
    const input = screen.getByRole("spinbutton");
    expect(input).toBeTruthy();
  });

  it("marks required fields with asterisk", () => {
    const request = {
      requestId: "req-1",
      message: "",
      schema: {
        properties: { api_key: { type: "string" } },
        required: ["api_key"],
      },
    };
    render(<ChatElicitationDialog request={request as any} />);
    expect(screen.getByText("*")).toBeTruthy();
  });

  it("submits values and shows submitted state", () => {
    const request = {
      requestId: "req-1",
      message: "",
      schema: {
        properties: { name: { type: "string" } },
      },
    };
    render(<ChatElicitationDialog request={request as any} />);

    const input = screen.getByRole("textbox");
    fireEvent.change(input, { target: { value: "test-value" } });
    fireEvent.click(screen.getByText("Submit"));

    expect(mockRespondToElicitation).toHaveBeenCalledWith("req-1", { name: "test-value" });
    expect(screen.getByText("Submitted")).toBeTruthy();
  });

  it("disables form after submission", () => {
    const request = {
      requestId: "req-1",
      message: "",
      schema: {
        properties: { name: { type: "string" } },
      },
    };
    render(<ChatElicitationDialog request={request as any} />);

    fireEvent.click(screen.getByText("Submit"));

    const input = screen.getByRole("textbox");
    expect(input).toHaveProperty("disabled", true);
    const submitBtn = screen.getByText("Submit").closest("button");
    expect(submitBtn).toHaveProperty("disabled", true);
  });

  it("renders array field with checkboxes for enum items", () => {
    const request = {
      requestId: "req-1",
      message: "",
      schema: {
        properties: {
          tags: { type: "array", items: { enum: ["a", "b", "c"] } },
        },
      },
    };
    render(<ChatElicitationDialog request={request as any} />);
    const checkboxes = screen.getAllByRole("checkbox");
    expect(checkboxes.length).toBe(3);
  });

  it("initializes default values from schema", () => {
    const request = {
      requestId: "req-1",
      message: "",
      schema: {
        properties: {
          name: { type: "string", default: "default-name" },
        },
      },
    };
    render(<ChatElicitationDialog request={request as any} />);
    const input = screen.getByRole("textbox") as HTMLInputElement;
    expect(input.value).toBe("default-name");
  });
});
