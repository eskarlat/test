import type {
  JiraSearchResult,
  JiraIssue,
  JiraCommentsResult,
  JiraUser,
} from "./types.js";

async function request<T>(
  apiBaseUrl: string,
  path: string,
  options?: RequestInit,
): Promise<T> {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers as Record<string, string>),
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}

export function searchIssues(
  apiBaseUrl: string,
  jql: string,
  startAt = 0,
  maxResults = 20,
): Promise<JiraSearchResult> {
  const params = new URLSearchParams({
    jql,
    startAt: String(startAt),
    maxResults: String(maxResults),
  });
  return request(apiBaseUrl, `/issues?${params}`);
}

export function getIssue(
  apiBaseUrl: string,
  issueKey: string,
): Promise<JiraIssue> {
  return request(apiBaseUrl, `/issues/${encodeURIComponent(issueKey)}`);
}

export function getComments(
  apiBaseUrl: string,
  issueKey: string,
  startAt = 0,
  maxResults = 50,
): Promise<JiraCommentsResult> {
  const params = new URLSearchParams({
    startAt: String(startAt),
    maxResults: String(maxResults),
  });
  return request(
    apiBaseUrl,
    `/issues/${encodeURIComponent(issueKey)}/comments?${params}`,
  );
}

export function addComment(
  apiBaseUrl: string,
  issueKey: string,
  body: string,
): Promise<void> {
  return request(
    apiBaseUrl,
    `/issues/${encodeURIComponent(issueKey)}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ body }),
    },
  );
}

export function getMyself(apiBaseUrl: string): Promise<JiraUser> {
  return request(apiBaseUrl, `/myself`);
}

// ---- ADF (Atlassian Document Format) → plain text ----

interface AdfNode {
  type: string;
  text?: string;
  content?: AdfNode[];
  attrs?: Record<string, unknown>;
}

export function adfToText(node: unknown): string {
  if (!node || typeof node !== "object") return "";
  const n = node as AdfNode;

  if (n.type === "text") return n.text ?? "";

  const children = n.content;
  if (!Array.isArray(children)) return n.text ?? "";

  const parts: string[] = [];
  for (const child of children) {
    parts.push(adfToText(child));
  }

  switch (n.type) {
    case "paragraph":
      return parts.join("") + "\n";
    case "heading":
      return parts.join("") + "\n";
    case "bulletList":
    case "orderedList":
      return parts.join("");
    case "listItem":
      return "  - " + parts.join("").trim() + "\n";
    case "codeBlock":
      return parts.join("") + "\n";
    case "blockquote":
      return (
        parts
          .join("")
          .split("\n")
          .map((l) => "> " + l)
          .join("\n") + "\n"
      );
    case "hardBreak":
      return "\n";
    default:
      return parts.join("");
  }
}
