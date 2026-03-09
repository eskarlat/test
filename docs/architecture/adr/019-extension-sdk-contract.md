# ADR-019: Extension SDK Contract

## Status
Accepted

## Context
Extension authors need a well-defined contract specifying what their extension must export, how the backend router factory works, and what the UI module interface looks like. The `@renre-kit/extension-sdk` package provides types and helpers.

## Decision

### Package: `@renre-kit/extension-sdk`
Lives in the monorepo at `packages/extension-sdk/`. Built-in and first-party extensions reference it as a workspace dependency. Future: published to npm for third-party authors.

**Monorepo (built-in extensions):**
```json
{
  "devDependencies": {
    "@renre-kit/extension-sdk": "workspace:*"
  }
}
```

**Third-party (before npm publish):**
```bash
# Via git reference
npm install --save-dev "github:x/renre-kit#main&path=packages/extension-sdk"
```

### Backend Contract

Every extension backend must export a default function that receives an `ExtensionContext` and returns an Express Router:

```typescript
// @renre-kit/extension-sdk — backend types

import { Router, Request, Response } from "express";
import { Database } from "better-sqlite3";

export interface ScopedDatabase {
  /**
   * Scoped query interface — restricts extensions to their own prefixed tables
   * and automatically injects project_id filtering.
   * Extensions NEVER receive the raw better-sqlite3 Database handle.
   */
  prepare(sql: string): ScopedStatement;
  exec(sql: string): void;
  /** The table prefix assigned to this extension (e.g., "ext_jira_") */
  readonly tablePrefix: string;
}

export interface ScopedStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}

export interface ExtensionContext {
  projectId: string;
  db: ScopedDatabase | null;    // null if extension has no `database` permission — scoped proxy, not raw handle
  logger: ExtensionLogger;
  config: Record<string, string>; // resolved settings (Vault refs already replaced)
  mcp: MCPClient | null;        // null if extension has no `mcp` config
}

export interface ExtensionLogger {
  error(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  debug(message: string, meta?: Record<string, unknown>): void;
}

export interface MCPClient {
  listTools(): Promise<MCPTool[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
  listResources(): Promise<MCPResource[]>;
  readResource(uri: string): Promise<unknown>;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface MCPResource {
  uri: string;
  name: string;
  mimeType?: string;
}

// Extension backend entry point — what the extension must export
export type ExtensionRouterFactory = (context: ExtensionContext) => Router;
```

#### ScopedDatabase Enforcement Rules

The `ScopedDatabase` proxy enforces the following at runtime:

1. **Table prefix enforcement:** All table references in SQL must use the extension's assigned prefix (e.g., `ext_jira_`). Queries referencing tables without this prefix are rejected with an error. Core tables (`_migrations`, `_vault`, `_sessions`, etc.) are never accessible.
2. **Automatic project_id injection:** `SELECT`, `UPDATE`, and `DELETE` queries automatically have `AND project_id = ?` appended to `WHERE` clauses. `INSERT` queries must include a `project_id` column — the proxy validates this.
3. **DDL restriction:** Only `CREATE TABLE`, `CREATE INDEX`, and `ALTER TABLE ADD COLUMN` are permitted. `DROP TABLE`, `DROP INDEX`, and destructive DDL are blocked (extensions use migration `down.sql` files for cleanup on uninstall).
4. **Read-only mode:** Extensions without `database` permission receive `null`. Extensions with `database: "readonly"` (future) receive a proxy that blocks `INSERT`, `UPDATE`, `DELETE`, and DDL.

