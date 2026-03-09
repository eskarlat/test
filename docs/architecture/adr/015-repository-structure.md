# ADR-015: Repository Structure & Marketplace Layout

## Status
Accepted

## Context
The RenRe Kit GitHub repository serves dual purpose: it is both the **source code** for the CLI/worker/console and the **marketplace** for extensions. We need a repository structure that cleanly supports both roles.

## Decision

### Monorepo Structure
The repository is a monorepo using workspaces. All core packages, built-in extensions, and marketplace metadata live in one repo.

```
github.com/x/renre-kit/
│
├── .renre-kit/
│   └── marketplace.json              # marketplace index (consumed by CLI)
│
├── packages/
│   ├── cli/                          # CLI application
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts              # entry point (bin)
│   │       ├── commands/
│   │       │   ├── init.ts
│   │       │   ├── start.ts
│   │       │   ├── stop.ts
│   │       │   ├── query.ts
│   │       │   ├── uninstall.ts
│   │       │   └── marketplace.ts    # add, remove, search
│   │       ├── services/
│   │       │   ├── project-manager.ts
│   │       │   ├── extension-installer.ts
│   │       │   └── server-client.ts   # proxy to worker service
│   │       └── utils/
│   │           ├── config.ts
│   │           ├── logger.ts
│   │           └── pid.ts
│   │
│   ├── worker-service/               # Express server
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── src/
│   │       ├── index.ts              # server entry point
│   │       ├── app.ts                # Express app setup
│   │       ├── routes/
│   │       │   ├── health.ts
│   │       │   ├── projects.ts       # project register/unregister
│   │       │   ├── extensions.ts     # extension list, reload, unload
│   │       │   └── vault.ts          # internal Vault API (keys CRUD)
│   │       ├── core/
│   │       │   ├── extension-registry.ts
│   │       │   ├── extension-loader.ts
│   │       │   ├── vault-resolver.ts
│   │       │   ├── settings-resolver.ts
│   │       │   ├── db-manager.ts
│   │       │   ├── migration-runner.ts
│   │       │   ├── mcp-manager.ts    # stdio + SSE MCP lifecycle
│   │       │   ├── logger.ts
│   │       │   ├── backup-manager.ts # database backup & recovery (ADR-042)
│   │       │   ├── scoped-database.ts # ScopedDatabase proxy (ADR-019)
│   │       │   └── paths.ts          # path resolution utilities
│   │       └── scripts/
│   │           └── worker-service.cjs # hook entry point script (ADR-026)
│   │
│   ├── console-ui/                   # React SPA
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── vite.config.ts
│   │   └── src/
│   │       ├── main.tsx
│   │       ├── App.tsx               # shell layout
│   │       ├── components/
│   │       │   ├── Toolbar.tsx       # project dropdown, Vault icon
│   │       │   ├── Sidebar.tsx       # dynamic sidebar from extensions
│   │       │   ├── VaultPage.tsx     # global secret management
│   │       │   └── Dashboard.tsx     # settings, ext manager, logs
│   │       ├── pages/
│   │       │   ├── ExtensionSettingsPage.tsx  # auto-generated from schema
│   │       │   ├── ExtensionManagerPage.tsx
│   │       │   └── LogsPage.tsx
│   │       ├── context/
│   │       │   └── ProjectContext.tsx
│   │       ├── hooks/
│   │       │   └── useExtensionLoader.ts  # dynamic import of ext UI
│   │       └── api/
│   │           └── client.ts         # HTTP client to worker service
│   │
│   └── extension-sdk/                # SDK for extension authors
│       ├── package.json
│       ├── tsconfig.json
│       └── src/
│           ├── index.ts              # public API exports
│           ├── types.ts              # ExtensionManifest, ExtensionContext, etc.
│           ├── ui-types.ts           # ExtensionModule, ExtensionPageProps
│           └── testing.ts            # test helpers for extension authors
│
├── extensions/                       # built-in / first-party extensions
│   ├── example-extension/            # reference implementation
│   │   ├── manifest.json
│   │   ├── backend/
│   │   │   └── index.ts
│   │   ├── ui/
│   │   │   └── src/
│   │   │       └── index.tsx
│   │   ├── migrations/
│   │   │   ├── 001_create_table.up.sql
│   │   │   └── 001_create_table.down.sql
│   │   └── skills/
│   │       └── example-skill/
│   │           └── SKILL.md
│   └── ...                           # more first-party extensions
│
├── docs/
│   ├── architecture/                 # C4, DFD, SEQ, ADR (what we've built)
│   ├── getting-started.md
│   ├── extension-authoring.md        # guide for extension developers
│   └── cli-reference.md
│
├── schemas/                          # JSON Schemas (source of truth, deployed to renre-kit.dev/schemas/)
│   ├── marketplace.json              # marketplace index format
│   ├── manifest.json                 # extension manifest format
│   ├── config.json                   # ~/.renre-kit/config.json format
│   ├── project.json                  # .renre-kit/project.json format
│   └── extensions.json              # .renre-kit/extensions.json format
│
├── package.json                      # root workspace config
├── tsconfig.base.json                # shared TypeScript config
├── turbo.json                        # monorepo build orchestration
└── README.md
```

