// Jira REST API v3 response types

export interface JiraUser {
  accountId: string;
  displayName: string;
  emailAddress?: string;
  avatarUrls: Record<string, string>;
  active: boolean;
}

export interface JiraStatusCategory {
  id: number;
  key: string;
  colorName: string;
  name: string;
}

export interface JiraStatus {
  name: string;
  statusCategory: JiraStatusCategory;
}

export interface JiraPriority {
  name: string;
  iconUrl: string;
  id: string;
}

export interface JiraIssueType {
  name: string;
  iconUrl: string;
  subtask: boolean;
}

export interface JiraIssueFields {
  summary: string;
  status: JiraStatus;
  assignee: JiraUser | null;
  reporter: JiraUser | null;
  priority: JiraPriority | null;
  issuetype: JiraIssueType;
  created: string;
  updated: string;
  description: unknown | null;
  labels: string[];
  comment?: {
    comments: JiraComment[];
    total: number;
  };
}

export interface JiraIssue {
  id: string;
  key: string;
  self: string;
  fields: JiraIssueFields;
}

export interface JiraSearchResult {
  startAt: number;
  maxResults: number;
  total: number;
  issues: JiraIssue[];
}

export interface JiraComment {
  id: string;
  author: JiraUser;
  body: unknown;
  created: string;
  updated: string;
}

export interface JiraCommentsResult {
  startAt: number;
  maxResults: number;
  total: number;
  comments: JiraComment[];
}
