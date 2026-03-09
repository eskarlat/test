export interface TaskInfo {
  name: string;
  phases: PhaseInfo[];
  adrs: string[];
  diagrams: string[];
  lastModified: string;
  createdAt: string;
}

export interface PhaseInfo {
  file: string;
  title: string;
  number: string;
  status: string;
}

export interface FileInfo {
  path: string;
  name: string;
  type: "file" | "directory";
  children?: FileInfo[];
  mtime?: string;
}

export interface FileContent {
  content: string;
  mtime: string;
  lineCount: number;
}

export interface InlineComment {
  id: string;
  lineNumber: number;
  content: string;
  createdAt: string;
}

export interface ReviewResponse {
  review: string;
  model: string;
  usage: { promptTokens: number; completionTokens: number };
}

export type TimeGroup = "today" | "this-week" | "this-month" | "older";