### Marketplace Index (`.renre-kit/marketplace.json`)
Each marketplace repo contains this file at `.renre-kit/marketplace.json`. It identifies the marketplace and lists available extensions.

```json
{
  "marketplace": {
    "name": "official",
    "description": "Official RenRe Kit extension marketplace",
    "url": "github.com/x/renre-kit"
  },
  "version": "1",
  "extensions": [
    {
      "name": "example-extension",
      "version": "1.0.0",
      "description": "Reference implementation for extension authors",
      "repository": "github.com/x/renre-kit",
      "path": "extensions/example-extension",
      "tags": ["example", "reference"]
    },
    {
      "name": "jira-plugin",
      "version": "2.1.0",
      "description": "Jira integration — issues, boards, context for AI agents",
      "repository": "github.com/someuser/renre-kit-jira",
      "tags": ["jira", "project-management", "mcp"]
    },
    {
      "name": "figma-mcp",
      "version": "1.0.0",
      "description": "Figma MCP bridge via SSE",
      "repository": "github.com/someuser/renre-kit-figma",
      "tags": ["figma", "design", "mcp", "sse"]
    }
  ]
}
```

### Multiple Marketplaces
Users can register additional marketplaces (e.g., company-internal). Marketplace registry stored in global config.

**CLI commands:**
```bash
# Marketplace management
renre-kit marketplace list                          # list registered marketplaces
renre-kit marketplace register <url> --name <name>  # add a marketplace
renre-kit marketplace unregister <name>             # remove a marketplace

# Extension install — pattern: [marketplace/]extension[@version]
renre-kit marketplace add jira-plugin               # default marketplace, latest
renre-kit marketplace add jira-plugin@1.0.0         # default marketplace, pinned
renre-kit marketplace add company-internal/jira-plugin        # explicit marketplace, latest
renre-kit marketplace add company-internal/jira-plugin@1.0.0  # explicit marketplace, pinned
renre-kit marketplace add --local /path/to/extension          # local extension

# Search across all marketplaces
renre-kit marketplace search jira
```

**Ambiguity resolution:**
When an extension name exists in multiple marketplaces and no marketplace is specified, the CLI prompts:
```
Extension "common-ext" found in multiple marketplaces:
  1. official (v1.0.0)
  2. company-internal (v1.2.0)
Specify marketplace: renre-kit marketplace add <marketplace>/common-ext
```

**Global config (`~/.renre-kit/config.json`) — marketplaces section:**
```json
{
  "marketplaces": [
    {
      "name": "official",
      "url": "github.com/x/renre-kit",
      "default": true
    },
    {
      "name": "company-internal",
      "url": "github.com/mycompany/renre-kit-extensions",
      "default": false
    }
  ]
}
```

The first marketplace with `"default": true` is used when no marketplace prefix is specified.

### Extension Source Types

