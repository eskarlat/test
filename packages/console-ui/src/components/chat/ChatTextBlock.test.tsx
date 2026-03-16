import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChatTextBlock } from "./ChatTextBlock";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ChatTextBlock", () => {
  it("renders plain text", () => {
    render(<ChatTextBlock content="Hello world" />);
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("renders markdown bold text", () => {
    render(<ChatTextBlock content="This is **bold** text" />);
    const bold = screen.getByText("bold");
    expect(bold.tagName).toBe("STRONG");
  });

  it("renders markdown italic text", () => {
    render(<ChatTextBlock content="This is *italic* text" />);
    const italic = screen.getByText("italic");
    expect(italic.tagName).toBe("EM");
  });

  it("renders links with target=_blank", () => {
    render(<ChatTextBlock content="Visit [Example](https://example.com)" />);
    const link = screen.getByText("Example");
    expect(link.tagName).toBe("A");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
    expect(link).toHaveAttribute("href", "https://example.com");
  });

  it("renders inline code", () => {
    render(<ChatTextBlock content="Use `console.log` for debugging" />);
    const code = screen.getByText("console.log");
    expect(code.tagName).toBe("CODE");
    expect(code.className).toContain("bg-muted");
  });

  it("renders fenced code blocks with language class", () => {
    const content = ["```javascript", "const x = 1;", "```"].join("\n");
    const { container } = render(<ChatTextBlock content={content} />);
    // The code element gets a language-* class from react-markdown
    const codeEl = container.querySelector("code.language-javascript");
    expect(codeEl).toBeInTheDocument();
    expect(codeEl?.textContent).toContain("const x = 1;");
  });

  it("renders fenced code blocks inside pre", () => {
    const content = ["```js", "code here", "```"].join("\n");
    const { container } = render(<ChatTextBlock content={content} />);
    const preEl = container.querySelector("pre");
    expect(preEl).toBeInTheDocument();
    expect(preEl?.textContent).toContain("code here");
  });

  it("renders code block without language in pre element", () => {
    const content = ["```", "plain code", "```"].join("\n");
    const { container } = render(<ChatTextBlock content={content} />);
    const preEl = container.querySelector("pre");
    expect(preEl).toBeInTheDocument();
    expect(preEl?.textContent).toContain("plain code");
  });

  it("renders GFM tables", () => {
    const content = "| Name | Age |\n|------|-----|\n| Alice | 30 |";
    render(<ChatTextBlock content={content} />);
    expect(screen.getByText("Name")).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
  });

  it("renders GFM strikethrough", () => {
    render(<ChatTextBlock content="This is ~~deleted~~ text" />);
    const del = screen.getByText("deleted");
    expect(del.tagName).toBe("DEL");
  });

  it("renders unordered list", () => {
    const content = ["- Item A", "- Item B", "- Item C"].join("\n");
    render(<ChatTextBlock content={content} />);
    expect(screen.getByText("Item A")).toBeInTheDocument();
    expect(screen.getByText("Item B")).toBeInTheDocument();
    expect(screen.getByText("Item C")).toBeInTheDocument();
  });

  it("renders ordered list", () => {
    const content = ["1. First", "2. Second"].join("\n");
    render(<ChatTextBlock content={content} />);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
  });

  it("renders headings", () => {
    render(<ChatTextBlock content="## Heading Two" />);
    const heading = screen.getByText("Heading Two");
    expect(heading.tagName).toBe("H2");
  });

  it("renders empty content without error", () => {
    const { container } = render(<ChatTextBlock content="" />);
    expect(container.firstChild).toBeInTheDocument();
  });

  it("has prose styling wrapper", () => {
    const { container } = render(<ChatTextBlock content="test" />);
    const wrapper = container.firstChild as HTMLElement;
    expect(wrapper.className).toContain("prose");
  });
});
