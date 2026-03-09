import { HardDrive } from "lucide-react";

interface DiskUsageBarProps {
  totalBytes: number;
  worktreeCount: number;
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const k = 1024;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  const idx = Math.min(i, units.length - 1);
  const value = bytes / k ** idx;
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function DiskUsageBar({ totalBytes, worktreeCount }: DiskUsageBarProps) {
  return (
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <HardDrive className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
      <span>
        {worktreeCount} worktree{worktreeCount !== 1 ? "s" : ""}
        {totalBytes > 0 && <> &middot; {formatBytes(totalBytes)} total</>}
      </span>
    </div>
  );
}
