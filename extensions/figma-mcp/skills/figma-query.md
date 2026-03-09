# Figma Query

## Description
Query Figma design files, components, styles, and variables through the RenRe Kit Figma MCP bridge. Connects to the local Figma Desktop MCP server — no authentication required.

## Instructions

You have access to Figma design data through `renre-kit query figma-mcp`. The extension bridges to Figma Desktop's local MCP server (default `localhost:3845`).

### Discovering available tools

```bash
renre-kit query figma-mcp mcp/tools --json
```

This returns the full list of MCP tools exposed by the Figma server. Common tools include:
- `get_file` — Fetch a full Figma file by key
- `get_file_nodes` — Fetch specific nodes from a file
- `get_file_components` — List published components in a file
- `get_file_styles` — List published styles in a file
- `get_file_variables` — List variables and variable collections
- `get_comments` — Fetch comments on a file
- `get_team_components` — List components across a team
- `get_team_styles` — List styles across a team

### Calling a tool

```bash
renre-kit query figma-mcp mcp/call -d '{"tool": "<tool_name>", "arguments": { ... }}'
```

### Common queries

**Get a Figma file by key:**
```bash
renre-kit query figma-mcp mcp/call -d '{"tool": "get_file", "arguments": {"fileKey": "FILE_KEY"}}'
```

**Get specific nodes (components, frames, pages):**
```bash
renre-kit query figma-mcp mcp/call -d '{"tool": "get_file_nodes", "arguments": {"fileKey": "FILE_KEY", "ids": ["NODE_ID_1", "NODE_ID_2"]}}'
```

**List published components:**
```bash
renre-kit query figma-mcp mcp/call -d '{"tool": "get_file_components", "arguments": {"fileKey": "FILE_KEY"}}'
```

**List styles (colors, typography, effects):**
```bash
renre-kit query figma-mcp mcp/call -d '{"tool": "get_file_styles", "arguments": {"fileKey": "FILE_KEY"}}'
```

**List variables and collections:**
```bash
renre-kit query figma-mcp mcp/call -d '{"tool": "get_file_variables", "arguments": {"fileKey": "FILE_KEY"}}'
```

**List MCP resources:**
```bash
renre-kit query figma-mcp mcp/resources --json
```

**Read a specific resource by URI:**
```bash
renre-kit query figma-mcp mcp/resource --uri "figma://file/FILE_KEY"
```

### Extracting the file key

A Figma file URL looks like: `https://www.figma.com/design/ABC123/My-File`
The file key is the segment after `/design/` — in this case `ABC123`.

Node IDs appear in the URL as `?node-id=1234:5678` and are passed as `"1234:5678"`.

### Working with results

- File responses contain a deeply nested `document` tree. Navigate it by `document.children` (pages) → each page's `children` (frames, components, etc.).
- Component responses include `key`, `name`, `description`, and `containing_frame`.
- Style responses include `key`, `name`, `style_type` (FILL, TEXT, EFFECT, GRID), and `description`.
- Variable responses include `id`, `name`, `resolvedType` (COLOR, FLOAT, STRING, BOOLEAN), and values per mode.

### Prerequisites

Figma Desktop must be running with Dev Mode MCP server enabled. The MCP server listens on `localhost:3845` by default. No API token is needed for local access.

### Tips

1. **Start broad, then narrow.** List components/styles first, then fetch specific nodes by ID.
2. **Use node IDs** from `get_file_components` to fetch detailed node data with `get_file_nodes` — avoids loading the entire file.
3. **File keys are stable** across renames. Bookmark them for repeated queries.
4. **Large files**: Prefer `get_file_nodes` with specific IDs over `get_file` to avoid massive payloads.
