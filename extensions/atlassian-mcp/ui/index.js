// ui/src/pages/IssuesPage.tsx
import { useEffect as useEffect2, useState as useState2, useCallback as useCallback2 } from "react";

// ui/src/api.ts
async function request(apiBaseUrl, path, options) {
  const res = await fetch(`${apiBaseUrl}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API error ${res.status}: ${text}`);
  }
  return res.json();
}
function searchIssues(apiBaseUrl, jql, startAt = 0, maxResults = 20) {
  const params = new URLSearchParams({
    jql,
    startAt: String(startAt),
    maxResults: String(maxResults)
  });
  return request(apiBaseUrl, `/issues?${params}`);
}
function getIssue(apiBaseUrl, issueKey) {
  return request(apiBaseUrl, `/issues/${encodeURIComponent(issueKey)}`);
}
function getComments(apiBaseUrl, issueKey, startAt = 0, maxResults = 50) {
  const params = new URLSearchParams({
    startAt: String(startAt),
    maxResults: String(maxResults)
  });
  return request(
    apiBaseUrl,
    `/issues/${encodeURIComponent(issueKey)}/comments?${params}`
  );
}
function addComment(apiBaseUrl, issueKey, body) {
  return request(
    apiBaseUrl,
    `/issues/${encodeURIComponent(issueKey)}/comments`,
    {
      method: "POST",
      body: JSON.stringify({ body })
    }
  );
}
function adfToText(node) {
  if (!node || typeof node !== "object") return "";
  const n = node;
  if (n.type === "text") return n.text ?? "";
  const children = n.content;
  if (!Array.isArray(children)) return n.text ?? "";
  const parts = [];
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
      return parts.join("").split("\n").map((l) => "> " + l).join("\n") + "\n";
    case "hardBreak":
      return "\n";
    default:
      return parts.join("");
  }
}

// ui/src/components/utils.ts
function statusColor(colorName) {
  switch (colorName) {
    case "blue-gray":
    case "default":
      return "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
    case "blue":
      return "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200";
    case "green":
      return "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200";
    case "yellow":
      return "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200";
    default:
      return "bg-gray-200 text-gray-800 dark:bg-gray-700 dark:text-gray-200";
  }
}
function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 6e4);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

// ui/src/components/IssueRow.tsx
import { jsx, jsxs } from "react/jsx-runtime";
function IssueRow({ issue, onClick }) {
  const { fields } = issue;
  return /* @__PURE__ */ jsxs(
    "button",
    {
      type: "button",
      onClick: () => onClick(issue.key),
      className: "w-full text-left px-4 py-3 border-b border-border hover:bg-accent/50 transition-colors flex items-center gap-3 group",
      children: [
        fields.issuetype.iconUrl && /* @__PURE__ */ jsx(
          "img",
          {
            src: fields.issuetype.iconUrl,
            alt: fields.issuetype.name,
            className: "w-4 h-4 flex-shrink-0"
          }
        ),
        /* @__PURE__ */ jsx("span", { className: "text-xs font-mono text-muted-foreground w-24 flex-shrink-0", children: issue.key }),
        /* @__PURE__ */ jsx("span", { className: "flex-1 text-sm truncate group-hover:text-primary transition-colors", children: fields.summary }),
        fields.labels.length > 0 && /* @__PURE__ */ jsx("div", { className: "hidden lg:flex gap-1 flex-shrink-0", children: fields.labels.slice(0, 2).map((label) => /* @__PURE__ */ jsx(
          "span",
          {
            className: "text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground",
            children: label
          },
          label
        )) }),
        /* @__PURE__ */ jsx(
          "span",
          {
            className: `text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${statusColor(fields.status.statusCategory.colorName)}`,
            children: fields.status.name
          }
        ),
        fields.priority && /* @__PURE__ */ jsx(
          "img",
          {
            src: fields.priority.iconUrl,
            alt: fields.priority.name,
            title: fields.priority.name,
            className: "w-4 h-4 flex-shrink-0"
          }
        ),
        fields.assignee ? /* @__PURE__ */ jsx(
          "img",
          {
            src: fields.assignee.avatarUrls["24x24"] || fields.assignee.avatarUrls["16x16"],
            alt: fields.assignee.displayName,
            title: fields.assignee.displayName,
            className: "w-5 h-5 rounded-full flex-shrink-0"
          }
        ) : /* @__PURE__ */ jsx("div", { className: "w-5 h-5 rounded-full bg-muted flex-shrink-0", title: "Unassigned" }),
        /* @__PURE__ */ jsx("span", { className: "text-[11px] text-muted-foreground w-16 text-right flex-shrink-0", children: timeAgo(fields.updated) })
      ]
    }
  );
}

