import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import type { ExtensionPageProps } from "@renre-kit/extension-sdk";
import type { TaskInfo, FileInfo, FileContent, InlineComment } from "../types.js";
import { fetchTask, fetchFile, fetchMtime } from "../api.js";
import FileTree from "../components/FileTree.js";
import MarkdownViewer from "../components/MarkdownViewer.js";
import ReviewChat from "../components/ReviewChat.js";

function useQuery(): URLSearchParams {
  return new URLSearchParams(window.location.hash.split("?")[1] ?? "");
}

export default function TaskDetailPage({
  projectId,
  extensionName,
  apiBaseUrl,
}: ExtensionPageProps) {
  const query = useQuery();
  const taskName = query.get("task") ?? "";

  const [task, setTask] = useState<TaskInfo | null>(null);
  const [files, setFiles] = useState<FileInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // File viewer state
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<FileContent | null>(null);
  const [fileLoading, setFileLoading] = useState(false);
  const [fileUpdated, setFileUpdated] = useState(false);
  const lastMtimeRef = useRef<string | null>(null);

  // Comments — in-memory per file
  const [commentsByFile, setCommentsByFile] = useState<Record<string, InlineComment[]>>({});

  // Review panel
  const [showReview, setShowReview] = useState(false);

  // Current file's comments
  const currentComments = useMemo(
    () => (selectedPath ? commentsByFile[selectedPath] ?? [] : []),
    [commentsByFile, selectedPath],
  );

  // Comment counts per file (for FileTree badges)
  const commentCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const [path, comments] of Object.entries(commentsByFile)) {
      if (comments.length > 0) counts[path] = comments.length;
    }
    return counts;
  }, [commentsByFile]);

  // Load task
  useEffect(() => {
    if (!taskName) return;
    fetchTask(apiBaseUrl, taskName)
      .then((r) => {
        setTask(r.task);
        setFiles(r.files);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [apiBaseUrl, taskName]);

  // Load file content
  useEffect(() => {
    if (!selectedPath || !taskName) return;
    setFileLoading(true);
    setFileUpdated(false);
    fetchFile(apiBaseUrl, taskName, selectedPath)
      .then((r) => {
        setFileContent(r);
        lastMtimeRef.current = r.mtime;
      })
      .catch((e) => setError(String(e)))
      .finally(() => setFileLoading(false));
  }, [apiBaseUrl, taskName, selectedPath]);

  // Poll for file changes every 5s
  useEffect(() => {
    if (!selectedPath || !taskName) return;
    const interval = setInterval(async () => {
      try {
        const { mtime } = await fetchMtime(apiBaseUrl, taskName, selectedPath);
        if (lastMtimeRef.current && mtime !== lastMtimeRef.current) {
          setFileUpdated(true);
        }
      } catch {
        // ignore polling errors
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [apiBaseUrl, taskName, selectedPath]);

  // Reload file when "Updated" badge is clicked
  const reloadFile = useCallback(() => {
    if (!selectedPath || !taskName) return;
    setFileLoading(true);
    fetchFile(apiBaseUrl, taskName, selectedPath)
      .then((r) => {
        setFileContent(r);
        lastMtimeRef.current = r.mtime;
        setFileUpdated(false);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setFileLoading(false));
  }, [apiBaseUrl, taskName, selectedPath]);

  const handleAddComment = useCallback(
    (lineNumber: number, content: string) => {
      if (!selectedPath) return;
      const comment: InlineComment = {
        id: crypto.randomUUID(),
        lineNumber,
        content,
        createdAt: new Date().toISOString(),
      };
      setCommentsByFile((prev) => ({
        ...prev,
        [selectedPath]: [...(prev[selectedPath] ?? []), comment],
      }));
    },
    [selectedPath],
  );

  const handleRemoveComment = useCallback(
    (id: string) => {
      if (!selectedPath) return;
      setCommentsByFile((prev) => ({
        ...prev,
        [selectedPath]: (prev[selectedPath] ?? []).filter((c) => c.id !== id),
      }));
    },
    [selectedPath],
  );

  const navigateBack = useCallback(() => {
    window.location.hash = `#/${projectId}/${extensionName}/tasks`;
  }, [projectId, extensionName]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading task...</div>
      </div>
    );
  }

  if (error && !task) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center">
          <p className="text-destructive font-medium">Failed to load task</p>
          <p className="text-sm text-muted-foreground mt-1">{error}</p>
        </div>
      </div>
    );
  }

  if (!task) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-muted-foreground">Task not found</p>
      </div>
    );
  }

  const totalComments = Object.values(commentsByFile).reduce((sum, arr) => sum + arr.length, 0);

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-muted/30">
        <div className="flex items-center gap-3">
          <button
            onClick={navigateBack}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            ← Tasks
          </button>
          <span className="text-sm font-semibold">{task.name}</span>
          <span className="text-xs text-muted-foreground">
            {task.phases.filter((p) => p.status === "Completed").length}/{task.phases.length} phases
          </span>
        </div>
        <div className="flex items-center gap-2">
          {fileUpdated && (
            <button
              onClick={reloadFile}
              className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-medium bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 transition-colors"
            >
              File updated — click to reload
            </button>
          )}
          <button
            onClick={() => setShowReview(!showReview)}
            className={(() => {
              const base = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors";
              if (showReview) return `${base} bg-primary text-primary-foreground`;
              if (totalComments > 0) return `${base} bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 hover:bg-yellow-500/20`;
              return `${base} bg-muted text-muted-foreground hover:bg-accent`;
            })()}
          >
            Review
            {totalComments > 0 && (
              <span className="inline-flex items-center justify-center h-4 min-w-4 px-1 rounded-full bg-yellow-500/20 text-[10px] font-bold">
                {totalComments}
              </span>
            )}
          </button>
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* File tree sidebar */}
        <div className="w-56 flex-shrink-0 border-r border-border overflow-auto bg-muted/10">
          <div className="px-3 py-2 border-b border-border">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
              Files
            </span>
          </div>
          <FileTree
            files={files}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
            commentCounts={commentCounts}
          />
        </div>

        {/* File viewer */}
        <div className="flex-1 flex overflow-hidden">
          {selectedPath && fileContent && (
            <div className="flex-1 overflow-hidden">
              <MarkdownViewer
                content={fileContent.content}
                filePath={selectedPath}
                comments={currentComments}
                onAddComment={handleAddComment}
                onRemoveComment={handleRemoveComment}
                fileUpdated={fileUpdated}
              />
            </div>
          )}
          {!(selectedPath && fileContent) && fileLoading && (
            <div className="flex-1 flex items-center justify-center">
              <span className="text-sm text-muted-foreground">Loading file...</span>
            </div>
          )}
          {!(selectedPath && fileContent) && !fileLoading && (
            <div className="flex-1 flex items-center justify-center">
              <div className="text-center">
                <p className="text-muted-foreground text-sm">Select a file to view</p>
                <p className="text-xs text-muted-foreground mt-1">
                  Click line numbers in source view to add comments
                </p>
              </div>
            </div>
          )}

          {/* Review panel */}
          {showReview && (
            <div className="w-96 flex-shrink-0">
              <ReviewChat
                apiBaseUrl={apiBaseUrl}
                taskName={taskName}
                filePath={selectedPath}
                comments={currentComments}
                onClose={() => setShowReview(false)}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
