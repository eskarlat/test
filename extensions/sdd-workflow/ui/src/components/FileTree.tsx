import { useState } from "react";
import type { FileInfo } from "../types.js";

interface FileTreeProps {
  files: FileInfo[];
  selectedPath: string | null;
  onSelect: (path: string) => void;
  commentCounts: Record<string, number>;
}

function TreeNode({
  node,
  depth,
  selectedPath,
  onSelect,
  commentCounts,
}: {
  node: FileInfo;
  depth: number;
  selectedPath: string | null;
  onSelect: (path: string) => void;
  commentCounts: Record<string, number>;
}) {
  const [open, setOpen] = useState(depth < 2);
  const isSelected = selectedPath === node.path;
  const count = commentCounts[node.path] ?? 0;

  if (node.type === "directory") {
    return (
      <div>
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 w-full px-2 py-1 text-sm text-muted-foreground hover:text-foreground hover:bg-accent/50 rounded transition-colors"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          <span className="text-[10px]">{open ? "▼" : "▶"}</span>
          <span>{node.name}</span>
        </button>
        {open && node.children?.map((child) => (
          <TreeNode
            key={child.path}
            node={child}
            depth={depth + 1}
            selectedPath={selectedPath}
            onSelect={onSelect}
            commentCounts={commentCounts}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      onClick={() => onSelect(node.path)}
      className={`flex items-center justify-between w-full px-2 py-1 text-sm rounded transition-colors ${
        isSelected
          ? "bg-primary/10 text-primary font-medium"
          : "text-foreground hover:bg-accent/50"
      }`}
      style={{ paddingLeft: `${depth * 12 + 20}px` }}
    >
      <span className="truncate">{node.name}</span>
      {count > 0 && (
        <span className="ml-2 flex-shrink-0 inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 text-[10px] font-semibold">
          {count}
        </span>
      )}
    </button>
  );
}

export default function FileTree({ files, selectedPath, onSelect, commentCounts }: FileTreeProps) {
  return (
    <div className="flex flex-col py-1">
      {files.map((f) => (
        <TreeNode
          key={f.path}
          node={f}
          depth={0}
          selectedPath={selectedPath}
          onSelect={onSelect}
          commentCounts={commentCounts}
        />
      ))}
    </div>
  );
}
