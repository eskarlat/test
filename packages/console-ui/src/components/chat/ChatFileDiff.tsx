import { useState } from "react";
import { ChevronDown, ChevronRight, FileText } from "lucide-react";
import { cn } from "../../lib/utils";
import { CopyButton } from "./CopyButton";
import type { FileDiffBlock } from "../../types/chat";

interface ChatFileDiffProps {
  block: FileDiffBlock;
}

const MAX_VISIBLE_LINES = 100;

interface DiffLine {
  type: "added" | "removed" | "context" | "header";
  content: string;
  oldLineNum: number | null;
  newLineNum: number | null;
}

function parseHunkHeader(line: string): { oldStart: number; newStart: number } | null {
  const match = line.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
  if (!match) return null;
  return { oldStart: parseInt(match[1]!, 10), newStart: parseInt(match[2]!, 10) };
}

const DIFF_PREFIX: Record<string, string> = { removed: "-", added: "+", header: "", context: " " };

function getDiffPrefix(type: string): string {
  return DIFF_PREFIX[type] ?? " ";
}

function classifyDiffLine(line: string): "header" | "removed" | "added" | "context" {
  if (line.startsWith("@@")) return "header";
  if (line.startsWith("-") && !line.startsWith("---")) return "removed";
  if (line.startsWith("+") && !line.startsWith("+++")) return "added";
  return "context";
}

function parseDiffLines(diff: string): DiffLine[] {
  const lines = diff.split("\n");
  const result: DiffLine[] = [];
  let oldLine = 0;
  let newLine = 0;

  for (const line of lines) {
    const kind = classifyDiffLine(line);

    if (kind === "header") {
      const hunk = parseHunkHeader(line);
      if (hunk) { oldLine = hunk.oldStart; newLine = hunk.newStart; }
      result.push({ type: "header", content: line, oldLineNum: null, newLineNum: null });
    } else if (kind === "removed") {
      result.push({ type: "removed", content: line.slice(1), oldLineNum: oldLine, newLineNum: null });
      oldLine++;
    } else if (kind === "added") {
      result.push({ type: "added", content: line.slice(1), oldLineNum: null, newLineNum: newLine });
      newLine++;
    } else {
      const content = line.startsWith(" ") ? line.slice(1) : line;
      result.push({ type: "context", content, oldLineNum: oldLine, newLineNum: newLine });
      oldLine++;
      newLine++;
    }
  }

  return result;
}

function parseNewFileLines(content: string): DiffLine[] {
  return content.split("\n").map((line, i) => ({
    type: "added" as const,
    content: line,
    oldLineNum: null,
    newLineNum: i + 1,
  }));
}

export function ChatFileDiff({ block }: ChatFileDiffProps) {
  const [isExpanded, setIsExpanded] = useState(true);
  const [showAllLines, setShowAllLines] = useState(false);

  // While editing is in progress, show skeleton
  if (!block.isDone) {
    return (
      <div className="my-2 rounded-md border border-border overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-muted/50 border-b border-border">
          <FileText className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-mono text-muted-foreground">{block.fileName}</span>
        </div>
        <div className="px-3 py-4 space-y-2">
          <div className="h-3 w-3/4 bg-muted animate-pulse rounded" />
          <div className="h-3 w-1/2 bg-muted animate-pulse rounded" />
          <div className="h-3 w-2/3 bg-muted animate-pulse rounded" />
          <div className="text-xs text-muted-foreground animate-pulse mt-2">
            Editing {block.fileName}...
          </div>
        </div>
      </div>
    );
  }

  const diffLines =
    block.isNewFile && block.newFileContents
      ? parseNewFileLines(block.newFileContents)
      : parseDiffLines(block.diff);

  const totalLines = diffLines.length;
  const needsTruncation = totalLines > MAX_VISIBLE_LINES && !showAllLines;
  const visibleLines = needsTruncation ? diffLines.slice(0, MAX_VISIBLE_LINES) : diffLines;

  return (
    <div className="my-2 rounded-md border border-border overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/50 border-b border-border">
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="flex items-center gap-2 min-w-0"
        >
          {isExpanded ? (
            <ChevronDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          )}
          <FileText className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
          <span className="text-xs font-mono text-foreground truncate">{block.fileName}</span>
          {block.isNewFile && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400 flex-shrink-0">
              new
            </span>
          )}
        </button>
        <div className="flex items-center gap-1 flex-shrink-0">
          <CopyButton text={block.diff} label="Copy diff" />
          <CopyButton text={block.fileName} label="Copy file path" />
        </div>
      </div>

      {isExpanded && (
        <>
          {/* Intention */}
          {block.intention && (
            <div className="px-3 py-1.5 bg-muted/30 border-b border-border text-xs text-muted-foreground">
              {block.intention}
            </div>
          )}

          {/* Diff lines */}
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono border-collapse">
              <tbody>
                {visibleLines.map((line, i) => (
                  <tr
                    key={i}
                    className={cn(
                      line.type === "removed" && "bg-red-950/30",
                      line.type === "added" && "bg-green-950/30",
                      line.type === "header" && "bg-muted/60",
                    )}
                  >
                    {/* Old line number */}
                    <td className="w-10 text-right px-2 py-0 select-none text-muted-foreground border-r border-border/30">
                      {line.oldLineNum ?? ""}
                    </td>
                    {/* New line number */}
                    <td className="w-10 text-right px-2 py-0 select-none text-muted-foreground border-r border-border/30">
                      {line.newLineNum ?? ""}
                    </td>
                    {/* Prefix */}
                    <td
                      className={cn(
                        "w-4 text-center py-0 select-none",
                        line.type === "removed" && "text-red-400",
                        line.type === "added" && "text-green-400",
                      )}
                    >
                      {getDiffPrefix(line.type)}
                    </td>
                    {/* Content */}
                    <td
                      className={cn(
                        "px-2 py-0 whitespace-pre",
                        line.type === "removed" && "text-red-400",
                        line.type === "added" && "text-green-400",
                        line.type === "header" && "text-blue-400 italic",
                      )}
                    >
                      {line.content}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Expand button */}
          {needsTruncation && (
            <button
              onClick={() => setShowAllLines(true)}
              className="w-full px-3 py-1.5 bg-muted/30 border-t border-border text-xs text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              Show all {totalLines} lines
            </button>
          )}
        </>
      )}
    </div>
  );
}
