import { useState, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { InlineComment } from "../types.js";
import { submitReview } from "../api.js";

interface ReviewChatProps {
  apiBaseUrl: string;
  taskName: string;
  filePath: string | null;
  comments: InlineComment[];
  onClose: () => void;
}

interface Message {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
}

export default function ReviewChat({
  apiBaseUrl,
  taskName,
  filePath,
  comments,
  onClose,
}: ReviewChatProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sendReview = useCallback(
    async (customPrompt?: string) => {
      if (!filePath) return;

      const commentPayload = comments.map((c) => ({
        lineNumber: c.lineNumber,
        content: c.content,
      }));

      // Build visible user message
      let userMsg = `Review phase #file: ${filePath}`;
      if (commentPayload.length > 0) {
        userMsg += "\n\nUser comments:";
        for (const c of commentPayload) {
          userMsg += `\nline ${c.lineNumber}: comment: {${c.content}}`;
        }
      }
      if (customPrompt) {
        userMsg += `\n\n${customPrompt}`;
      }

      setMessages((prev) => [
        ...prev,
        { role: "user", content: userMsg, timestamp: Date.now() },
      ]);
      setLoading(true);
      setError(null);

      try {
        const result = await submitReview(
          apiBaseUrl,
          taskName,
          filePath,
          commentPayload,
          customPrompt,
        );
        setMessages((prev) => [
          ...prev,
          { role: "assistant", content: result.review, timestamp: Date.now() },
        ]);
      } catch (err) {
        setError(String(err));
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl, taskName, filePath, comments],
  );

  const handleSend = useCallback(() => {
    if (!input.trim() && comments.length === 0) return;
    const prompt = input.trim() || undefined;
    sendReview(prompt);
    setInput("");
  }, [input, comments, sendReview]);

  const handleAutoReview = useCallback(() => {
    sendReview();
  }, [sendReview]);

  return (
    <div className="flex flex-col h-full border-l border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Review</span>
          {filePath && (
            <span className="text-xs text-muted-foreground font-mono truncate max-w-[200px]">
              {filePath}
            </span>
          )}
        </div>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-sm px-1"
        >
          ✕
        </button>
      </div>

      {/* Quick actions */}
      {messages.length === 0 && filePath && (
        <div className="px-4 py-3 border-b border-border space-y-2">
          <button
            onClick={handleAutoReview}
            disabled={loading}
            className="w-full px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {comments.length > 0
              ? `Review with ${comments.length} comment${comments.length !== 1 ? "s" : ""}`
              : "Review this file"}
          </button>
          {!filePath && (
            <p className="text-xs text-muted-foreground text-center">
              Select a file to start reviewing
            </p>
          )}
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-auto px-4 py-3 space-y-4">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`${msg.role === "user" ? "ml-8" : "mr-4"}`}
          >
            <div
              className={`rounded-lg px-3 py-2 text-sm ${
                msg.role === "user"
                  ? "bg-primary/10 text-foreground"
                  : "bg-muted text-foreground"
              }`}
            >
              {msg.role === "assistant" ? (
                <div className="prose prose-sm dark:prose-invert max-w-none">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>{msg.content}</ReactMarkdown>
                </div>
              ) : (
                <pre className="whitespace-pre-wrap text-xs font-mono">{msg.content}</pre>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground mt-1 block">
              {new Date(msg.timestamp).toLocaleTimeString()}
            </span>
          </div>
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <span className="inline-block w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            Reviewing...
          </div>
        )}

        {error && (
          <div className="rounded-lg px-3 py-2 bg-destructive/10 text-destructive text-sm">
            {error}
          </div>
        )}
      </div>

      {/* Input */}
      <div className="border-t border-border px-4 py-3">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
            placeholder={
              filePath
                ? "Ask about this file or add instructions..."
                : "Select a file first"
            }
            disabled={!filePath || loading}
            className="flex-1 px-3 py-2 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
          />
          <button
            onClick={handleSend}
            disabled={!filePath || loading || (!input.trim() && comments.length === 0)}
            className="px-3 py-2 text-sm rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