**Example backend (`backend/index.ts`):**
```typescript
import { ExtensionRouterFactory } from "@renre-kit/extension-sdk";
import { Router } from "express";

const factory: ExtensionRouterFactory = (ctx) => {
  const router = Router();

  // Tables are auto-prefixed: "issues" → "ext_jira_issues"
  // project_id filtering is automatic
  router.get("/issues", (req, res) => {
    const issues = ctx.db!.prepare(
      "SELECT * FROM issues"
    ).all();
    res.json({ issues });
  });

  router.post("/add", (req, res) => {
    const { title } = req.body;
    ctx.db!.prepare(
      "INSERT INTO issues (project_id, title) VALUES (?, ?)"
    ).run(ctx.projectId, title);
    ctx.logger.info(`Created issue: ${title}`);
    res.json({ success: true });
  });

  return router;
};

export default factory;
```

### UI Contract

Extension UI modules export a map of page components. The Console shell dynamically imports this module and renders pages based on sidebar navigation.

```typescript
// @renre-kit/extension-sdk — UI types

import { ComponentType } from "react";

export interface ExtensionPageProps {
  projectId: string;
  extensionName: string;
  apiBaseUrl: string;          // e.g. "http://localhost:42888/api/{project-id}/{ext-name}"
}

// What the extension UI bundle must export
export interface ExtensionModule {
  pages: Record<string, ComponentType<ExtensionPageProps>>;
}
```

**Example UI (`ui/src/index.tsx`):**
```tsx
import { ExtensionModule, ExtensionPageProps } from "@renre-kit/extension-sdk";
import { useState, useEffect } from "react";

function IssuesPage({ apiBaseUrl }: ExtensionPageProps) {
  const [issues, setIssues] = useState([]);

  useEffect(() => {
    fetch(`${apiBaseUrl}/issues`)
      .then((r) => r.json())
      .then((data) => setIssues(data.issues));
  }, [apiBaseUrl]);

  return (
    <div>
      <h1>Jira Issues</h1>
      <ul>
        {issues.map((i: any) => (
          <li key={i.id}>{i.title}</li>
        ))}
      </ul>
    </div>
  );
}

function SessionsPage({ apiBaseUrl }: ExtensionPageProps) {
  return <div>Sessions page content</div>;
}

const module: ExtensionModule = {
  pages: {
    issues: IssuesPage,
    sessions: SessionsPage,
  },
};

export default module;
```

### UI Build Requirements
Extension UI must be pre-built as a single JS bundle with React externalized:

**Vite config (provided by SDK template):**
```typescript
// vite.config.ts
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: "src/index.tsx",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: ["react", "react-dom"],  // provided by Console shell
    },
  },
});
```

The Console shell provides React and ReactDOM globally. Extensions must NOT bundle their own React.

### Shared UI Components (Future)
`@renre-kit/extension-sdk` will export common UI components:
- Layout primitives (Card, Stack, Grid)
- Form controls (Input, Select, Toggle, Button)
- Data display (Table, Badge, EmptyState)
- Feedback (Toast, Loading, ErrorBoundary)

v1 ships types only. Shared components added incrementally.

### Manifest Validation on Install (ADR-020 reference)
When `marketplace add` downloads an extension, the CLI validates:
- `manifest.json` exists and is valid JSON
- Required fields present (name, version, displayName, description, author)
- If `backend` declared → `backend/index.js` exists
- If `ui` declared → `ui/index.js` exists and pages match manifest
- If `migrations` declared → directory exists with valid naming (`NNN_desc.up.sql` + `NNN_desc.down.sql` pairs)
- If `permissions` declared → all fields are known permission types
- If `settings.schema` declared → all fields have valid types

Validation failure → install aborted with specific error message.

## Consequences

### Positive
- Clear contract — extension authors know exactly what to export
- TypeScript types catch errors at build time
- UI externalization keeps extension bundles small
- Manifest validation catches broken extensions before they affect the system
- Example code in SDK serves as documentation

### Negative
- Extension authors must use TypeScript (or at least follow the JS shape)
- React is the only supported UI framework
- Externalized React means extensions must match the Console's React version

### Mitigations
- SDK includes `create-extension` CLI scaffolding tool (future)
- React version pinned in SDK peer dependency — clear compatibility
- JS extensions work fine as long as they export the right shape (types are optional)