// ui/src/components/IssueDetail.tsx
import { useEffect, useState, useCallback } from "react";
import { Fragment, jsx as jsx2, jsxs as jsxs2 } from "react/jsx-runtime";
function CommentItem({ comment }) {
  const bodyText = adfToText(comment.body).trim();
  return /* @__PURE__ */ jsxs2("div", { className: "flex gap-3 py-3 border-b border-border last:border-0", children: [
    /* @__PURE__ */ jsx2(
      "img",
      {
        src: comment.author.avatarUrls["24x24"] || comment.author.avatarUrls["16x16"],
        alt: comment.author.displayName,
        className: "w-6 h-6 rounded-full flex-shrink-0 mt-0.5"
      }
    ),
    /* @__PURE__ */ jsxs2("div", { className: "flex-1 min-w-0", children: [
      /* @__PURE__ */ jsxs2("div", { className: "flex items-center gap-2 mb-1", children: [
        /* @__PURE__ */ jsx2("span", { className: "text-sm font-medium", children: comment.author.displayName }),
        /* @__PURE__ */ jsx2("span", { className: "text-xs text-muted-foreground", children: timeAgo(comment.created) }),
        comment.created !== comment.updated && /* @__PURE__ */ jsx2("span", { className: "text-xs text-muted-foreground italic", children: "edited" })
      ] }),
      /* @__PURE__ */ jsx2("p", { className: "text-sm text-foreground whitespace-pre-wrap", children: bodyText })
    ] })
  ] });
}
function AddCommentForm({
  apiBaseUrl,
  issueKey,
  onAdded
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      await addComment(apiBaseUrl, issueKey, text.trim());
      setText("");
      onAdded();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };
  return /* @__PURE__ */ jsxs2("form", { onSubmit: handleSubmit, className: "mt-4", children: [
    /* @__PURE__ */ jsx2(
      "textarea",
      {
        value: text,
        onChange: (e) => setText(e.target.value),
        placeholder: "Add a comment...",
        rows: 3,
        className: "w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
      }
    ),
    error && /* @__PURE__ */ jsx2("p", { className: "text-xs text-destructive mt-1", children: error }),
    /* @__PURE__ */ jsx2("div", { className: "flex justify-end mt-2", children: /* @__PURE__ */ jsx2(
      "button",
      {
        type: "submit",
        disabled: submitting || !text.trim(),
        className: "px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors",
        children: submitting ? "Posting..." : "Comment"
      }
    ) })
  ] });
}
function IssueDetail({ apiBaseUrl, issueKey, onBack }) {
  const [issue, setIssue] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [issueData, commentsData] = await Promise.all([
        getIssue(apiBaseUrl, issueKey),
        getComments(apiBaseUrl, issueKey)
      ]);
      setIssue(issueData);
      setComments(commentsData.comments);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, issueKey]);
  useEffect(() => {
    void fetchData();
  }, [fetchData]);
  if (loading) {
    return /* @__PURE__ */ jsxs2("div", { className: "p-6 space-y-4", children: [
      /* @__PURE__ */ jsx2("div", { className: "h-6 w-32 bg-muted animate-pulse rounded" }),
      /* @__PURE__ */ jsx2("div", { className: "h-8 w-3/4 bg-muted animate-pulse rounded" }),
      /* @__PURE__ */ jsx2("div", { className: "h-24 w-full bg-muted animate-pulse rounded" })
    ] });
  }
  if (error) {
    return /* @__PURE__ */ jsxs2("div", { className: "p-6", children: [
      /* @__PURE__ */ jsx2("button", { type: "button", onClick: onBack, className: "text-sm text-primary hover:underline mb-4", children: "\u2190 Back to issues" }),
      /* @__PURE__ */ jsx2("div", { className: "rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive", children: error })
    ] });
  }
  if (!issue) return null;
  const { fields } = issue;
  const description = fields.description ? adfToText(fields.description).trim() : null;
  return /* @__PURE__ */ jsxs2("div", { className: "p-6 max-w-4xl", children: [
    /* @__PURE__ */ jsx2("button", { type: "button", onClick: onBack, className: "text-sm text-primary hover:underline mb-4 inline-block", children: "\u2190 Back to issues" }),
    /* @__PURE__ */ jsxs2("div", { className: "flex items-start gap-3 mb-6", children: [
      fields.issuetype.iconUrl && /* @__PURE__ */ jsx2("img", { src: fields.issuetype.iconUrl, alt: fields.issuetype.name, className: "w-5 h-5 mt-1" }),
      /* @__PURE__ */ jsxs2("div", { className: "flex-1", children: [
        /* @__PURE__ */ jsxs2("div", { className: "flex items-center gap-2 mb-1", children: [
          /* @__PURE__ */ jsx2("span", { className: "text-sm font-mono text-muted-foreground", children: issue.key }),
          /* @__PURE__ */ jsx2(
            "span",
            {
              className: `text-[11px] font-medium px-2 py-0.5 rounded-full ${statusColor(fields.status.statusCategory.colorName)}`,
              children: fields.status.name
            }
          ),
          fields.priority && /* @__PURE__ */ jsx2(
            "img",
            {
              src: fields.priority.iconUrl,
              alt: fields.priority.name,
              title: fields.priority.name,
              className: "w-4 h-4"
            }
          )
        ] }),
        /* @__PURE__ */ jsx2("h1", { className: "text-xl font-semibold", children: fields.summary })
      ] })
    ] }),
    /* @__PURE__ */ jsxs2("div", { className: "grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 p-4 rounded-lg bg-muted/50 border border-border", children: [
      /* @__PURE__ */ jsxs2("div", { children: [
        /* @__PURE__ */ jsx2("dt", { className: "text-xs text-muted-foreground mb-1", children: "Assignee" }),
        /* @__PURE__ */ jsx2("dd", { className: "text-sm flex items-center gap-1.5", children: fields.assignee ? /* @__PURE__ */ jsxs2(Fragment, { children: [
          /* @__PURE__ */ jsx2(
            "img",
            {
              src: fields.assignee.avatarUrls["16x16"],
              alt: "",
              className: "w-4 h-4 rounded-full"
            }
          ),
          fields.assignee.displayName
        ] }) : /* @__PURE__ */ jsx2("span", { className: "text-muted-foreground", children: "Unassigned" }) })
      ] }),
      /* @__PURE__ */ jsxs2("div", { children: [
        /* @__PURE__ */ jsx2("dt", { className: "text-xs text-muted-foreground mb-1", children: "Reporter" }),
        /* @__PURE__ */ jsx2("dd", { className: "text-sm flex items-center gap-1.5", children: fields.reporter ? /* @__PURE__ */ jsxs2(Fragment, { children: [
          /* @__PURE__ */ jsx2(
            "img",
            {
              src: fields.reporter.avatarUrls["16x16"],
              alt: "",
              className: "w-4 h-4 rounded-full"
            }
          ),
          fields.reporter.displayName
        ] }) : /* @__PURE__ */ jsx2("span", { className: "text-muted-foreground", children: "Unknown" }) })
      ] }),
      /* @__PURE__ */ jsxs2("div", { children: [
        /* @__PURE__ */ jsx2("dt", { className: "text-xs text-muted-foreground mb-1", children: "Created" }),
        /* @__PURE__ */ jsx2("dd", { className: "text-sm", children: timeAgo(fields.created) })
      ] }),
      /* @__PURE__ */ jsxs2("div", { children: [
        /* @__PURE__ */ jsx2("dt", { className: "text-xs text-muted-foreground mb-1", children: "Updated" }),
        /* @__PURE__ */ jsx2("dd", { className: "text-sm", children: timeAgo(fields.updated) })
      ] })
    ] }),
    fields.labels.length > 0 && /* @__PURE__ */ jsx2("div", { className: "flex flex-wrap gap-1.5 mb-6", children: fields.labels.map((label) => /* @__PURE__ */ jsx2(
      "span",
      {
        className: "text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border",
        children: label
      },
      label
    )) }),
    description && /* @__PURE__ */ jsxs2("div", { className: "mb-8", children: [
      /* @__PURE__ */ jsx2("h2", { className: "text-sm font-semibold mb-2", children: "Description" }),
      /* @__PURE__ */ jsx2("div", { className: "text-sm text-foreground whitespace-pre-wrap rounded-md bg-muted/30 p-4 border border-border", children: description })
    ] }),
    /* @__PURE__ */ jsxs2("div", { children: [
      /* @__PURE__ */ jsxs2("h2", { className: "text-sm font-semibold mb-3", children: [
        "Comments",
        " ",
        /* @__PURE__ */ jsxs2("span", { className: "text-muted-foreground font-normal", children: [
          "(",
          comments.length,
          ")"
        ] })
      ] }),
      comments.length === 0 ? /* @__PURE__ */ jsx2("p", { className: "text-sm text-muted-foreground py-4", children: "No comments yet." }) : /* @__PURE__ */ jsx2("div", { className: "divide-y-0", children: comments.map((comment) => /* @__PURE__ */ jsx2(CommentItem, { comment }, comment.id)) }),
      /* @__PURE__ */ jsx2(
        AddCommentForm,
        {
          apiBaseUrl,
          issueKey: issue.key,
          onAdded: () => void fetchData()
        }
      )
    ] })
  ] });
}

