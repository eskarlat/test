import { useState } from "react";
import { Copy, Check, Terminal } from "lucide-react";
import type { TerminalBlock } from "../../types/chat";

interface ChatTerminalBlockProps {
  block: TerminalBlock;
}

/**
 * Renders terminal/shell output with a dark background, optional cwd header,
 * scrollable output, exit code badge, and copy button.
 */
export function ChatTerminalBlock({ block }: ChatTerminalBlockProps) {
  const [copied, setCopied] = useState(false);

  function handleCopy(): void {
    navigator.clipboard.writeText(block.text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const exitCodeColor =
    block.exitCode === 0
      ? "bg-green-600/20 text-green-400"
      : "bg-red-600/20 text-red-400";

  return (
    <div className="group/terminal rounded-md overflow-hidden border border-zinc-700 bg-zinc-900 text-zinc-100">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 bg-zinc-800 border-b border-zinc-700 text-xs">
        <div className="flex items-center gap-1.5 text-zinc-400 truncate min-w-0">
          <Terminal className="h-3 w-3 shrink-0" />
          {block.cwd ? (
            <span className="font-mono truncate" title={block.cwd}>
              {block.cwd}
            </span>
          ) : (
            <span className="font-mono">terminal</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0 ml-2">
          {block.exitCode != null && (
            <span
              className={`inline-flex items-center px-1.5 py-0.5 rounded font-mono text-[10px] ${exitCodeColor}`}
            >
              exit {block.exitCode}
            </span>
          )}
          <button
            onClick={handleCopy}
            className="opacity-0 group-hover/terminal:opacity-100 p-1 rounded hover:bg-zinc-700 transition-all"
            aria-label="Copy terminal output"
          >
            {copied ? (
              <Check className="h-3 w-3 text-green-400" />
            ) : (
              <Copy className="h-3 w-3 text-zinc-400" />
            )}
          </button>
        </div>
      </div>

      {/* Output */}
      <pre className="p-3 overflow-x-auto overflow-y-auto max-h-[300px] text-xs font-mono leading-relaxed whitespace-pre-wrap break-all">
        {block.text}
      </pre>
    </div>
  );
}
