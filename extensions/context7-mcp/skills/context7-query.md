# Context7 Query

## Description

Look up real-time, version-specific documentation for any library or framework through the RenRe Kit Context7 MCP bridge. Context7 pulls official docs on demand so you always get accurate, up-to-date API references — no hallucinated methods or outdated signatures.

## Instructions

You have access to library documentation through `renre-kit query context7-mcp`. The extension bridges to the `@upstash/context7-mcp` server which provides two tools.

### Discovering available tools

```bash
renre-kit query context7-mcp mcp/tools --json
```

Available tools:

- `resolve-library-id` — Search for a library by name and get its Context7-compatible ID
- `get-library-docs` — Fetch documentation for a library using its Context7 ID

### Step 1: Resolve the library ID

Before fetching docs, you must resolve the library name to a Context7 ID:

```bash
renre-kit query context7-mcp mcp/call -d '{"tool": "resolve-library-id", "arguments": {"libraryName": "react"}}'
```

This returns a list of matching libraries with their Context7 IDs. Pick the one that matches your intent (e.g. `/facebook/react` for the core React library).

**Examples:**

```bash
# Find Next.js
renre-kit query context7-mcp mcp/call -d '{"tool": "resolve-library-id", "arguments": {"libraryName": "nextjs"}}'

# Find Express
renre-kit query context7-mcp mcp/call -d '{"tool": "resolve-library-id", "arguments": {"libraryName": "express"}}'

# Find Tailwind CSS
renre-kit query context7-mcp mcp/call -d '{"tool": "resolve-library-id", "arguments": {"libraryName": "tailwindcss"}}'

# Find Prisma
renre-kit query context7-mcp mcp/call -d '{"tool": "resolve-library-id", "arguments": {"libraryName": "prisma"}}'
```

### Step 2: Fetch documentation

Use the resolved Context7 ID to fetch docs. You can optionally filter by topic:

```bash
renre-kit query context7-mcp mcp/call -d '{"tool": "get-library-docs", "arguments": {"context7CompatibleLibraryID": "/vercel/next.js", "topic": "app router"}}'
```

**Examples:**

```bash
# React hooks documentation
renre-kit query context7-mcp mcp/call -d '{"tool": "get-library-docs", "arguments": {"context7CompatibleLibraryID": "/facebook/react", "topic": "hooks"}}'

# Express routing
renre-kit query context7-mcp mcp/call -d '{"tool": "get-library-docs", "arguments": {"context7CompatibleLibraryID": "/expressjs/express", "topic": "routing"}}'

# Tailwind CSS flexbox utilities
renre-kit query context7-mcp mcp/call -d '{"tool": "get-library-docs", "arguments": {"context7CompatibleLibraryID": "/tailwindlabs/tailwindcss", "topic": "flexbox"}}'

# Prisma client queries
renre-kit query context7-mcp mcp/call -d '{"tool": "get-library-docs", "arguments": {"context7CompatibleLibraryID": "/prisma/prisma", "topic": "client queries"}}'

# Get general docs (no topic filter)
renre-kit query context7-mcp mcp/call -d '{"tool": "get-library-docs", "arguments": {"context7CompatibleLibraryID": "/facebook/react"}}'
```

### Common workflow

The typical two-step workflow:

1. **Resolve** the library name to get the Context7 ID
2. **Fetch** docs using that ID, optionally narrowing by topic

```bash
# Step 1: What's the ID for zustand?
renre-kit query context7-mcp mcp/call -d '{"tool": "resolve-library-id", "arguments": {"libraryName": "zustand"}}'
# Returns: /pmndrs/zustand

# Step 2: Get docs about middleware
renre-kit query context7-mcp mcp/call -d '{"tool": "get-library-docs", "arguments": {"context7CompatibleLibraryID": "/pmndrs/zustand", "topic": "middleware"}}'
```

### Tips

1. **Always resolve first.** Library IDs look like GitHub paths (`/org/repo`) but may differ from what you expect. Always call `resolve-library-id` first.
2. **Use the `topic` parameter** to narrow results. Without it, you get general overview docs which may be lengthy.
3. **No credentials needed.** Context7 is a free public service — no API keys or vault configuration required.
4. **Docs are always fresh.** Context7 pulls from official sources so you get current API references, not training-data snapshots.
5. **Use for unfamiliar APIs.** Before writing code with a library you're unsure about, fetch its docs to avoid hallucinating methods or parameters.
6. **Combine with other skills.** Use Context7 to look up the correct API, then use other skills (e.g. `atlassian-query`) to integrate with your workflow.
