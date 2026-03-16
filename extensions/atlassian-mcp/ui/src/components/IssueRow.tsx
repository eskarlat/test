import type { JiraIssue } from "../types.js";
import { statusColor, timeAgo } from "./utils.js";

interface IssueRowProps {
  issue: JiraIssue;
  onClick: (key: string) => void;
}

export function IssueRow({ issue, onClick }: IssueRowProps) {
  const { fields } = issue;

  return (
    <button
      type="button"
      onClick={() => onClick(issue.key)}
      className="w-full text-left px-4 py-3 border-b border-border hover:bg-accent/50 transition-colors flex items-center gap-3 group"
    >
      {/* Type icon */}
      {fields.issuetype.iconUrl && (
        <img
          src={fields.issuetype.iconUrl}
          alt={fields.issuetype.name}
          className="w-4 h-4 flex-shrink-0"
        />
      )}

      {/* Key */}
      <span className="text-xs font-mono text-muted-foreground w-24 flex-shrink-0">
        {issue.key}
      </span>

      {/* Summary */}
      <span className="flex-1 text-sm truncate group-hover:text-primary transition-colors">
        {fields.summary}
      </span>

      {/* Labels */}
      {fields.labels.length > 0 && (
        <div className="hidden lg:flex gap-1 flex-shrink-0">
          {fields.labels.slice(0, 2).map((label) => (
            <span
              key={label}
              className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
            >
              {label}
            </span>
          ))}
        </div>
      )}

      {/* Status */}
      <span
        className={`text-[11px] font-medium px-2 py-0.5 rounded-full flex-shrink-0 ${statusColor(fields.status.statusCategory.colorName)}`}
      >
        {fields.status.name}
      </span>

      {/* Priority */}
      {fields.priority && (
        <img
          src={fields.priority.iconUrl}
          alt={fields.priority.name}
          title={fields.priority.name}
          className="w-4 h-4 flex-shrink-0"
        />
      )}

      {/* Assignee avatar */}
      {fields.assignee ? (
        <img
          src={fields.assignee.avatarUrls["24x24"] || fields.assignee.avatarUrls["16x16"]}
          alt={fields.assignee.displayName}
          title={fields.assignee.displayName}
          className="w-5 h-5 rounded-full flex-shrink-0"
        />
      ) : (
        <div className="w-5 h-5 rounded-full bg-muted flex-shrink-0" title="Unassigned" />
      )}

      {/* Updated */}
      <span className="text-[11px] text-muted-foreground w-16 text-right flex-shrink-0">
        {timeAgo(fields.updated)}
      </span>
    </button>
  );
}
