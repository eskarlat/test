import { ArrowDown } from "lucide-react";

interface ChatNewMessageIndicatorProps {
  onClick: () => void;
}

export function ChatNewMessageIndicator({ onClick }: ChatNewMessageIndicatorProps) {
  return (
    <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
      <button
        onClick={onClick}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-medium shadow-lg hover:bg-primary/90 transition-colors animate-in fade-in slide-in-from-bottom-2"
      >
        <ArrowDown className="h-3.5 w-3.5" />
        New messages
      </button>
    </div>
  );
}