// ui/src/pages/IssuesPage.tsx
import { Fragment as Fragment2, jsx as jsx3, jsxs as jsxs3 } from "react/jsx-runtime";
var QUICK_FILTERS = [
  {
    key: "assigned",
    label: "Assigned to me",
    jql: "assignee = currentUser() ORDER BY updated DESC"
  },
  {
    key: "reported",
    label: "Reported by me",
    jql: "reporter = currentUser() ORDER BY updated DESC"
  },
  {
    key: "recent",
    label: "Recently updated",
    jql: "updated >= -7d ORDER BY updated DESC"
  },
  {
    key: "bugs",
    label: "Open bugs",
    jql: 'issuetype = Bug AND statusCategory != "Done" ORDER BY priority DESC, updated DESC'
  }
];
var PAGE_SIZE = 20;
function IssuesPage({ apiBaseUrl }) {
  const [jql, setJql] = useState2("assignee = currentUser() ORDER BY updated DESC");
  const [jqlInput, setJqlInput] = useState2(jql);
  const [activeFilter, setActiveFilter] = useState2("assigned");
  const [issues, setIssues] = useState2([]);
  const [total, setTotal] = useState2(0);
  const [page, setPage] = useState2(0);
  const [loading, setLoading] = useState2(true);
  const [error, setError] = useState2(null);
  const [selectedKey, setSelectedKey] = useState2(null);
  const fetchIssues = useCallback2(
    async (query, pageNum) => {
      setLoading(true);
      setError(null);
      try {
        const result = await searchIssues(apiBaseUrl, query, pageNum * PAGE_SIZE, PAGE_SIZE);
        setIssues(result.issues);
        setTotal(result.total);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setIssues([]);
        setTotal(0);
      } finally {
        setLoading(false);
      }
    },
    [apiBaseUrl]
  );
  useEffect2(() => {
    void fetchIssues(jql, page);
  }, [jql, page, fetchIssues]);
  const handleSearch = (e) => {
    e.preventDefault();
    setActiveFilter(null);
    setPage(0);
    setJql(jqlInput);
  };
  const handleQuickFilter = (filter) => {
    const f = QUICK_FILTERS.find((qf) => qf.key === filter);
    if (!f) return;
    setActiveFilter(filter);
    setJql(f.jql);
    setJqlInput(f.jql);
    setPage(0);
  };
  if (selectedKey) {
    return /* @__PURE__ */ jsx3(
      IssueDetail,
      {
        apiBaseUrl,
        issueKey: selectedKey,
        onBack: () => setSelectedKey(null)
      }
    );
  }
  const totalPages = Math.ceil(total / PAGE_SIZE);
  return /* @__PURE__ */ jsxs3("div", { className: "h-full flex flex-col", children: [
    /* @__PURE__ */ jsxs3("div", { className: "px-6 pt-6 pb-4 border-b border-border", children: [
      /* @__PURE__ */ jsx3("h1", { className: "text-lg font-semibold mb-4", children: "Jira Issues" }),
      /* @__PURE__ */ jsxs3("form", { onSubmit: handleSearch, className: "flex gap-2 mb-3", children: [
        /* @__PURE__ */ jsx3(
          "input",
          {
            type: "text",
            value: jqlInput,
            onChange: (e) => setJqlInput(e.target.value),
            placeholder: "Enter JQL query...",
            className: "flex-1 rounded-md border border-input bg-background px-3 py-1.5 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring font-mono"
          }
        ),
        /* @__PURE__ */ jsx3(
          "button",
          {
            type: "submit",
            className: "px-4 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors",
            children: "Search"
          }
        )
      ] }),
      /* @__PURE__ */ jsx3("div", { className: "flex gap-2 flex-wrap", children: QUICK_FILTERS.map((f) => /* @__PURE__ */ jsx3(
        "button",
        {
          type: "button",
          onClick: () => handleQuickFilter(f.key),
          className: `px-3 py-1 text-xs rounded-full border transition-colors ${activeFilter === f.key ? "bg-primary text-primary-foreground border-primary" : "bg-background text-muted-foreground border-border hover:bg-accent hover:text-accent-foreground"}`,
          children: f.label
        },
        f.key
      )) })
    ] }),
    /* @__PURE__ */ jsxs3("div", { className: "flex-1 overflow-auto", children: [
      loading && /* @__PURE__ */ jsx3("div", { className: "p-6 space-y-3", children: Array.from({ length: 5 }).map((_, i) => /* @__PURE__ */ jsx3("div", { className: "h-12 bg-muted animate-pulse rounded" }, i)) }),
      !loading && error && /* @__PURE__ */ jsx3("div", { className: "p-6", children: /* @__PURE__ */ jsx3("div", { className: "rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive", children: error }) }),
      !loading && !error && issues.length === 0 && /* @__PURE__ */ jsxs3("div", { className: "flex flex-col items-center justify-center py-16 text-muted-foreground", children: [
        /* @__PURE__ */ jsxs3(
          "svg",
          {
            xmlns: "http://www.w3.org/2000/svg",
            width: "40",
            height: "40",
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: "1.5",
            strokeLinecap: "round",
            strokeLinejoin: "round",
            className: "mb-3 opacity-40",
            children: [
              /* @__PURE__ */ jsx3("circle", { cx: "11", cy: "11", r: "8" }),
              /* @__PURE__ */ jsx3("line", { x1: "21", y1: "21", x2: "16.65", y2: "16.65" })
            ]
          }
        ),
        /* @__PURE__ */ jsx3("p", { className: "text-sm", children: "No issues found" }),
        /* @__PURE__ */ jsx3("p", { className: "text-xs mt-1", children: "Try adjusting your JQL query" })
      ] }),
      !loading && !error && issues.length > 0 && /* @__PURE__ */ jsxs3(Fragment2, { children: [
        /* @__PURE__ */ jsxs3("div", { className: "px-4 py-2 text-xs text-muted-foreground border-b border-border bg-muted/30", children: [
          total,
          " issue",
          total !== 1 ? "s" : "",
          " found",
          totalPages > 1 && ` \u2014 page ${page + 1} of ${totalPages}`
        ] }),
        /* @__PURE__ */ jsx3("div", { children: issues.map((issue) => /* @__PURE__ */ jsx3(IssueRow, { issue, onClick: setSelectedKey }, issue.id)) }),
        totalPages > 1 && /* @__PURE__ */ jsxs3("div", { className: "flex items-center justify-center gap-2 py-4 border-t border-border", children: [
          /* @__PURE__ */ jsx3(
            "button",
            {
              type: "button",
              onClick: () => setPage((p) => Math.max(0, p - 1)),
              disabled: page === 0,
              className: "px-3 py-1 text-xs rounded-md border border-border bg-background hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors",
              children: "Previous"
            }
          ),
          /* @__PURE__ */ jsxs3("span", { className: "text-xs text-muted-foreground", children: [
            page + 1,
            " / ",
            totalPages
          ] }),
          /* @__PURE__ */ jsx3(
            "button",
            {
              type: "button",
              onClick: () => setPage((p) => Math.min(totalPages - 1, p + 1)),
              disabled: page >= totalPages - 1,
              className: "px-3 py-1 text-xs rounded-md border border-border bg-background hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors",
              children: "Next"
            }
          )
        ] })
      ] })
    ] })
  ] });
}

