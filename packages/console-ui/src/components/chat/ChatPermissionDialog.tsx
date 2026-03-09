import { useState, useEffect, useCallback } from "react";
import {
  Terminal,
  FileEdit,
  FileSearch,
  Globe,
  Plug,
  Wrench,
  ShieldCheck,
  ShieldX,
  Check,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { useSocketStore } from "../../api/socket";
import { ChatFileDiff } from "./ChatFileDiff";
import type { ConfirmationBlock, FileDiffBlock } from "../../types/chat";

interface ChatPermissionDialogProps {
  block: ConfirmationBlock;
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

// ---------------------------------------------------------------------------
// PermissionHeader — icon, label, countdown or resolved-status badge
// ---------------------------------------------------------------------------

interface PermissionHeaderProps {
  permissionKind: string;
  status: ConfirmationBlock["status"];
  secondsLeft: number;
}

function PermissionHeader({ permissionKind, status, secondsLeft }: PermissionHeaderProps) {
  const Icon = PERMISSION_ICONS[permissionKind] ?? Wrench;
  const label = PERMISSION_LABELS[permissionKind] ?? permissionKind;
  const isPending = status === "pending";

  return (
    <div className="flex items-center gap-2 px-4 py-3 bg-muted/30 border-b border-border">
      <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
        {label}
      </span>
      {isPending && (
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">{secondsLeft}s</span>
      )}
      {!isPending && (
        <span
          className={cn(
            "ml-auto inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full",
            status === "approved" && "bg-green-500/20 text-green-400",
            status === "denied" && "bg-red-500/20 text-red-400",
          )}
        >
          {status === "approved" ? (
            <>
              <ShieldCheck className="h-3 w-3" /> Approved
            </>
          ) : (
            <>
              <ShieldX className="h-3 w-3" /> Denied
            </>
          )}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PermissionActions — approve/deny buttons + countdown progress bar
// ---------------------------------------------------------------------------

interface PermissionActionsProps {
  onApprove: () => void;
  onDeny: () => void;
  secondsLeft: number;
}

function PermissionActions({ onApprove, onDeny, secondsLeft }: PermissionActionsProps) {
  return (
    <div className="flex items-center gap-2 px-4 py-3 border-t border-border bg-muted/20">
      <button
        onClick={onApprove}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-green-600 hover:bg-green-700 text-white text-xs font-medium transition-colors"
      >
        <Check className="h-3.5 w-3.5" />
        Approve
      </button>
      <button
        onClick={onDeny}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-red-600 hover:bg-red-700 text-white text-xs font-medium transition-colors"
      >
        <X className="h-3.5 w-3.5" />
        Deny
      </button>
      {/* Countdown progress bar */}
      <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden ml-2">
        <div
          className="h-full bg-muted-foreground/30 transition-all duration-1000 ease-linear"
          style={{ width: `${(secondsLeft / AUTO_DENY_SECONDS) * 100}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChatPermissionDialog — composition root
// ---------------------------------------------------------------------------

export function ChatPermissionDialog({ block }: ChatPermissionDialogProps) {
  const [secondsLeft, setSecondsLeft] = useState(AUTO_DENY_SECONDS);
  const isPending = block.status === "pending";

  const handleDeny = useCallback(() => {
    const socket = useSocketStore.getState().socket;
    if (!socket || !isPending) return;
    socket.emit("chat:permission", {
      requestId: block.requestId,
      decision: { kind: "denied-interactively-by-user" },
    });
  }, [block.requestId, isPending]);

  // Countdown timer
  useEffect(() => {
    if (!isPending) return;

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
  }, [isPending, handleDeny]);

  function handleApprove(): void {
    const socket = useSocketStore.getState().socket;
    if (!socket || !isPending) return;
    socket.emit("chat:permission", {
      requestId: block.requestId,
      decision: { kind: "approved" },
    });
  }

  // Build a minimal FileDiffBlock for write permission diffs
  const diffBlock: FileDiffBlock | null =
    block.permissionKind === "write" && block.diff
      ? {
          type: "file-diff",
          fileName: block.title,
          diff: block.diff,
          isNewFile: false,
          edits: [],
          isDone: true,
        }
      : null;

  return (
    <div className="my-2 rounded-lg border border-border bg-card overflow-hidden">
      <PermissionHeader
        permissionKind={block.permissionKind}
        status={block.status}
        secondsLeft={secondsLeft}
      />

      {/* Body */}
      <div className="px-4 py-3 space-y-2">
        <div className="text-sm font-medium">{block.title}</div>
        <div className="text-xs text-muted-foreground">{block.message}</div>

        {diffBlock && <ChatFileDiff block={diffBlock} />}
      </div>

      {isPending && (
        <PermissionActions
          onApprove={handleApprove}
          onDeny={handleDeny}
          secondsLeft={secondsLeft}
        />
      )}
    </div>
  );
}
