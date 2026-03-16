// backend/src/index.ts
import { Router } from "express";
function createJiraClient(config) {
  // eslint-disable-next-line sonarjs/slow-regex
  const baseUrl = config["atlassian_jira_url"]?.replace(/\/+$/, "");
  const email = config["atlassian_email"];
  const token = config["atlassian_api_token"];
  if (!baseUrl || !email || !token) return null;
  const auth = Buffer.from(`${email}:${token}`).toString("base64");
  return async (path, options) => {
    const response = await fetch(`${baseUrl}/rest/api/3${path}`, {
      ...options,
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...options?.headers
      }
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Jira API ${response.status}: ${text}`);
    }
    return response.json();
  };
}
var factory = (context) => {
  const router = Router();
  const { mcp, logger, config } = context;
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
  router.post("/call", async (req, res) => {
    if (!mcp) {
      res.status(503).json({ error: "MCP not connected" });
      return;
    }
    const { tool, arguments: args } = req.body;
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
  router.get("/resource", async (req, res) => {
    if (!mcp) {
      res.status(503).json({ error: "MCP not connected" });
      return;
    }
    const uri = req.query.uri;
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
  const jira = createJiraClient(config);
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
  router.get("/issues", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const jql = req.query.jql || "ORDER BY updated DESC";
    const startAt = parseInt(req.query.startAt || "0", 10);
    const maxResults = Math.min(parseInt(req.query.maxResults || "20", 10), 100);
    const fields = "summary,status,assignee,reporter,priority,issuetype,created,updated,labels";
    const params = new URLSearchParams({
      jql,
      startAt: String(startAt),
      maxResults: String(maxResults),
      fields
    });
    try {
      const result = await jira(`/search?${params}`);
      res.json(result);
    } catch (err) {
      logger.error("Jira issue search failed", { jql, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });
  router.get("/issues/:key", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { key } = req.params;
    const fields = "summary,status,assignee,reporter,priority,issuetype,created,updated,labels,description";
    try {
      const issue = await jira(`/issue/${encodeURIComponent(key)}?fields=${fields}`);
      res.json(issue);
    } catch (err) {
      logger.error("Failed to get issue", { key, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });
  router.get("/issues/:key/comments", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { key } = req.params;
    const startAt = parseInt(req.query.startAt || "0", 10);
    const maxResults = Math.min(parseInt(req.query.maxResults || "50", 10), 100);
    const params = new URLSearchParams({
      startAt: String(startAt),
      maxResults: String(maxResults)
    });
    try {
      const comments = await jira(
        `/issue/${encodeURIComponent(key)}/comment?${params}`
      );
      res.json(comments);
    } catch (err) {
      logger.error("Failed to get comments", { key, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });
  router.post("/issues/:key/comments", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { key } = req.params;
    const { body: commentText } = req.body;
    if (!commentText) {
      res.status(400).json({ error: "Missing 'body' in request" });
      return;
    }
    const adfBody = {
      type: "doc",
      version: 1,
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: commentText }]
        }
      ]
    };
    try {
      const result = await jira(`/issue/${encodeURIComponent(key)}/comment`, {
        method: "POST",
        body: JSON.stringify({ body: adfBody })
      });
      res.json(result);
    } catch (err) {
      logger.error("Failed to add comment", { key, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });
  router.post("/chat/search-issues", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { jql, maxResults } = req.body;
    const query = jql || "ORDER BY updated DESC";
    const limit = Math.min(maxResults ?? 20, 100);
    const fields = "summary,status,assignee,reporter,priority,issuetype,created,updated,labels";
    const params = new URLSearchParams({
      jql: query,
      startAt: "0",
      maxResults: String(limit),
      fields
    });
    try {
      const result = await jira(`/search?${params}`);
      res.json(result);
    } catch (err) {
      logger.error("Chat: Jira search failed", { jql: query, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });
  router.post("/chat/get-issue", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { issueKey } = req.body;
    if (!issueKey) {
      res.status(400).json({ error: "Missing 'issueKey' in request body" });
      return;
    }
    const fields = "summary,status,assignee,reporter,priority,issuetype,created,updated,labels,description,components,fixVersions";
    try {
      const issue = await jira(`/issue/${encodeURIComponent(issueKey)}?fields=${fields}`);
      res.json(issue);
    } catch (err) {
      logger.error("Chat: Failed to get issue", { issueKey, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });
  router.post("/chat/get-issue-comments", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { issueKey, maxResults } = req.body;
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
  router.post("/chat/add-comment", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { issueKey, body: commentText } = req.body;
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
        { type: "paragraph", content: [{ type: "text", text: commentText }] }
      ]
    };
    try {
      const result = await jira(`/issue/${encodeURIComponent(issueKey)}/comment`, {
        method: "POST",
        body: JSON.stringify({ body: adfBody })
      });
      res.json(result);
    } catch (err) {
      logger.error("Chat: Failed to add comment", { issueKey, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });
  router.post("/chat/create-issue", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { projectKey, issueType, summary, description, priority, labels, assigneeAccountId } = req.body;
    if (!projectKey || !issueType || !summary) {
      res.status(400).json({ error: "Missing required fields: projectKey, issueType, summary" });
      return;
    }
    const issueData = {
      fields: {
        project: { key: projectKey },
        issuetype: { name: issueType },
        summary,
        ...description && {
          description: {
            type: "doc",
            version: 1,
            content: [
              { type: "paragraph", content: [{ type: "text", text: description }] }
            ]
          }
        },
        ...priority && { priority: { name: priority } },
        ...labels && { labels },
        ...assigneeAccountId && { assignee: { accountId: assigneeAccountId } }
      }
    };
    try {
      const result = await jira("/issue", {
        method: "POST",
        body: JSON.stringify(issueData)
      });
      res.json(result);
    } catch (err) {
      logger.error("Chat: Failed to create issue", { projectKey, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });
  router.post("/chat/update-issue", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { issueKey, summary, description, priority, labels, assigneeAccountId } = req.body;
    if (!issueKey) {
      res.status(400).json({ error: "Missing 'issueKey' in request body" });
      return;
    }
    const fields = {};
    if (summary !== void 0) fields["summary"] = summary;
    if (description !== void 0) {
      fields["description"] = {
        type: "doc",
        version: 1,
        content: [
          { type: "paragraph", content: [{ type: "text", text: description }] }
        ]
      };
    }
    if (priority !== void 0) fields["priority"] = { name: priority };
    if (labels !== void 0) fields["labels"] = labels;
    if (assigneeAccountId !== void 0) fields["assignee"] = { accountId: assigneeAccountId };
    if (Object.keys(fields).length === 0) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }
    try {
      await jira(`/issue/${encodeURIComponent(issueKey)}`, {
        method: "PUT",
        body: JSON.stringify({ fields })
      });
      const updated = await jira(
        `/issue/${encodeURIComponent(issueKey)}?fields=summary,status,assignee,priority,labels,description`
      );
      res.json(updated);
    } catch (err) {
      logger.error("Chat: Failed to update issue", { issueKey, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });
  router.post("/chat/transition-issue", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { issueKey, transitionName } = req.body;
    if (!issueKey || !transitionName) {
      res.status(400).json({ error: "Missing required fields: issueKey, transitionName" });
      return;
    }
    try {
      const { transitions } = await jira(
        `/issue/${encodeURIComponent(issueKey)}/transitions`
      );
      const match = transitions.find(
        (t) => t.name.toLowerCase() === transitionName.toLowerCase()
      );
      if (!match) {
        const available = transitions.map((t) => t.name).join(", ");
        res.status(400).json({
          error: `Transition "${transitionName}" not found. Available: ${available}`
        });
        return;
      }
      await jira(`/issue/${encodeURIComponent(issueKey)}/transitions`, {
        method: "POST",
        body: JSON.stringify({ transition: { id: match.id } })
      });
      const updated = await jira(
        `/issue/${encodeURIComponent(issueKey)}?fields=summary,status`
      );
      res.json(updated);
    } catch (err) {
      logger.error("Chat: Failed to transition issue", { issueKey, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });
  router.post("/chat/assign-issue", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { issueKey, accountId } = req.body;
    if (!issueKey) {
      res.status(400).json({ error: "Missing 'issueKey' in request body" });
      return;
    }
    try {
      await jira(`/issue/${encodeURIComponent(issueKey)}/assignee`, {
        method: "PUT",
        body: JSON.stringify({ accountId: accountId ?? null })
      });
      res.json({ success: true, issueKey, assignedTo: accountId ?? null });
    } catch (err) {
      logger.error("Chat: Failed to assign issue", { issueKey, error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });
  router.post("/chat/search-users", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { query, maxResults } = req.body;
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
  router.post("/chat/get-transitions", async (req, res) => {
    if (!jira) {
      res.status(503).json({ error: "Jira credentials not configured" });
      return;
    }
    const { issueKey } = req.body;
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
var src_default = factory;
export {
  src_default as default
};
//# sourceMappingURL=index.js.map