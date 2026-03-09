import { useState, type KeyboardEvent } from "react";
import { RefreshCw, Terminal, ArrowUp, AlertTriangle, Sparkles, Code, FileText, Lightbulb, Zap } from "lucide-react";
import { useParams, useNavigate } from "react-router";
import { useChatStore } from "../../stores/chat-store";
import { ChatModelSelector } from "./ChatModelSelector";

interface ChatEmptyStateProps {
  sessionError: string | undefined;
}

export function ChatEmptyState({ sessionError }: ChatEmptyStateProps) {
  const bridgeStatus = useChatStore((s) => s.bridgeStatus);
  const bridgeError = useChatStore((s) => s.bridgeError);
  const checkBridgeStatus = useChatStore((s) => s.checkBridgeStatus);

  // Session error (e.g. failed to load session)
  if (sessionError) {
    return (
      <EmptyLayout>
        <AlertTriangle className="h-10 w-10 text-destructive/60 mx-auto" />
        <h2 className="text-lg font-semibold">Session Error</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          {sessionError}
        </p>
        <div className="flex items-center gap-3 justify-center">
          <button
            onClick={checkBridgeStatus}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all active:scale-[0.97]"
          >
            <RefreshCw className="h-4 w-4" />
            Retry
          </button>
        </div>
      </EmptyLayout>
    );
  }

  // Copilot CLI not installed
  if (bridgeStatus === "unavailable") {
    return (
      <EmptyLayout>
        <Terminal className="h-10 w-10 text-muted-foreground/50 mx-auto" />
        <h2 className="text-lg font-semibold">Copilot CLI Required</h2>
        <p className="text-sm text-muted-foreground max-w-sm mx-auto">
          The Chat feature requires GitHub Copilot CLI to be installed and authenticated.
        </p>
        <button
          onClick={checkBridgeStatus}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all active:scale-[0.97]"
        >
          <RefreshCw className="h-4 w-4" />
          Check Again
        </button>
      </EmptyLayout>
    );
  }

  // Auth error
  if (bridgeStatus === "error" && bridgeError) {
    return <AuthErrorState error={bridgeError} onRetry={checkBridgeStatus} />;
  }

  // Starting
  if (bridgeStatus === "starting" || bridgeStatus === "not-initialized") {
    return (
      <EmptyLayout>
        <div className="relative h-12 w-12 mx-auto">
          <div className="absolute inset-0 rounded-full bg-primary/20 animate-ping" />
          <div className="relative h-12 w-12 rounded-full border-2 border-primary border-t-transparent animate-spin" />
        </div>
        <h2 className="text-lg font-semibold">Connecting to Copilot...</h2>
        <p className="text-sm text-muted-foreground">
          Setting up the AI chat bridge
        </p>
      </EmptyLayout>
    );
  }

  // Ready — show new session hero
  return <ReadyState />;
}

// ---------------------------------------------------------------------------
// Ready state — modern hero layout
// ---------------------------------------------------------------------------

const SUGGESTIONS = [
  { icon: Code, label: "Explain this codebase", prompt: "Give me a high-level overview of this codebase — its structure, key modules, and how they connect." },
  { icon: Lightbulb, label: "Find potential improvements", prompt: "Analyze the codebase and suggest potential improvements for code quality, performance, or maintainability." },
  { icon: FileText, label: "Generate documentation", prompt: "Help me generate documentation for the main modules and their public APIs." },
  { icon: Zap, label: "Debug an issue", prompt: "Help me debug an issue I'm experiencing in this project." },
];

function ReadyState() {
  const [text, setText] = useState("");
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();
  const createSession = useChatStore((s) => s.createSession);

  async function handleSend(override?: string): Promise<void> {
    const msg = override ?? text.trim();
    if (!msg || !projectId) return;
    const sessionId = await createSession(projectId);
    if (sessionId) {
      // Store the pending message — useChatSocket will send it after joining the room
      useChatStore.setState({ pendingInitialMessage: msg });
      navigate(`/${projectId}/chat/${sessionId}`);
      setText("");
    }
  }

  function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 gap-8">
      {/* Hero */}
      <div className="flex flex-col items-center gap-3">
        <div className="relative">
          <div className="absolute -inset-3 rounded-2xl bg-gradient-to-br from-primary/20 via-primary/5 to-transparent blur-xl" />
          <div className="relative h-14 w-14 rounded-2xl bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-lg shadow-primary/20">
            <Sparkles className="h-7 w-7 text-primary-foreground" />
          </div>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight mt-1">What can I help you with?</h1>
        <p className="text-sm text-muted-foreground max-w-md text-center leading-relaxed">
          Ask anything about your project — explore code, generate docs, debug issues, or brainstorm ideas.
        </p>
      </div>

      {/* Input area */}
      <div className="w-full max-w-xl">
        <div className="relative rounded-2xl border border-border bg-muted/30 shadow-sm transition-shadow focus-within:shadow-md focus-within:border-ring/50">
          {/* Model selector row */}
          <div className="flex items-center gap-2 px-4 pt-3 pb-1">
            <ChatModelSelector />
          </div>

          {/* Textarea */}
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask a question or describe what you need..."
            rows={3}
            className="w-full resize-none bg-transparent px-4 py-2 text-sm placeholder:text-muted-foreground/50 focus:outline-none"
          />

          {/* Bottom bar */}
          <div className="flex items-center justify-between px-4 pb-3 pt-1">
            <span className="text-[11px] text-muted-foreground/50 select-none">
              Enter to send &middot; Shift+Enter for new line
            </span>
            <button
              onClick={() => handleSend()}
              disabled={!text.trim()}
              className="h-8 w-8 rounded-lg bg-primary text-primary-foreground flex items-center justify-center hover:bg-primary/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all active:scale-90"
              aria-label="Send message"
            >
              <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
            </button>
          </div>
        </div>
      </div>

      {/* Suggestion chips */}
      <div className="flex flex-wrap items-center justify-center gap-2 max-w-xl">
        {SUGGESTIONS.map((s) => (
          <button
            key={s.label}
            onClick={() => handleSend(s.prompt)}
            className="group inline-flex items-center gap-2 rounded-full border border-border bg-background px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground hover:border-ring/50 hover:bg-muted/50 transition-all active:scale-[0.97]"
          >
            <s.icon className="h-3.5 w-3.5 text-muted-foreground/60 group-hover:text-foreground/70 transition-colors" />
            {s.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------

function AuthErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  const isAuthError = error.toLowerCase().includes("auth");
  return (
    <EmptyLayout>
      <Terminal className="h-10 w-10 text-muted-foreground/50 mx-auto" />
      <h2 className="text-lg font-semibold">
        {isAuthError ? "GitHub Authentication Required" : "Connection Error"}
      </h2>
      <p className="text-sm text-muted-foreground max-w-sm mx-auto">
        {isAuthError ? "Run the following command to authenticate:" : error}
      </p>
      {isAuthError && (
        <code className="block text-xs bg-muted rounded-lg px-3 py-2 font-mono">
          gh auth login
        </code>
      )}
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-all active:scale-[0.97]"
      >
        <RefreshCw className="h-4 w-4" />
        Retry
      </button>
    </EmptyLayout>
  );
}

function EmptyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex-1 flex items-center justify-center p-8">
      <div className="text-center space-y-4">
        {children}
      </div>
    </div>
  );
}
