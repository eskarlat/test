# C4 Level 2 — Container Diagram

## Description
Shows the major runtime containers within RenRe Kit and their responsibilities.

## Containers

| Container | Technology | Responsibility |
|-----------|-----------|----------------|
| CLI | TypeScript (Node.js) | Command parsing, project init, extension management, query proxy |
| Worker Service | Express.js (Node.js), EventEmitter (SSE), FTS5 (search), worker-service.cjs (hook entry point) | HTTP server on port 42888, hosts extension routes, serves UI, EventBus + SSE endpoint for real-time communication (ADR-023), Hook Intelligence services (ADR-027–035), FTS5 full-text search (ADR-038), Backup Manager for database backup/recovery (ADR-042) |
| Console UI | React SPA | Dashboard, project switcher, extension UI panels, sidebar |
| SQLite Database | better-sqlite3 (WAL mode, FTS5) | Shared DB with project-scoped tables for extensions, full-text search indexes |
| Global Store | File System | `~/.renre-kit/` — extensions cache, project registry, config |
| Project Store | File System | `.renre-kit/` + `.github/` — per-project extension config, hooks, skills |

```mermaid
C4Container
    title Container Diagram — RenRe Kit

    Person(dev, "Developer")
    Person(ai, "AI Agent")

    System_Boundary(renrekit, "RenRe Kit") {
        Container(cli, "CLI", "TypeScript", "Command parsing, init, marketplace, query proxy")
        Container(worker, "Worker Service", "Express.js", "HTTP server :42888, extension route host, API layer, EventBus + SSE (ADR-023), Hook Intelligence (ADR-027–035), FTS5 search (ADR-038), Backup Manager (ADR-042)")
        Container(ui, "Console UI", "React SPA", "Dashboard, sidebar, extension UI panels, project switcher")
        ContainerDb(db, "SQLite Database", "better-sqlite3", "Shared DB, project-scoped extension tables")
        Container(globalfs, "Global Store", "~/.renre-kit/", "Extensions cache, project registry, config")
    }

    System_Ext(marketplace, "GitHub Marketplace Repo")
    System_Ext(projectfs, "Project .renre-kit/ + .github/")

    Rel(dev, cli, "CLI commands")
    Rel(dev, ui, "Browser localhost:42888")
    Rel(ai, cli, "renre-kit query, hooks, skills")

    Rel(cli, worker, "HTTP requests (query proxy)")
    Rel(worker, ui, "Serves static assets + API, SSE events (GET /api/events)")
    Rel(worker, db, "Read/Write extension data")
    Rel(cli, globalfs, "Manage extensions, projects")
    Rel(cli, projectfs, "Write hooks, skills, extensions.json")
    Rel(cli, marketplace, "Fetch extensions")
    Rel(worker, globalfs, "Load extension backend code")
```

## Key Interactions
1. **CLI → Worker Service**: The `query` command proxies to worker service routes
2. **Worker Service → DB**: Extensions read/write project-scoped data; FTS5 indexes enable full-text search (ADR-038); Backup Manager handles database backup/recovery (ADR-042)
3. **Worker Service → UI**: Serves the React SPA and extension UI bundles; pushes real-time updates via SSE events on `GET /api/events` through the internal EventBus (ADR-023)
4. **CLI → File System**: `init`, `marketplace add/remove` modify project and global stores
5. **AI Agent → Worker Service**: Hooks executed via `worker-service.cjs` entry point; Hook Intelligence services provide smart context (ADR-027–035)
