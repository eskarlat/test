import { useEffect, useState, useCallback } from "react";
import type { JiraIssue, JiraComment } from "../types.js";
import { getIssue, getComments, addComment, adfToText } from "../api.js";

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function statusColor(colorName: string): string {
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

// ---- Comment Item ----

function CommentItem({ comment }: { comment: JiraComment }) {
  const bodyText = adfToText(comment.body).trim();

  return (
    <div className="flex gap-3 py-3 border-b border-border last:border-0">
      <img
        src={comment.author.avatarUrls["24x24"] || comment.author.avatarUrls["16x16"]}
        alt={comment.author.displayName}
        className="w-6 h-6 rounded-full flex-shrink-0 mt-0.5"
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-medium">{comment.author.displayName}</span>
          <span className="text-xs text-muted-foreground">{timeAgo(comment.created)}</span>
          {comment.created !== comment.updated && (
            <span className="text-xs text-muted-foreground italic">edited</span>
          )}
        </div>
        <p className="text-sm text-foreground whitespace-pre-wrap">{bodyText}</p>
      </div>
    </div>
  );
}

// ---- Add Comment Form ----

function AddCommentForm({
  apiBaseUrl,
  issueKey,
  onAdded,
}: {
  apiBaseUrl: string;
  issueKey: string;
  onAdded: () => void;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
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

  return (
    <form onSubmit={handleSubmit} className="mt-4">
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Add a comment..."
        rows={3}
        className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-y"
      />
      {error && <p className="text-xs text-destructive mt-1">{error}</p>}
      <div className="flex justify-end mt-2">
        <button
          type="submit"
          disabled={submitting || !text.trim()}
          className="px-3 py-1.5 text-sm font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? "Posting..." : "Comment"}
        </button>
      </div>
    </form>
  );
}

// ---- Issue Detail ----

interface IssueDetailProps {
  apiBaseUrl: string;
  issueKey: string;
  onBack: () => void;
}

export function IssueDetail({ apiBaseUrl, issueKey, onBack }: IssueDetailProps) {
  const [issue, setIssue] = useState<JiraIssue | null>(null);
  const [comments, setComments] = useState<JiraComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [issueData, commentsData] = await Promise.all([
        getIssue(apiBaseUrl, issueKey),
        getComments(apiBaseUrl, issueKey),
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
    return (
      <div className="p-6 space-y-4">
        <div className="h-6 w-32 bg-muted animate-pulse rounded" />
        <div className="h-8 w-3/4 bg-muted animate-pulse rounded" />
        <div className="h-24 w-full bg-muted animate-pulse rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6">
        <button type="button" onClick={onBack} className="text-sm text-primary hover:underline mb-4">
          &larr; Back to issues
        </button>
        <div className="rounded-md bg-destructive/10 border border-destructive/20 p-4 text-sm text-destructive">
          {error}
        </div>
      </div>
    );
  }

  if (!issue) return null;

  const { fields } = issue;
  const description = fields.description ? adfToText(fields.description).trim() : null;

  return (
    <div className="p-6 max-w-4xl">
      {/* Back link */}
      <button type="button" onClick={onBack} className="text-sm text-primary hover:underline mb-4 inline-block">
        &larr; Back to issues
      </button>

      {/* Header */}
      <div className="flex items-start gap-3 mb-6">
        {fields.issuetype.iconUrl && (
          <img src={fields.issuetype.iconUrl} alt={fields.issuetype.name} className="w-5 h-5 mt-1" />
        )}
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-sm font-mono text-muted-foreground">{issue.key}</span>
            <span
              className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${statusColor(fields.status.statusCategory.colorName)}`}
            >
              {fields.status.name}
            </span>
            {fields.priority && (
              <img
                src={fields.priority.iconUrl}
                alt={fields.priority.name}
                title={fields.priority.name}
                className="w-4 h-4"
              />
            )}
          </div>
          <h1 className="text-xl font-semibold">{fields.summary}</h1>
        </div>
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6 p-4 rounded-lg bg-muted/50 border border-border">
        <div>
          <dt className="text-xs text-muted-foreground mb-1">Assignee</dt>
          <dd className="text-sm flex items-center gap-1.5">
            {fields.assignee ? (
              <>
                <img
                  src={fields.assignee.avatarUrls["16x16"]}
                  alt=""
                  className="w-4 h-4 rounded-full"
                />
                {fields.assignee.displayName}
              </>
            ) : (
              <span className="text-muted-foreground">Unassigned</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground mb-1">Reporter</dt>
          <dd className="text-sm flex items-center gap-1.5">
            {fields.reporter ? (
              <>
                <img
                  src={fields.reporter.avatarUrls["16x16"]}
                  alt=""
                  className="w-4 h-4 rounded-full"
                />
                {fields.reporter.displayName}
              </>
            ) : (
              <span className="text-muted-foreground">Unknown</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground mb-1">Created</dt>
          <dd className="text-sm">{timeAgo(fields.created)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground mb-1">Updated</dt>
          <dd className="text-sm">{timeAgo(fields.updated)}</dd>
        </div>
      </div>

      {/* Labels */}
      {fields.labels.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-6">
          {fields.labels.map((label) => (
            <span
              key={label}
              className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground border border-border"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Description */}
      {description && (
        <div className="mb-8">
          <h2 className="text-sm font-semibold mb-2">Description</h2>
          <div className="text-sm text-foreground whitespace-pre-wrap rounded-md bg-muted/30 p-4 border border-border">
            {description}
          </div>
        </div>
      )}

      {/* Comments */}
      <div>
        <h2 className="text-sm font-semibold mb-3">
          Comments{" "}
          <span className="text-muted-foreground font-normal">({comments.length})</span>
        </h2>

        {comments.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4">No comments yet.</p>
        ) : (
          <div className="divide-y-0">
            {comments.map((comment) => (
              <CommentItem key={comment.id} comment={comment} />
            ))}
          </div>
        )}

        <AddCommentForm
          apiBaseUrl={apiBaseUrl}
          issueKey={issue.key}
          onAdded={() => void fetchData()}
        />
      </div>
    </div>
  );
}
