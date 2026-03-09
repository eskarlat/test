import { File, Folder, Code2 } from "lucide-react";
import type { Attachment } from "../../types/chat";

interface ChatAttachmentPreviewProps {
  attachments: Attachment[];
}

/**
 * Renders a row of attachment chips for files, directories, and
 * code selections attached to a chat message.
 */
export function ChatAttachmentPreview({
  attachments,
}: ChatAttachmentPreviewProps) {
  if (attachments.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 py-1">
      {attachments.map((attachment, i) => (
        <AttachmentChip key={i} attachment={attachment} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual chip
// ---------------------------------------------------------------------------

function AttachmentChip({ attachment }: { attachment: Attachment }) {
  switch (attachment.type) {
    case "file":
      return (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground"
          title={attachment.path}
        >
          <File className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate max-w-[180px]">
            {attachment.displayName ?? fileName(attachment.path)}
          </span>
        </span>
      );

    case "directory":
      return (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground"
          title={attachment.path}
        >
          <Folder className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate max-w-[180px]">
            {attachment.displayName ?? dirName(attachment.path)}
          </span>
        </span>
      );

    case "selection":
      return (
        <span
          className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-0.5 text-xs text-foreground"
          title={`${attachment.filePath}:${attachment.selection.start.line}-${attachment.selection.end.line}`}
        >
          <Code2 className="h-3 w-3 shrink-0 text-muted-foreground" />
          <span className="truncate max-w-[180px]">
            {attachment.displayName ??
              `${fileName(attachment.filePath)}:${attachment.selection.start.line}-${attachment.selection.end.line}`}
          </span>
        </span>
      );
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fileName(path: string): string {
  const parts = path.split(/[/\\]/);
  return parts[parts.length - 1] ?? path;
}

function dirName(path: string): string {
  const clean = path.replace(/[/\\]$/, "");
  const parts = clean.split(/[/\\]/);
  return parts[parts.length - 1] ?? path;
}
