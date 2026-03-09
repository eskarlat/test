import { useState } from "react";
import { Copy, Check } from "lucide-react";

interface ChatCodeBlockProps {
  language: string;
  code: string;
}

/**
 * Standalone code block with language badge, copy button, and
 * optional line numbers for blocks exceeding 10 lines.
 */
export function ChatCodeBlock({ language, code }: ChatCodeBlockProps) {
  const [copied, setCopied] = useState(false);
  const lines = code.split("\n");
  const showLineNumbers = lines.length > 10;
  const gutterWidth = showLineNumbers
    ? `${String(lines.length).length + 1}ch`
    : "0";

  function handleCopy(): void {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="relative group/code rounded-md border border-border bg-muted overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1 bg-muted/80 border-b border-border text-xs text-muted-foreground">
        <span className="font-mono">{language || "plain"}</span>
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

      {/* Code */}
      <div className="overflow-x-auto">
        <pre className="p-3 text-xs font-mono leading-relaxed">
          <code>
            {showLineNumbers
              ? lines.map((line, i) => (
                  <div key={i} className="flex">
                    <span
                      className="inline-block text-right pr-3 select-none text-muted-foreground/50 shrink-0"
                      style={{ width: gutterWidth }}
                    >
                      {i + 1}
                    </span>
                    <span className="flex-1 whitespace-pre-wrap break-all">
                      {line}
                    </span>
                  </div>
                ))
              : code}
          </code>
        </pre>
      </div>
    </div>
  );
}
