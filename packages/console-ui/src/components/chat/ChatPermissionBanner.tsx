import { useState, useEffect, useCallback } from "react";
import {
  Terminal,
  FileEdit,
  FileSearch,
  Globe,
  Plug,
  Wrench,
  ShieldCheck,
} from "lucide-react";
import { useChatStore } from "../../stores/chat-store";
import type { PermissionRequest } from "../../types/chat";

interface ChatPermissionBannerProps {
  request: PermissionRequest;
}

const AUTO_DENY_SECONDS = 30;

const PERMISSION_ICONS: Record<string, typeof Terminal> = {
  shell: Terminal,
  write: FileEdit,
  read: FileSearch,
  mcp: Plug,
  url: Globe,
  "custom-tool": Wrench,
};

const PERMISSION_LABELS: Record<string, string> = {
  shell: "Shell Command",
  write: "Write File",
  read: "Read File",
  mcp: "MCP Tool",
  url: "Network Access",
  "custom-tool": "Custom Tool",
};

export function ChatPermissionBanner({ request }: ChatPermissionBannerProps) {
  const [secondsLeft, setSecondsLeft] = useState(AUTO_DENY_SECONDS);
  const respondToPermission = useChatStore((s) => s.respondToPermission);
  const setAutopilot = useChatStore((s) => s.setAutopilot);

  const handleDeny = useCallback(() => {
    respondToPermission(request.requestId, false);
  }, [request.requestId, respondToPermission]);

  const handleApprove = useCallback(() => {
    respondToPermission(request.requestId, true);
  }, [request.requestId, respondToPermission]);

  const handleAllowAll = useCallback(() => {
    setAutopilot(true);
    respondToPermission(request.requestId, true);
  }, [request.requestId, respondToPermission, setAutopilot]);

  useEffect(() => {
    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          handleDeny();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [handleDeny]);

  const Icon = PERMISSION_ICONS[request.permissionKind] ?? Wrench;
  const label = PERMISSION_LABELS[request.permissionKind] ?? request.permissionKind;
  const pct = (secondsLeft / AUTO_DENY_SECONDS) * 100;

  return (
    <div className="my-2 rounded-lg border border-border bg-card overflow-hidden">
      {/* Progress bar — thin, at the very top */}
      <div className="h-0.5 bg-muted">
        <div
          className="h-full bg-foreground/20 transition-all duration-1000 ease-linear"
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="flex items-center gap-3 px-4 py-3">
        {/* Icon + info */}
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-sm font-medium truncate">{request.title}</div>
            <div className="text-[11px] text-muted-foreground truncate">
              {request.message || label}
            </div>
          </div>
        </div>

        {/* Countdown */}
        <span className="text-[11px] text-muted-foreground tabular-nums flex-shrink-0">
          {secondsLeft}s
        </span>

        {/* Actions */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Tertiary — Deny */}
          <button
            onClick={handleDeny}
            className="px-2.5 py-1.5 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Deny
          </button>

          {/* Secondary — Allow All */}
          <button
            onClick={handleAllowAll}
            title="Allow all tools for the rest of this session"
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-border text-xs font-medium text-foreground hover:bg-muted transition-colors"
          >
            <ShieldCheck className="h-3 w-3" />
            Allow All
          </button>

          {/* Primary — Allow */}
          <button
            onClick={handleApprove}
            className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-medium hover:bg-primary/90 transition-colors"
          >
            Allow
          </button>
        </div>
      </div>
    </div>
  );
}
