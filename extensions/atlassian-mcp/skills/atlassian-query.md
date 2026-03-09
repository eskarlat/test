# Atlassian Query

## Description
Query Jira issues, Confluence pages, spaces, and other Atlassian resources through the RenRe Kit Atlassian MCP bridge. Connects to your Atlassian Cloud instance via API token stored in the vault.

## Instructions

You have access to Atlassian Jira and Confluence data through `renre-kit query atlassian-mcp`. The extension bridges to the `mcp-atlassian` MCP server using credentials stored in the RenRe Kit vault.

### Setup

Before using this skill, ensure the following vault keys are configured via the Console UI or CLI:
- `atlassian_jira_url` — Your Jira site URL (e.g. `https://yoursite.atlassian.net`)
- `atlassian_confluence_url` — Your Confluence URL (e.g. `https://yoursite.atlassian.net/wiki`)
- `atlassian_email` — Your Atlassian account email
- `atlassian_api_token` — API token from https://id.atlassian.net/manage-profile/security/api-tokens

### Discovering available tools

```bash
renre-kit query atlassian-mcp mcp/tools --json
```

This returns the full list of MCP tools. Common tools include:

**Jira tools:**
- `jira_get_issue` — Get a Jira issue by key (e.g. PROJ-123)
- `jira_search` — Search issues with JQL
- `jira_create_issue` — Create a new Jira issue
- `jira_update_issue` — Update an existing issue
- `jira_get_transitions` — Get available status transitions for an issue
- `jira_transition_issue` — Transition an issue to a new status
- `jira_add_comment` — Add a comment to an issue
- `jira_get_projects` — List all accessible projects
- `jira_get_board_issues` — Get issues from a board

**Confluence tools:**
- `confluence_search` — Search Confluence content with CQL
- `confluence_get_page` — Get a page by ID
- `confluence_create_page` — Create a new page
- `confluence_update_page` — Update an existing page
- `confluence_get_spaces` — List all accessible spaces
- `confluence_get_page_children` — Get child pages

### Calling a tool

```bash
renre-kit query atlassian-mcp mcp/call -d '{"tool": "<tool_name>", "arguments": { ... }}'
```

### Common Jira queries

**Get a specific issue:**
```bash
renre-kit query atlassian-mcp mcp/call -d '{"tool": "jira_get_issue", "arguments": {"issue_key": "PROJ-123"}}'
```

**Search issues with JQL:**
```bash
renre-kit query atlassian-mcp mcp/call -d '{"tool": "jira_search", "arguments": {"jql": "project = PROJ AND status = \"In Progress\" ORDER BY updated DESC"}}'
```

**Find issues assigned to me:**
```bash
renre-kit query atlassian-mcp mcp/call -d '{"tool": "jira_search", "arguments": {"jql": "assignee = currentUser() AND resolution = Unresolved ORDER BY priority DESC"}}'
```

**Search for bugs in a project:**
```bash
renre-kit query atlassian-mcp mcp/call -d '{"tool": "jira_search", "arguments": {"jql": "project = PROJ AND type = Bug AND status != Done"}}'
```

**Create a new issue:**
```bash
renre-kit query atlassian-mcp mcp/call -d '{"tool": "jira_create_issue", "arguments": {"project_key": "PROJ", "summary": "Fix login bug", "issue_type": "Bug", "description": "Users cannot log in when..."}}'
```

**Add a comment to an issue:**
```bash
renre-kit query atlassian-mcp mcp/call -d '{"tool": "jira_add_comment", "arguments": {"issue_key": "PROJ-123", "body": "Fixed in commit abc123."}}'
```

**Transition an issue (e.g. move to Done):**
```bash
# First, get available transitions
renre-kit query atlassian-mcp mcp/call -d '{"tool": "jira_get_transitions", "arguments": {"issue_key": "PROJ-123"}}'

# Then transition using the transition ID
renre-kit query atlassian-mcp mcp/call -d '{"tool": "jira_transition_issue", "arguments": {"issue_key": "PROJ-123", "transition_id": "31"}}'
```

### Common Confluence queries

**Search pages by text:**
```bash
renre-kit query atlassian-mcp mcp/call -d '{"tool": "confluence_search", "arguments": {"cql": "type = page AND text ~ \"deployment guide\""}}'
```

**Get a page by ID:**
```bash
renre-kit query atlassian-mcp mcp/call -d '{"tool": "confluence_get_page", "arguments": {"page_id": "12345678"}}'
```

**List spaces:**
```bash
renre-kit query atlassian-mcp mcp/call -d '{"tool": "confluence_get_spaces", "arguments": {}}'
```

**Search within a specific space:**
```bash
renre-kit query atlassian-mcp mcp/call -d '{"tool": "confluence_search", "arguments": {"cql": "space = \"DEV\" AND type = page AND title ~ \"API\""}}'
```

**Create a new page:**
```bash
renre-kit query atlassian-mcp mcp/call -d '{"tool": "confluence_create_page", "arguments": {"space_key": "DEV", "title": "New API Docs", "body": "<p>API documentation content...</p>"}}'
```

### List MCP resources

```bash
renre-kit query atlassian-mcp mcp/resources --json
```

### Read a specific resource

```bash
renre-kit query atlassian-mcp mcp/resource --uri "atlassian://jira/issue/PROJ-123"
```

### JQL quick reference

JQL (Jira Query Language) is used with `jira_search`:

| Clause | Example |
|---|---|
| Project | `project = PROJ` |
| Status | `status = "In Progress"` |
| Assignee | `assignee = currentUser()` |
| Reporter | `reporter = "user@example.com"` |
| Type | `type = Bug` |
| Priority | `priority = High` |
| Label | `labels = backend` |
| Sprint | `sprint in openSprints()` |
| Created | `created >= -7d` (last 7 days) |
| Updated | `updated >= startOfWeek()` |
| Text search | `text ~ "login error"` |
| Combining | `project = PROJ AND status != Done ORDER BY priority DESC` |

### CQL quick reference

CQL (Confluence Query Language) is used with `confluence_search`:

| Clause | Example |
|---|---|
| Space | `space = "DEV"` |
| Type | `type = page` or `type = blogpost` |
| Title | `title = "API Docs"` |
| Text | `text ~ "deployment"` |
| Label | `label = "architecture"` |
| Ancestor | `ancestor = 12345678` (pages under a parent) |
| Creator | `creator = "user@example.com"` |
| Created | `created >= "2025-01-01"` |
| Combining | `space = "DEV" AND type = page AND label = "api"` |

### Tips

1. **Start with search.** Use JQL/CQL to find items before fetching full details.
2. **Use issue keys** (e.g. PROJ-123) for direct access — faster than searching.
3. **Paginate large results.** Both `jira_search` and `confluence_search` support `limit` and `start` arguments.
4. **Transition workflows.** Always call `jira_get_transitions` first to discover valid transition IDs for the current issue status.
5. **Confluence page IDs** can be found in the page URL: `https://yoursite.atlassian.net/wiki/spaces/SPACE/pages/12345678/Page+Title` — the numeric segment is the page ID.
6. **All credentials are stored in the vault** — never hardcode tokens or URLs in queries.
