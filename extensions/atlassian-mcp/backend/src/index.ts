import type { ExtensionRouterFactory } from "@renre-kit/extension-sdk";
import { Router } from "express";

function createJiraClient(config: Record<string, string>) {
  const baseUrl = config["atlassian_jira_url"]?.replace(/\/+$/, "");
  const email = config["atlassian_email"];
  const token = config["atlassian_api_token"];

  if (!baseUrl || !email || !token) return null;

  const auth = Buffer.from(`${email}:${token}`).toString("base64");

  return async (path: string, options?: RequestInit) => {
    const response = await fetch(`${baseUrl}/rest/api/3${path}`, {
      ...options,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(options?.headers as Record<string, string> | undefined),
      },
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Jira API ${response.status}: ${text}`);
    }
    return response.json();
  };
}

const factory: ExtensionRouterFactory = (context) => {
  const router = Router();
  const { mcp, logger, config } = context;

  // ---- MCP proxy routes (existing) ----

  // GET /tools — list Atlassian MCP tools
  router.get("/tools", async (_req, res) => {
    if (!mcp) {
      res.status(503).json({ error: "MCP not connected" });
      return;
    }
    try {
      const tools = await mcp.listTools();
      res.json({ tools });
    } catch (err) {
      logger.error("Failed to list MCP tools", { error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /call — invoke an Atlassian MCP tool
  router.post("/call", async (req, res) => {
    if (!mcp) {
      res.status(503).json({ error: "MCP not connected" });
      return;
    }
    const { tool, arguments: args } = req.body as {
      tool: string;
      arguments: Record<string, unknown>;
    };
    if (!tool) {
      res.status(400).json({ error: "Missing 'tool' in request body" });
      return;
    }
    try {
      const result = await mcp.callTool(tool, args ?? {});
      res.json({ result });
    } catch (err) {
      logger.error("Failed to call MCP tool", { tool, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /resources — list Atlassian MCP resources
  router.get("/resources", async (_req, res) => {
    if (!mcp) {
      res.status(503).json({ error: "MCP not connected" });
      return;
    }
    try {
      const resources = await mcp.listResources();
      res.json({ resources });
    } catch (err) {
      logger.error("Failed to list MCP resources", { error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /resource?uri=... — read a specific Atlassian MCP resource
  router.get("/resource", async (req, res) => {
    if (!mcp) {
      res.status(503).json({ error: "MCP not connected" });
      return;
    }
    const uri = req.query.uri as string;
    if (!uri) {
      res.status(400).json({ error: "Missing 'uri' query parameter" });
      return;
    }
    try {
      const data = await mcp.readResource(uri);
      res.json({ data });
    } catch (err) {
      logger.error("Failed to read MCP resource", { uri, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // ---- Jira REST API routes (for UI) ----

  const jira = createJiraClient(config);

  // GET /myself — current Jira user
  router.get("/myself", async (_req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    try {
      const user = await jira("/myself");
      res.json(user);
    } catch (err) {
      logger.error("Failed to get current user", { error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /issues?jql=...&startAt=0&maxResults=20
  router.get("/issues", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const jql = (req.query.jql as string) || "ORDER BY updated DESC";
    const startAt = parseInt((req.query.startAt as string) || "0", 10);
    const maxResults = Math.min(parseInt((req.query.maxResults as string) || "20", 10), 100);

    const fields = "summary,status,assignee,reporter,priority,issuetype,created,updated,labels";
    const params = new URLSearchParams({
      jql,
      startAt: String(startAt),
      maxResults: String(maxResults),
      fields,
    });

    try {
      const result = await jira(`/search?${params}`);
      res.json(result);
    } catch (err) {
      logger.error("Jira issue search failed", { jql, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /issues/:key — single issue with description
  router.get("/issues/:key", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { key } = req.params;
    const fields =
      "summary,status,assignee,reporter,priority,issuetype,created,updated,labels,description";

    try {
      const issue = await jira(`/issue/${encodeURIComponent(key)}?fields=${fields}`);
      res.json(issue);
    } catch (err) {
      logger.error("Failed to get issue", { key, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // GET /issues/:key/comments?startAt=0&maxResults=50
  router.get("/issues/:key/comments", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { key } = req.params;
    const startAt = parseInt((req.query.startAt as string) || "0", 10);
    const maxResults = Math.min(parseInt((req.query.maxResults as string) || "50", 10), 100);
    const params = new URLSearchParams({
      startAt: String(startAt),
      maxResults: String(maxResults),
    });

    try {
      const comments = await jira(
        `/issue/${encodeURIComponent(key)}/comment?${params}`,
      );
      res.json(comments);
    } catch (err) {
      logger.error("Failed to get comments", { key, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /issues/:key/comments — add a comment
  router.post("/issues/:key/comments", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { key } = req.params;
    const { body: commentText } = req.body as { body: string };
    if (!commentText) {
      res.status(400).json({ error: "Missing 'body' in request" });
      return;
    }

    // Convert plain text to Atlassian Document Format
    const adfBody = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: commentText }],
        },
      ],
    };

    try {
      const result = await jira(`/issue/${encodeURIComponent(key)}/comment`, {
        method: "POST",
        body: JSON.stringify({ body: adfBody }),
      });
      res.json(result);
    } catch (err) {
      logger.error("Failed to add comment", { key, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // ---- Chat tool routes (POST endpoints for copilot bridge) ----
  // The copilot bridge sends all tool args as JSON body on POST requests.
  // Path params can't be interpolated, so these routes accept everything in the body.

  // POST /chat/search-issues — search Jira issues by JQL
  router.post("/chat/search-issues", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { jql, maxResults } = req.body as { jql?: string; maxResults?: number };
    const query = jql || "ORDER BY updated DESC";
    const limit = Math.min(maxResults ?? 20, 100);

    const fields = "summary,status,assignee,reporter,priority,issuetype,created,updated,labels";
    const params = new URLSearchParams({
      jql: query,
      startAt: "0",
      maxResults: String(limit),
      fields,
    });

    try {
      const result = await jira(`/search?${params}`);
      res.json(result);
    } catch (err) {
      logger.error("Chat: Jira search failed", { jql: query, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /chat/get-issue — get a single Jira issue by key
  router.post("/chat/get-issue", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { issueKey } = req.body as { issueKey: string };
    if (!issueKey) {
      res.status(400).json({ error: "Missing 'issueKey' in request body" });
      return;
    }

    const fields =
      "summary,status,assignee,reporter,priority,issuetype,created,updated,labels,description,components,fixVersions";

    try {
      const issue = await jira(`/issue/${encodeURIComponent(issueKey)}?fields=${fields}`);
      res.json(issue);
    } catch (err) {
      logger.error("Chat: Failed to get issue", { issueKey, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /chat/get-issue-comments — get comments on a Jira issue
  router.post("/chat/get-issue-comments", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { issueKey, maxResults } = req.body as { issueKey: string; maxResults?: number };
    if (!issueKey) {
      res.status(400).json({ error: "Missing 'issueKey' in request body" });
      return;
    }
    const limit = Math.min(maxResults ?? 50, 100);
    const params = new URLSearchParams({ startAt: "0", maxResults: String(limit) });

    try {
      const comments = await jira(`/issue/${encodeURIComponent(issueKey)}/comment?${params}`);
      res.json(comments);
    } catch (err) {
      logger.error("Chat: Failed to get comments", { issueKey, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /chat/add-comment — add a comment to a Jira issue
  router.post("/chat/add-comment", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { issueKey, body: commentText } = req.body as { issueKey: string; body: string };
    if (!issueKey) {
      res.status(400).json({ error: "Missing 'issueKey' in request body" });
      return;
    }
    if (!commentText) {
      res.status(400).json({ error: "Missing 'body' in request body" });
      return;
    }

    const adfBody = {
      type: "doc",
      version: 1,
      content: [
        { type: "paragraph", content: [{ type: "text", text: commentText }] },
      ],
    };

    try {
      const result = await jira(`/issue/${encodeURIComponent(issueKey)}/comment`, {
        method: "POST",
        body: JSON.stringify({ body: adfBody }),
      });
      res.json(result);
    } catch (err) {
      logger.error("Chat: Failed to add comment", { issueKey, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /chat/create-issue — create a new Jira issue
  router.post("/chat/create-issue", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { projectKey, issueType, summary, description, priority, labels, assigneeAccountId } =
      req.body as {
        projectKey: string;
        issueType: string;
        summary: string;
        description?: string;
        priority?: string;
        labels?: string[];
        assigneeAccountId?: string;
      };

    if (!projectKey || !issueType || !summary) {
      res.status(400).json({ error: "Missing required fields: projectKey, issueType, summary" });
      return;
    }

    const issueData: Record<string, unknown> = {
      fields: {
        project: { key: projectKey },
        issuetype: { name: issueType },
        summary,
        ...(description && {
          description: {
            type: "doc",
            version: 1,
            content: [
              { type: "paragraph", content: [{ type: "text", text: description }] },
            ],
          },
        }),
        ...(priority && { priority: { name: priority } }),
        ...(labels && { labels }),
        ...(assigneeAccountId && { assignee: { accountId: assigneeAccountId } }),
      },
    };

    try {
      const result = await jira("/issue", {
        method: "POST",
        body: JSON.stringify(issueData),
      });
      res.json(result);
    } catch (err) {
      logger.error("Chat: Failed to create issue", { projectKey, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /chat/update-issue — update fields on an existing Jira issue
  router.post("/chat/update-issue", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { issueKey, summary, description, priority, labels, assigneeAccountId } =
      req.body as {
        issueKey: string;
        summary?: string;
        description?: string;
        priority?: string;
        labels?: string[];
        assigneeAccountId?: string;
      };

    if (!issueKey) {
      res.status(400).json({ error: "Missing 'issueKey' in request body" });
      return;
    }

    const fields: Record<string, unknown> = {};
    if (summary !== undefined) fields["summary"] = summary;
    if (description !== undefined) {
      fields["description"] = {
        type: "doc",
        version: 1,
        content: [
          { type: "paragraph", content: [{ type: "text", text: description }] },
        ],
      };
    }
    if (priority !== undefined) fields["priority"] = { name: priority };
    if (labels !== undefined) fields["labels"] = labels;
    if (assigneeAccountId !== undefined) fields["assignee"] = { accountId: assigneeAccountId };

    if (Object.keys(fields).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    try {
      await jira(`/issue/${encodeURIComponent(issueKey)}`, {
        method: "PUT",
        body: JSON.stringify({ fields }),
      });
      // Jira PUT returns 204 on success — fetch the updated issue
      const updated = await jira(
        `/issue/${encodeURIComponent(issueKey)}?fields=summary,status,assignee,priority,labels,description`,
      );
      res.json(updated);
    } catch (err) {
      logger.error("Chat: Failed to update issue", { issueKey, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /chat/transition-issue — change a Jira issue's status
  router.post("/chat/transition-issue", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { issueKey, transitionName } = req.body as { issueKey: string; transitionName: string };
    if (!issueKey || !transitionName) {
      res.status(400).json({ error: "Missing required fields: issueKey, transitionName" });
      return;
    }

    try {
      // First, list available transitions to find the matching one
      const { transitions } = (await jira(
        `/issue/${encodeURIComponent(issueKey)}/transitions`,
      )) as { transitions: { id: string; name: string }[] };

      const match = transitions.find(
        (t) => t.name.toLowerCase() === transitionName.toLowerCase(),
      );
      if (!match) {
        const available = transitions.map((t) => t.name).join(", ");
        res.status(400).json({
          error: `Transition "${transitionName}" not found. Available: ${available}`,
        });
        return;
      }

      await jira(`/issue/${encodeURIComponent(issueKey)}/transitions`, {
        method: "POST",
        body: JSON.stringify({ transition: { id: match.id } }),
      });

      // Fetch updated issue to confirm
      const updated = await jira(
        `/issue/${encodeURIComponent(issueKey)}?fields=summary,status`,
      );
      res.json(updated);
    } catch (err) {
      logger.error("Chat: Failed to transition issue", { issueKey, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /chat/assign-issue — assign a Jira issue to a user
  router.post("/chat/assign-issue", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { issueKey, accountId } = req.body as { issueKey: string; accountId?: string };
    if (!issueKey) {
      res.status(400).json({ error: "Missing 'issueKey' in request body" });
      return;
    }

    try {
      await jira(`/issue/${encodeURIComponent(issueKey)}/assignee`, {
        method: "PUT",
        body: JSON.stringify({ accountId: accountId ?? null }),
      });
      res.json({ success: true, issueKey, assignedTo: accountId ?? null });
    } catch (err) {
      logger.error("Chat: Failed to assign issue", { issueKey, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /chat/search-users — search for Jira users by query string
  router.post("/chat/search-users", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { query, maxResults } = req.body as { query: string; maxResults?: number };
    if (!query) {
      res.status(400).json({ error: "Missing 'query' in request body" });
      return;
    }
    const limit = Math.min(maxResults ?? 10, 50);
    const params = new URLSearchParams({ query, maxResults: String(limit) });

    try {
      const users = await jira(`/user/search?${params}`);
      res.json({ users });
    } catch (err) {
      logger.error("Chat: Failed to search users", { query, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // POST /chat/get-transitions — list available transitions for an issue
  router.post("/chat/get-transitions", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { issueKey } = req.body as { issueKey: string };
    if (!issueKey) {
      res.status(400).json({ error: "Missing 'issueKey' in request body" });
      return;
    }

    try {
      const result = await jira(`/issue/${encodeURIComponent(issueKey)}/transitions`);
      res.json(result);
    } catch (err) {
      logger.error("Chat: Failed to get transitions", { issueKey, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
};

export default factory;
