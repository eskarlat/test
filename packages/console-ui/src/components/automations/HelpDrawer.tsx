import { useEffect, useRef } from "react";
import { X, BookOpen } from "lucide-react";
import { cn } from "../../lib/utils";

interface HelpDrawerProps {
  open: boolean;
  onClose: () => void;
}

const sectionHeadingClass = "text-sm font-semibold mt-6 mb-2 first:mt-0";
const paragraphClass = "text-sm text-muted-foreground leading-relaxed mb-2";
const codeClass = "bg-muted px-1 py-0.5 rounded text-xs font-mono";

export function HelpDrawer({ open, onClose }: HelpDrawerProps) {
  const drawerRef = useRef<HTMLDivElement>(null);

  // Focus the drawer when it opens
  useEffect(() => {
    if (open && drawerRef.current) {
      drawerRef.current.focus();
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        onClose();
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      {open && (
        <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      )}

      {/* Drawer */}
      <div
        ref={drawerRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="Automation help"
        className={cn(
          "fixed right-0 inset-y-0 z-50 w-full max-w-md bg-background border-l border-border shadow-xl",
          "flex flex-col outline-none",
          "transition-transform duration-200 ease-in-out",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <h2 className="text-base font-semibold">Automation Help</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            aria-label="Close help"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-auto px-5 py-4">
          {/* 1. What is an Automation? */}
          <h3 className={sectionHeadingClass}>1. What is an Automation?</h3>
          <p className={paragraphClass}>
            An automation is a scheduled workflow that chains multiple LLM prompts together.
            Each step can use a different model and reasoning effort, with the output of one
            step feeding into the next. Automations run in <strong>autopilot mode</strong> --
            all tool permission requests are automatically approved.
          </p>
          <p className={paragraphClass}>
            Use automations for repetitive tasks like daily code reviews, dependency audits,
            report generation, or changelog drafts.
          </p>

          {/* 2. Prompt Chain */}
          <h3 className={sectionHeadingClass}>2. Prompt Chain</h3>
          <p className={paragraphClass}>
            A prompt chain is an ordered sequence of steps. Each step sends a prompt to an LLM,
            optionally with access to tools (built-in, extension, MCP). The output from each step
            is available to subsequent steps via template variables.
          </p>
          <p className={paragraphClass}>
            Steps execute sequentially. If a step fails, the error handling strategy determines
            whether the chain stops, skips the step, or retries.
          </p>

          {/* 3. Template Variables */}
          <h3 className={sectionHeadingClass}>3. Template Variables</h3>
          <p className={paragraphClass}>
            Use double-brace syntax in prompts to reference dynamic values.
            Template substitution is single-pass (no re-evaluation).
          </p>
          <div className="overflow-x-auto mb-3">
            <table className="text-xs w-full border-collapse">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left py-1.5 pr-3 font-medium">Variable</th>
                  <th className="text-left py-1.5 font-medium">Description</th>
                </tr>
              </thead>
              <tbody className="text-muted-foreground">
                <tr className="border-b border-border/50">
                  <td className="py-1.5 pr-3"><code className={codeClass}>{"{{prev.output}}"}</code></td>
                  <td className="py-1.5">Previous step&apos;s full response</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-1.5 pr-3"><code className={codeClass}>{"{{prev.json.field}}"}</code></td>
                  <td className="py-1.5">JSON field from previous step (dot-notation)</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-1.5 pr-3"><code className={codeClass}>{"{{steps.NAME.output}}"}</code></td>
                  <td className="py-1.5">Output from a specific named step</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-1.5 pr-3"><code className={codeClass}>{"{{variables.KEY}}"}</code></td>
                  <td className="py-1.5">User-defined variable from the automation config</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-1.5 pr-3"><code className={codeClass}>{"{{project.name}}"}</code></td>
                  <td className="py-1.5">Current project name</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-1.5 pr-3"><code className={codeClass}>{"{{project.id}}"}</code></td>
                  <td className="py-1.5">Current project ID</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-1.5 pr-3"><code className={codeClass}>{"{{now}}"}</code></td>
                  <td className="py-1.5">Current ISO 8601 datetime</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-1.5 pr-3"><code className={codeClass}>{"{{now.date}}"}</code></td>
                  <td className="py-1.5">Current date (YYYY-MM-DD)</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-1.5 pr-3"><code className={codeClass}>{"{{now.time}}"}</code></td>
                  <td className="py-1.5">Current time (HH:MM:SS)</td>
                </tr>
                <tr className="border-b border-border/50">
                  <td className="py-1.5 pr-3"><code className={codeClass}>{"{{worktree.path}}"}</code></td>
                  <td className="py-1.5">Worktree directory (when enabled)</td>
                </tr>
                <tr>
                  <td className="py-1.5 pr-3"><code className={codeClass}>{"{{worktree.branch}}"}</code></td>
                  <td className="py-1.5">Worktree branch name (when enabled)</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* 4. Scheduling */}
          <h3 className={sectionHeadingClass}>4. Scheduling</h3>
          <p className={paragraphClass}>
            Automations support three schedule types:
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-2">
            <li><strong>Cron</strong> -- Standard cron expression (e.g., <code className={codeClass}>0 9 * * 1-5</code> for weekdays at 9 AM). Supports optional timezone.</li>
            <li><strong>Once</strong> -- Runs at a specific date/time, then auto-disables.</li>
            <li><strong>Manual</strong> -- Only runs when triggered via the &quot;Run Now&quot; button or API.</li>
          </ul>
          <p className={paragraphClass}>
            Cron schedules can optionally have start and end dates to limit the active window.
          </p>

          {/* 5. Worktrees */}
          <h3 className={sectionHeadingClass}>5. Worktrees</h3>
          <p className={paragraphClass}>
            When worktree mode is enabled, the automation runs in an isolated git worktree.
            This prevents file modifications from affecting the main working directory.
          </p>
          <p className={paragraphClass}>
            Configure the branch name (or use auto-generated), and the cleanup policy:
            <strong> always</strong> (remove after run),
            <strong> on_success</strong> (keep on failure for debugging),
            <strong> never</strong> (manual cleanup), or
            <strong> TTL</strong> (auto-remove after a time period).
          </p>

          {/* 6. Models & Effort */}
          <h3 className={sectionHeadingClass}>6. Models & Effort</h3>
          <p className={paragraphClass}>
            Each step can use a different model. This allows optimizing cost and speed --
            use a fast model for data gathering steps and a powerful model for analysis steps.
          </p>
          <p className={paragraphClass}>
            Reasoning effort controls how much computation the model uses:
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-2">
            <li><strong>Low</strong> -- Fast, less thorough. Good for simple extraction or formatting.</li>
            <li><strong>Medium</strong> -- Balanced. Default for most steps.</li>
            <li><strong>High</strong> -- Maximum reasoning. Best for complex analysis or code generation.</li>
          </ul>

          {/* 7. Error Handling */}
          <h3 className={sectionHeadingClass}>7. Error Handling</h3>
          <p className={paragraphClass}>
            Each step has an error handling strategy:
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-2">
            <li><strong>Stop</strong> -- Abort the entire chain. The run is marked as failed.</li>
            <li><strong>Skip</strong> -- Skip this step and continue to the next. The step is marked as skipped.</li>
            <li><strong>Retry</strong> -- Retry the step up to N times before failing.</li>
          </ul>
          <p className={paragraphClass}>
            The automation also has a global <code className={codeClass}>maxDurationMs</code> timeout
            that kills the entire run if it exceeds the limit.
          </p>

          {/* 8. Tools */}
          <h3 className={sectionHeadingClass}>8. Tools</h3>
          <p className={paragraphClass}>
            Automations can access three categories of tools:
          </p>
          <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1 mb-2">
            <li><strong>Built-in</strong> -- File read/write, shell commands, web search, and other core tools.</li>
            <li><strong>Extension</strong> -- Tools provided by installed extensions. Select &quot;All&quot; or specify individual extensions.</li>
            <li><strong>MCP</strong> -- Tools from connected MCP servers. Select &quot;All&quot; or specify individual servers.</li>
          </ul>
          <p className={paragraphClass}>
            Tool governance rules (if configured) always apply -- tools on the deny list are blocked
            even in autopilot mode. All tool calls are logged in the run history for review.
          </p>

          {/* Bottom padding */}
          <div className="h-8" />
        </div>
      </div>
    </>
  );
}
