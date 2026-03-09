import { useState, useRef, useEffect } from "react";
import { MessageCircleQuestion, Send, Check } from "lucide-react";
import { useChatStore } from "../../stores/chat-store";
import type { InputRequest } from "../../types/chat";

interface ChatInputDialogProps {
  request: InputRequest;
}

export function ChatInputDialog({ request }: ChatInputDialogProps) {
  const [answer, setAnswer] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!submitted) {
      inputRef.current?.focus();
    }
  }, [submitted]);

  function handleSubmit(): void {
    if (submitted || !answer.trim()) return;
    setSubmitted(true);
    useChatStore.getState().respondToInput(request.requestId, answer.trim());
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  return (
    <div className="my-2 rounded-lg border border-border bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
        <MessageCircleQuestion className="h-4 w-4 text-muted-foreground flex-shrink-0" />
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Question
        </span>
        {submitted && (
          <span className="ml-auto inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-green-500/20 text-green-400">
            <Check className="h-3 w-3" /> Answered
          </span>
        )}
      </div>

      {/* Prompt text */}
      <div className="px-4 py-3">
        <div className="text-sm">{request.prompt}</div>
      </div>

      {/* Input */}
      <div className="flex items-center gap-2 px-4 py-3 border-t border-border bg-muted/20">
        <input
          ref={inputRef}
          type="text"
          value={answer}
          onChange={(e) => setAnswer(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={submitted}
          placeholder="Type your answer..."
          className="flex-1 bg-background border border-border rounded-md px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50 disabled:cursor-not-allowed"
        />
        <button
          onClick={handleSubmit}
          disabled={submitted || !answer.trim()}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          <Send className="h-3.5 w-3.5" />
          Submit
        </button>
      </div>
    </div>
  );
}
