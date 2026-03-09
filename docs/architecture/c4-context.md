# C4 Level 1 — System Context Diagram

## Description
Shows RenRe Kit as a whole and how it interacts with external actors and systems.

## Actors & Systems
- **Developer** — Uses CLI commands and Console UI to manage projects and extensions
- **AI Agent** (GitHub Copilot / Claude Code) — Consumes hooks, skills, and queries worker service via CLI and hook entry points (worker-service.cjs)
- **GitHub Marketplace Repo** — Source of extension packages
- **Local File System** — Project files, global config, SQLite database

```mermaid
C4Context
    title System Context — RenRe Kit

    Person(dev, "Developer", "Uses CLI and Console to manage projects and extensions")
    Person(ai, "AI Agent", "GitHub Copilot / Claude Code — uses hooks, skills, queries via CLI and hook entry points")

    System(renrekit, "RenRe Kit", "CLI + Worker Service + Console UI — extension-based developer platform with Hook Intelligence")

    System_Ext(marketplace, "GitHub Marketplace Repo", "Hosts extension registry and packages")
    System_Ext(filesystem, "Local File System", "Project files, ~/.renre-kit global config, SQLite DB")

    Rel(dev, renrekit, "CLI commands, Console UI")
    Rel(ai, renrekit, "renre-kit query, hooks (worker-service.cjs), skills")
    Rel(renrekit, marketplace, "Fetches extension metadata and packages")
    Rel(renrekit, filesystem, "Reads/writes config, DB, extension assets")
```

## Narrative
RenRe Kit sits between the developer/AI agent and their project tooling. It provides both a CLI and Console UI for developers to manage projects and extensions, and intelligent context management for AI agents. Instead of MCP, context is delivered through a local worker service accessible via CLI (`renre-kit query`), hook entry points (`worker-service.cjs`) for event capture and context injection, and file-based integration (hooks in `.github/hooks/`, skills in `.github/skills/`). Hook Intelligence captures session data, tool usage patterns, error patterns, and observations via Copilot hooks to provide AI agents with contextual intelligence. Extensions are the primary unit of functionality — RenRe Kit itself is a minimal OS-like shell.
