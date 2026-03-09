import type { TaskInfo, FileInfo, FileContent, ReviewResponse, InlineComment } from "./types.js";

async function request<T>(base: string, path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

export function fetchTasks(base: string) {
  return request<{ tasks: TaskInfo[] }>(base, "/tasks");
}

export function fetchTask(base: string, name: string) {
  return request<{ task: TaskInfo; files: FileInfo[] }>(base, `/tasks/${encodeURIComponent(name)}`);
}

export function fetchFile(base: string, taskName: string, filePath: string) {
  return request<FileContent>(
    base,
    `/tasks/${encodeURIComponent(taskName)}/file?path=${encodeURIComponent(filePath)}`,
  );
}

export function fetchMtime(base: string, taskName: string, filePath: string) {
  return request<{ mtime: string }>(
    base,
    `/tasks/${encodeURIComponent(taskName)}/mtime?path=${encodeURIComponent(filePath)}`,
  );
}

export function submitReview(
  base: string,
  taskName: string,
  filePath: string,
  comments: Array<{ lineNumber: number; content: string }>,
  customPrompt?: string,
) {
  return request<ReviewResponse>(base, `/tasks/${encodeURIComponent(taskName)}/review`, {
    method: "POST",
    body: JSON.stringify({ filePath, comments, customPrompt }),
  });
}
