interface ChatProgressIndicatorProps {
  message: string;
}

/**
 * Streaming progress indicator with animated typing dots.
 * Displays the provided message alongside three bouncing dots.
 */
export function ChatProgressIndicator({
  message,
}: ChatProgressIndicatorProps) {
  return (
    <div className="inline-flex items-center gap-2 text-xs text-muted-foreground py-1">
      <span>{message}</span>
      <span className="inline-flex items-end gap-0.5" aria-hidden="true">
        <span className="inline-block h-1 w-1 rounded-full bg-current animate-bounce [animation-delay:0ms]" />
        <span className="inline-block h-1 w-1 rounded-full bg-current animate-bounce [animation-delay:150ms]" />
        <span className="inline-block h-1 w-1 rounded-full bg-current animate-bounce [animation-delay:300ms]" />
      </span>
    </div>
  );
}
