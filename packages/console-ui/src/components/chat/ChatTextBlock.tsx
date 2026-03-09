import { useState } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Copy, Check } from "lucide-react";

interface ChatTextBlockProps {
  content: string;
}

/**
 * Renders markdown text content with GFM support (tables, strikethrough,
 * task lists, autolinks) and fenced code blocks with copy buttons.
 */
export function ChatTextBlock({ content }: ChatTextBlockProps) {
  return (
    <div className="prose prose-sm dark:prose-invert max-w-none break-words leading-relaxed">
      <Markdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {content}
      </Markdown>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom component overrides
// ---------------------------------------------------------------------------

const mdComponents: Components = {
  pre: PreBlock,
  code: InlineCode,
  a: ExternalLink,
};

// ---------------------------------------------------------------------------
// <pre> — fenced code block with copy
// ---------------------------------------------------------------------------

function PreBlock(props: React.ComponentPropsWithoutRef<"pre">) {
  const { children, ...rest } = props;

  // react-markdown wraps code in <pre><code>…</code></pre>.
  // Extract language + text from the nested <code> element.
  const codeChild = extractCodeChild(children);
  if (!codeChild) {
    return <pre {...rest}>{children}</pre>;
  }

  const { language, text } = codeChild;
  return <CodeBlock language={language} code={text} />;
}

function extractCodeChild(
  children: React.ReactNode,
): { language: string; text: string } | null {
  if (!children || typeof children !== "object") return null;

  const child = Array.isArray(children) ? children[0] : children;
  if (
    !child ||
    typeof child !== "object" ||
    !("props" in child) ||
    (child as React.ReactElement).type !== "code"
  ) {
    return null;
  }

  const codeProps = (child as React.ReactElement<{ className?: string; children?: React.ReactNode }>).props;
  const className = codeProps.className ?? "";
  const language = className.replace(/^language-/, "");
  const text = extractText(codeProps.children);
  return { language, text };
}

function extractText(node: React.ReactNode): string {
  if (typeof node === "string") return node;
  if (Array.isArray(node)) return node.map(extractText).join("");
  return "";
}

// ---------------------------------------------------------------------------
// Inline <code>
// ---------------------------------------------------------------------------

function InlineCode(props: React.ComponentPropsWithoutRef<"code">) {
  const { children, className, ...rest } = props;
  // If className contains "language-", it's a fenced block handled by PreBlock
  if (className?.startsWith("language-")) {
    return (
      <code className={className} {...rest}>
        {children}
      </code>
    );
  }
  return (
    <code
      className="rounded bg-muted px-1.5 py-0.5 text-[0.85em] font-mono before:content-none after:content-none"
      {...rest}
    >
      {children}
    </code>
  );
}

// ---------------------------------------------------------------------------
// External links
// ---------------------------------------------------------------------------

function ExternalLink(props: React.ComponentPropsWithoutRef<"a">) {
  const { children, ...rest } = props;
  return (
    <a target="_blank" rel="noopener noreferrer" {...rest}>
      {children}
    </a>
  );
}

// ---------------------------------------------------------------------------
// Code block with copy button (reused from previous implementation)
// ---------------------------------------------------------------------------

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  function handleCopy(): void {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="not-prose relative group/code rounded-md border border-border bg-muted overflow-hidden my-2">
      {language && (
        <div className="flex items-center justify-between px-3 py-1 bg-muted/80 border-b border-border text-xs text-muted-foreground">
          <span className="font-mono">{language}</span>
          <button
            onClick={handleCopy}
            className="opacity-0 group-hover/code:opacity-100 p-1 rounded hover:bg-accent transition-all"
            aria-label="Copy code"
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-500" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </button>
        </div>
      )}
      <pre className="p-3 overflow-x-auto text-xs font-mono leading-relaxed">
        <code>{code}</code>
      </pre>
      {!language && (
        <button
          onClick={handleCopy}
          className="absolute top-2 right-2 opacity-0 group-hover/code:opacity-100 p-1 rounded bg-muted hover:bg-accent transition-all"
          aria-label="Copy code"
        >
          {copied ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      )}
    </div>
  );
}
