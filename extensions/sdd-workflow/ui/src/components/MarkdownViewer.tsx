import { useState, useMemo, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { InlineComment } from "../types.js";

interface MarkdownViewerProps {
  content: string;
  filePath: string;
  comments: InlineComment[];
  onAddComment: (lineNumber: number, content: string) => void;
  onRemoveComment: (id: string) => void;
  fileUpdated: boolean;
}

function SourceView({
  content,
  comments,
  onAddComment,
  onRemoveComment,
}: {
  content: string;
  comments: InlineComment[];
  onAddComment: (line: number, text: string) => void;
  onRemoveComment: (id: string) => void;
}) {
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const [commentText, setCommentText] = useState("");

  const lines = content.split("\n");
  const commentsByLine = useMemo(() => {
    const map: Record<number, InlineComment[]> = {};
    for (const c of comments) {
      const bucket = map[c.lineNumber] ??= [];
      bucket.push(c);
    }
    return map;
  }, [comments]);

  const handleSubmit = useCallback(
    (line: number) => {
      if (!commentText.trim()) return;
      onAddComment(line, commentText.trim());
      setCommentText("");
      setActiveLine(null);
    },
    [commentText, onAddComment],
  );

  return (
    <div className="font-mono text-sm">
      {lines.map((line, i) => {
        const lineNum = i + 1;
        const lineComments = commentsByLine[lineNum];
        const hasComments = lineComments && lineComments.length > 0;
        return (
          <div key={i}>
            <div
              className={`flex group hover:bg-accent/30 ${hasComments ? "bg-yellow-500/5" : ""}`}
            >
              {/* Line number — click to comment */}
              <button
                onClick={() => setActiveLine(activeLine === lineNum ? null : lineNum)}
                className="flex-shrink-0 w-12 text-right pr-3 py-0.5 text-muted-foreground hover:text-primary select-none cursor-pointer border-r border-border"
                title="Click to add comment"
              >
                {hasComments && (
                  <span className="inline-block w-1.5 h-1.5 rounded-full bg-yellow-500 mr-1" />
                )}
                {lineNum}
              </button>
              {/* Line content */}
              <pre className="flex-1 px-3 py-0.5 whitespace-pre-wrap break-all">
                {line || "\u00A0"}
              </pre>
            </div>

            {/* Inline comments for this line */}
            {hasComments && (
              <div className="ml-12 border-l-2 border-yellow-500/30 pl-3 py-1 bg-yellow-500/5">
                {lineComments.map((c) => (
                  <div key={c.id} className="flex items-start gap-2 py-0.5 group/comment">
                    <span className="text-xs text-yellow-600 dark:text-yellow-400 font-medium flex-shrink-0">
                      comment:
                    </span>
                    <span className="text-xs text-foreground flex-1">{c.content}</span>
                    <button
                      onClick={() => onRemoveComment(c.id)}
                      className="text-[10px] text-muted-foreground hover:text-destructive opacity-0 group-hover/comment:opacity-100 transition-opacity"
                    >
                      remove
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Add comment form */}
            {activeLine === lineNum && (
              <div className="ml-12 border-l-2 border-primary/30 pl-3 py-2 bg-primary/5">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Add a comment..."
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleSubmit(lineNum)}
                    autoFocus
                    className="flex-1 px-2 py-1 text-xs rounded border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  />
                  <button
                    onClick={() => handleSubmit(lineNum)}
                    disabled={!commentText.trim()}
                    className="px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                  >
                    Add
                  </button>
                  <button
                    onClick={() => {
                      setActiveLine(null);
                      setCommentText("");
                    }}
                    className="px-2 py-1 text-xs rounded border border-border hover:bg-accent"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

export default function MarkdownViewer({
  content,
  filePath,
  comments,
  onAddComment,
  onRemoveComment,
  fileUpdated,
}: MarkdownViewerProps) {
  const [view, setView] = useState<"rendered" | "source">("source");

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="text-sm font-mono text-muted-foreground truncate max-w-[300px]">
            {filePath}
          </span>
          {fileUpdated && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400">
              Updated
            </span>
          )}
          {comments.length > 0 && (
            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-yellow-500/10 text-yellow-600 dark:text-yellow-400">
              {comments.length} comment{comments.length !== 1 ? "s" : ""}
            </span>
          )}
        </div>
        <div className="flex rounded-md border border-border overflow-hidden">
          <button
            onClick={() => setView("rendered")}
            className={`px-3 py-1 text-xs ${
              view === "rendered"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            Rendered
          </button>
          <button
            onClick={() => setView("source")}
            className={`px-3 py-1 text-xs ${
              view === "source"
                ? "bg-primary text-primary-foreground"
                : "bg-background text-muted-foreground hover:bg-accent"
            }`}
          >
            Source
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {view === "rendered" ? (
          <div className="prose prose-sm dark:prose-invert max-w-none p-6">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        ) : (
          <SourceView
            content={content}
            comments={comments}
            onAddComment={onAddComment}
            onRemoveComment={onRemoveComment}
          />
        )}
      </div>
    </div>
  );
}