| Source | `repository` | `path` | How CLI installs |
|--------|-------------|--------|-----------------|
| **Built-in** (in monorepo) | `github.com/x/renre-kit` | `extensions/{name}` | Download specific directory from repo |
| **Third-party** (separate repo) | `github.com/user/repo` | — | Clone entire repo |
| **Local** | — | — | `marketplace add --local /path/to/ext` symlinks or copies |

### Workspace Packages

| Package | Published to npm? | Purpose |
|---------|-------------------|---------|
| `@renre-kit/cli` | Future (global install) | CLI binary: `npx renre-kit` or `npm i -g @renre-kit/cli` |
| `@renre-kit/worker-service` | No (bundled with CLI) | Worker service, spawned by CLI |
| `@renre-kit/console-ui` | No (bundled with worker) | React SPA, served by worker as static assets |
| `@renre-kit/extension-sdk` | Future (for third-party) | Types + helpers — monorepo extensions use `workspace:*` |

### Build & Tooling

| Tool | Purpose |
|------|---------|
| **Turborepo** | Monorepo task orchestration (build, test, lint) |
| **TypeScript** | All packages |
| **Vite** | Console UI build + extension UI build template |
| **Vitest** | Testing across all packages |
| **ESLint + Prettier** | Code quality |

### JSON Schemas

The `schemas/` directory is the source of truth for all JSON file formats used by RenRe Kit. Schemas are authored in the repo alongside the code and deployed to `https://renre-kit.dev/schemas/` via CI on every merge to `main`. This enables IDE autocompletion and validation for extension authors and users without a separate schema repository.

| Schema file | Format validated | `$schema` reference |
|-------------|-----------------|---------------------|
| `schemas/marketplace.json` | `.renre-kit/marketplace.json` | `https://renre-kit.dev/schemas/marketplace.json` |
| `schemas/manifest.json` | Extension `manifest.json` | `https://renre-kit.dev/schemas/manifest.json` |
| `schemas/config.json` | `~/.renre-kit/config.json` | `https://renre-kit.dev/schemas/config.json` |
| `schemas/project.json` | `.renre-kit/project.json` | `https://renre-kit.dev/schemas/project.json` |
| `schemas/extensions.json` | `.renre-kit/extensions.json` | `https://renre-kit.dev/schemas/extensions.json` |

Schemas are authored in the implementation phase where the corresponding data structure is first defined (Phase 2 for config/project/extensions, Phase 7 for marketplace, Phase 10 for manifest).

### Release Flow
1. Changes merged to `main`
2. CI builds all packages
3. `@renre-kit/cli` and `@renre-kit/extension-sdk` published to npm
4. Built-in extensions bundled with CLI release
5. `marketplace.json` updated via PR when new extensions are added/updated
6. Schemas in `schemas/` deployed to `renre-kit.dev/schemas/`

### Third-Party Extension Repository Convention
External extension repos follow this structure:
```
github.com/user/renre-kit-{extension-name}/
  manifest.json
  backend/
    index.ts                    # exports ExtensionRouterFactory
    package.json                # extension's own dependencies
  ui/
    dist/                       # pre-built bundle
      index.js
      styles.css
  migrations/
    001_xxx.up.sql
    001_xxx.down.sql
  README.md
```

Extension repos are self-contained — they include a pre-built UI bundle. The CLI downloads and caches the repo contents into `~/.renre-kit/extensions/{name}/{version}/`.

## Consequences

### Positive
- Single repo for core + marketplace = easy to maintain and discover
- Monorepo with workspaces keeps packages in sync
- Built-in extensions serve as reference implementations
- Extension SDK is independently versioned and published
- Third-party extensions have clear conventions

### Negative
- Monorepo grows as built-in extensions accumulate
- marketplace.json is manually maintained (PRs to add extensions)
- CLI must handle two install paths (monorepo subdirectory vs standalone repo)

### Mitigations
- Built-in extensions kept minimal (only reference + essential ones)
- Marketplace PR template with validation CI check
- CLI install logic abstracted behind `ExtensionInstaller` with pluggable sources
