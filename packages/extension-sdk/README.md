# @renre-kit/extension-sdk

TypeScript types and utilities for building RenRe Kit extensions.

## Installation

**Monorepo extensions (workspace reference):**
```json
{
  "devDependencies": {
    "@renre-kit/extension-sdk": "workspace:*"
  }
}
```

**Third-party extensions (before npm publish):**
```bash
npm install --save-dev "github:x/renre-kit#main&path=packages/extension-sdk"
```

## Quick Start

### 1. Backend Contract

Every extension backend must export a default `ExtensionRouterFactory` function:

```typescript
// backend/index.ts
import type { ExtensionRouterFactory } from "@renre-kit/extension-sdk";
import { Router } from "express";

const factory: ExtensionRouterFactory = (ctx) => {
  const router = Router();

  router.get("/items", (_req, res) => {
    const items = ctx.db!
      .prepare("SELECT * FROM ext_myext_items ORDER BY created_at DESC")
      .all();
    res.json({ items });
  });

  router.post("/items", (req, res) => {
    const { title } = req.body as { title: string };
    ctx.db!
      .prepare("INSERT INTO ext_myext_items (project_id, title, created_at) VALUES (?, ?, ?)")
      .run(ctx.projectId, title, new Date().toISOString());
    ctx.logger.info(`Created item: ${title}`);
    res.json({ ok: true });
  });

  return router;
};

export default factory;
```

The `ctx` object (`ExtensionContext`) provides:

| Property | Type | Description |
|---|---|---|
| `projectId` | `string` | Active project identifier |
| `db` | `ScopedDatabase \| null` | Scoped SQLite proxy (null if no `database` permission) |
| `logger` | `ExtensionLogger` | Structured logger (`error`, `warn`, `info`, `debug`) |
| `config` | `Record<string, string>` | Resolved settings (Vault refs already substituted) |
| `mcp` | `MCPClient \| null` | MCP bridge client (null if no `mcp` config) |

#### ScopedDatabase

Extensions never receive the raw `better-sqlite3` handle. The `ScopedDatabase` proxy:
- Restricts queries to the extension's assigned table prefix (`ext_{name}_*`)
- Blocks access to core tables (`_migrations`, `_vault`, etc.)
- Enforces DDL rules: only `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE ADD COLUMN`

```typescript
interface ScopedDatabase {
  readonly tablePrefix: string;   // e.g. "ext_myext_"
  readonly projectId: string;
  prepare(sql: string): ScopedStatement;
  exec(sql: string): void;
}

interface ScopedStatement {
  run(...params: unknown[]): { changes: number; lastInsertRowid: number | bigint };
  get(...params: unknown[]): unknown;
  all(...params: unknown[]): unknown[];
}
```

### 2. UI Contract

Extension UI bundles export a default `ExtensionModule` with a map of React page components:

```tsx
// ui/src/index.tsx
import type { ExtensionModule, ExtensionPageProps } from "@renre-kit/extension-sdk";
import { useState, useEffect } from "react";

function ItemsPage({ apiBaseUrl, projectId }: ExtensionPageProps) {
  const [items, setItems] = useState([]);

  useEffect(() => {
    fetch(`${apiBaseUrl}/items`)
      .then((r) => r.json())
      .then((data) => setItems(data.items));
  }, [apiBaseUrl]);

  return (
    <ul>
      {items.map((item: any) => <li key={item.id}>{item.title}</li>)}
    </ul>
  );
}

const module: ExtensionModule = {
  pages: { items: ItemsPage },
};

export default module;
```

`ExtensionPageProps`:

| Prop | Type | Description |
|---|---|---|
| `projectId` | `string` | Active project identifier |
| `extensionName` | `string` | Extension name from manifest |
| `apiBaseUrl` | `string` | Base URL for backend API (e.g. `http://localhost:42888/api/{pid}/{ext}`) |

### 3. manifest.json Key Fields

```json
{
  "name": "my-extension",
  "version": "1.0.0",
  "displayName": "My Extension",
  "description": "What it does",
  "author": "your-name",
  "minSdkVersion": "0.1.0",
  "backend": {
    "entrypoint": "backend/index.js",
    "actions": [
      { "name": "list", "description": "List items", "method": "GET", "path": "/items" }
    ]
  },
  "ui": {
    "bundle": "ui/index.js",
    "pages": [
      { "id": "items", "label": "Items", "path": "items" }
    ]
  },
  "migrations": "migrations",
  "settings": {
    "schema": [
      { "key": "api_url", "type": "string", "label": "API URL" },
      { "key": "api_token", "type": "vault", "label": "API Token" }
    ]
  },
  "permissions": {
    "database": true,
    "network": ["api.example.com"]
  }
}
```

See `/schemas/manifest.json` for the complete JSON Schema with all fields and validation rules.

### 4. Build Process

**Backend** — compile TypeScript with `tsc`:
```bash
tsc -p tsconfig.json
```

**UI** — build with Vite using the SDK template config:
```typescript
// ui/vite.config.ts
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
    outDir: "../ui-dist",
  },
});
```

The Console shell provides React and ReactDOM globally. Extensions must NOT bundle their own React.

A pre-built template config is available at `packages/extension-sdk/vite.extension.config.ts`.

## SDK Version

The SDK version is exported as a constant:

```typescript
import { SDK_VERSION } from "@renre-kit/extension-sdk";
// "0.1.0"
```

The `minSdkVersion` field in your `manifest.json` declares the minimum SDK version your extension requires. The worker checks this at mount time and rejects incompatible extensions with a clear error message.

**Breaking change policy:** Pre-1.0.0 minor bumps may contain breaking changes. Pin conservatively during `0.x` development.

## Working Example

See `/examples/example-extension/` for a complete working extension demonstrating backend CRUD routes, SQLite migrations, settings with Vault integration, and two UI pages.

## Future

- `create-extension` CLI scaffolding tool (ADR-019)
- Shared UI component library (Card, Table, Form controls)
- npm publish for third-party distribution