// ui/src/pages/MentionsPage.tsx
import { useEffect as useEffect3, useState as useState3, useCallback as useCallback3 } from "react";
import { Fragment as Fragment3, jsx as jsx4, jsxs as jsxs4 } from "react/jsx-runtime";
var TABS = [
  {
    key: "assigned",
    label: "Assigned to me",
    jql: 'assignee = currentUser() AND statusCategory != "Done" ORDER BY updated DESC'
  },
  {
    key: "reported",
    label: "Reported by me",
    jql: "reporter = currentUser() ORDER BY updated DESC"
  },
  {
    key: "watching",
    label: "Watching",
    jql: "watcher = currentUser() ORDER BY updated DESC"
  }
];
var PAGE_SIZE2 = 20;
function MentionsPage({ apiBaseUrl }) {
  const [activeTab, setActiveTab] = useState3("assigned");
  const [issues, setIssues] = useState3([]);
  const [total, setTotal] = useState3(0);
  const [page, setPage] = useState3(0);
  const [loading, setLoading] = useState3(true);
  const [error, setError] = useState3(null);
  const [selectedKey, setSelectedKey] = useState3(null);
  const jql = TABS.find((t) => t.key === activeTab).jql;
  const fetchIssues = useCallback3(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await searchIssues(apiBaseUrl, jql, page * PAGE_SIZE2, PAGE_SIZE2);
      setIssues(result.issues);
      setTotal(result.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setIssues([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [apiBaseUrl, jql, page]);
  useEffect3(() => {
    void fetchIssues();
  }, [fetchIssues]);
  const switchTab = (tab) => {
    setActiveTab(tab);
    setPage(0);
    setSelectedKey(null);
  };
  if (selectedKey) {
    return /* @__PURE__ */ jsx4(
      IssueDetail,
      {
        apiBaseUrl,
        issueKey: selectedKey,
        onBack: () => setSelectedKey(null)
      }
    );
  }
  const totalPages = Math.ceil(total / PAGE_SIZE2);
  return /* @__PURE__ */ jsxs4("div", { className: "h-full flex flex-col", children: [
    /* @__PURE__ */ jsxs4("div", { className: "px-6 pt-6 pb-0 border-b border-border", children: [
      /* @__PURE__ */ jsx4("h1", { className: "text-lg font-semibold mb-4", children: "My Jira Activity" }),
      /* @__PURE__ */ jsx4("div", { className: "flex gap-0", children: TABS.map((tab) => /* @__PURE__ */ jsx4(
        "button",
        {
          type: "button",
          onClick: () => switchTab(tab.key),
          className: `px-4 py-2 text-sm font-medium border-b-2 transition-colors ${activeTab === tab.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground hover:border-border"}`,
          children: tab.label
        },
        tab.key
      )) })
    ] }),
    /* @__PURE__ */ jsxs4("div", { className: "flex-1 overflow-auto", children: [
      loading && /* @__PURE__ */ jsx4("div", { className: "p-6 space-y-3", children: Array.from({ length: 5 }).map((_, i) => /* @__PURE__ */ jsx4("div", { className: "h-12 bg-muted animate-pulse rounded" }, i)) }),
      !loading && error && /* @__PURE__ */ jsx4("div", { className: "p-6", children: /* @__PURE__ */ jsx4("div", { className: "rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive", children: error }) }),
      !loading && !error && issues.length === 0 && /* @__PURE__ */ jsxs4("div", { className: "flex flex-col items-center justify-center py-16 text-muted-foreground", children: [
        /* @__PURE__ */ jsxs4(
          "svg",
          {
            xmlns: "http://www.w3.org/2000/svg",
            width: "40",
            height: "40",
            viewBox: "0 0 24 24",
            fill: "none",
            stroke: "currentColor",
            strokeWidth: "1.5",
            strokeLinecap: "round",
            strokeLinejoin: "round",
            className: "mb-3 opacity-40",
            children: [
              /* @__PURE__ */ jsx4("path", { d: "M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" }),
              /* @__PURE__ */ jsx4("path", { d: "M13.73 21a2 2 0 0 1-3.46 0" })
            ]
          }
        ),
        /* @__PURE__ */ jsx4("p", { className: "text-sm", children: "No issues found" }),
        /* @__PURE__ */ jsxs4("p", { className: "text-xs mt-1", children: [
          activeTab === "assigned" && "You have no open assigned issues",
          activeTab === "reported" && "You haven't reported any issues",
          activeTab === "watching" && "You're not watching any issues"
        ] })
      ] }),
      !loading && !error && issues.length > 0 && /* @__PURE__ */ jsxs4(Fragment3, { children: [
        /* @__PURE__ */ jsxs4("div", { className: "px-4 py-2 text-xs text-muted-foreground border-b border-border bg-muted/30", children: [
          total,
          " issue",
          total !== 1 ? "s" : "",
          totalPages > 1 && ` \u2014 page ${page + 1} of ${totalPages}`
        ] }),
        /* @__PURE__ */ jsx4("div", { children: issues.map((issue) => /* @__PURE__ */ jsx4(IssueRow, { issue, onClick: setSelectedKey }, issue.id)) }),
        totalPages > 1 && /* @__PURE__ */ jsxs4("div", { className: "flex items-center justify-center gap-2 py-4 border-t border-border", children: [
          /* @__PURE__ */ jsx4(
            "button",
            {
              type: "button",
              onClick: () => setPage((p) => Math.max(0, p - 1)),
              disabled: page === 0,
              className: "px-3 py-1 text-xs rounded-md border border-border bg-background hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors",
              children: "Previous"
            }
          ),
          /* @__PURE__ */ jsxs4("span", { className: "text-xs text-muted-foreground", children: [
            page + 1,
            " / ",
            totalPages
          ] }),
          /* @__PURE__ */ jsx4(
            "button",
            {
              type: "button",
              onClick: () => setPage((p) => Math.min(totalPages - 1, p + 1)),
              disabled: page >= totalPages - 1,
              className: "px-3 py-1 text-xs rounded-md border border-border bg-background hover:bg-accent disabled:opacity-40 disabled:cursor-not-allowed transition-colors",
              children: "Next"
            }
          )
        ] })
      ] })
    ] })
  ] });
}

// ui/src/index.tsx
var module = {
  pages: {
    issues: IssuesPage,
    mentions: MentionsPage
  }
};
var src_default = module;
var { pages } = module;
export {
  src_default as default,
  pages
};
//# sourceMappingURL=index.js.map