# ADR-021: CLI Framework, Installation & Command Structure

## Status
Accepted

## Context
We need to choose a CLI framework for building the RenRe Kit CLI in TypeScript, define how users install it, and document the full command tree.

Reference: [Vercel Labs Skills CLI](https://github.com/vercel-labs/skills/tree/main) — uses @clack/prompts for interactive stepper flows, picocolors for output, simple-git for git operations.

### Framework Options Considered

| Framework | Pros | Cons |
|-----------|------|------|
| **Commander.js** | Simple, lightweight, widely used, easy to learn | No built-in plugin system, manual help formatting |
| **@clack/prompts** | Beautiful interactive UI (spinners, steppers, select, confirm), used by Vercel | Not a full CLI framework — no flag parsing or sub-commands |
| **oclif** (Salesforce) | Plugin architecture built-in, auto-generated help, TypeScript-first | Heavy, opinionated folder structure, complex for simple CLIs |
| **yargs** | Rich argument parsing, middleware support | Verbose API, TypeScript support is secondary |
| **Clipanion** (Yarn) | Type-safe, class-based commands, good TS support | Smaller community, less documentation |

## Decision

### Hybrid Approach: Commander.js + @clack/prompts

Two modes of interaction require two tools:

**Commander.js** — handles command parsing, sub-commands, flags. Essential for non-interactive/scriptable usage (AI agents, CI, piping).

**@clack/prompts** — handles interactive flows with beautiful terminal UI. Used for human-facing wizards (init, marketplace add, settings).

| Mode | Tool | Used By |
|------|------|---------|
| **Non-interactive** (flags, piping, scripting) | Commander.js | AI agents, hooks, CI/CD |
| **Interactive** (wizards, steppers, confirmations) | @clack/prompts | Developers in terminal |

Commands detect interactivity via `process.stdout.isTTY`. If interactive, they use @clack stepper flows. If non-interactive (piped, scripted), they use flags and output JSON/plain text.

### CLI Libraries

| Library | Purpose |
|---------|---------|
| `commander` | Command parsing, sub-commands, flags |
| `@clack/prompts` | Interactive terminal UI — intro, outro, select, confirm, spinner, group |
| `picocolors` | Terminal colors (lighter than chalk, zero-deps, used by Vercel) |
| `simple-git` | Git operations for marketplace clone/download |
| `cli-table3` | Table formatting for status/query output |
| `gray-matter` | Parse SKILL.md frontmatter (YAML metadata in markdown) |

### Interactive Flow Examples

#### `renre-kit init` (Interactive)
```
┌  renre-kit — Initialize Project
│
◆  Project name?
│  my-awesome-app (default: folder name)
│
◇  Project initialized!
│
│  Created:
│    .renre-kit/project.json
│    .renre-kit/extensions.json
│    .github/hooks/
│    .github/skills/
│
└  Run `renre-kit start` to launch the console.
```

#### `renre-kit marketplace add` (Interactive)
```
┌  renre-kit — Install Extension
│
◆  Search extensions...
│  jira
│
◆  Select extension:
│  ● jira-plugin (v2.1.0) — Jira integration for AI agents
│  ○ jira-mcp (v1.0.0) — Jira MCP bridge (stdio)
│
◆  jira-plugin@2.1.0 requests permissions:
│    ✓ Database — create and manage tables
│    ✓ Network — https://api.atlassian.net/*
│    ✓ Hooks — sessionStart, userPromptSubmitted
│    ✓ Vault — JIRA_API_TOKEN, JIRA_BASE_URL
│
◆  Accept permissions?
│  Yes
│
◇  Downloading jira-plugin@2.1.0...
│
◆  Configure settings:
│  JIRA_BASE_URL: https://mycompany.atlassian.net
│  JIRA_API_TOKEN: [Select from Vault] → jira_token
│  JIRA_DEFAULT_PROJECT: PROJ (optional, press Enter to skip)
│
◇  Extension installed and configured!
│
└  Run `renre-kit start` to activate, or install more extensions.
```

#### `renre-kit init` (Non-interactive / scripted)
```bash
# AI agent or CI — uses flags, no prompts
renre-kit init --name my-app
renre-kit marketplace add jira-plugin@2.1.0 --yes
renre-kit start --no-browser
```

### Installation

#### Phase 1 — From monorepo (development / early adopters)
```bash
# Clone and build
git clone https://github.com/x/renre-kit.git
cd renre-kit
pnpm install
pnpm run build

# Link CLI globally
pnpm link --global --filter @renre-kit/cli

# Verify
renre-kit --version
```

#### Phase 2 — npm global install (future)
```bash
npm install -g @renre-kit/cli
# or
npx @renre-kit/cli init
```

#### Phase 3 — Standalone binary (future)
Package with `bun build --compile` for zero-dependency distribution:
```bash
curl -fsSL https://renre-kit.dev/install.sh | sh
```

### Command Tree

```
renre-kit
│
├── init                                    # Initialize project
│   └── [--name <name>]                     # Project name (default: folder name)
│
├── start                                   # Start worker service + register project
│   ├── [--no-browser]                      # Don't open Console in browser
│   └── [--port <port>]                     # Override default port
│
├── stop                                    # Unregister project, stop server if last
│   └── [--force]                           # Force kill server regardless of other projects
│
├── status                                  # System overview
│   ├── [--json]                            # Machine-readable output
│   ├── [--short]                           # One-line summary
│   └── [--project <id>]                    # Specific project
│
├── query <extension> [action] [options]    # Proxy to worker service API
│   ├── [--json]                            # JSON output
│   ├── [-d <data>]                         # JSON body (implies POST)
│   ├── [--method <M>]                      # HTTP method override
│   ├── [--project <id>]                    # Target specific project
│   └── [--help]                            # List actions for extension
│
├── marketplace                             # Extension management
│   ├── add [marketplace/]<ext>[@version]   # Install extension
│   │   ├── [--local <path>]               # Install from local directory
│   │   └── [--yes]                         # Skip prompts (non-interactive)
│   ├── remove <extension>                  # Uninstall extension from project
│   ├── upgrade [extension]                 # Upgrade extension(s)
│   │   ├── [--all]                         # Upgrade all extensions
│   │   └── [--yes]                         # Skip prompts
│   ├── search <query>                      # Search across marketplaces
│   ├── list                                # List installed extensions
│   ├── register <url> --name <name>        # Add a marketplace
│   └── unregister <name>                   # Remove a marketplace
│
├── extension                               # Extension development tools
│   └── validate <path>                     # Validate extension manifest + files
│
├── uninstall                               # Remove renre-kit from project
│   └── [--keep-data]                       # Keep DB data, only remove config files
│
├── --version, -v                           # Print version
└── --help, -h                              # Print help
```

### Command Implementation Pattern

Commands use Commander for parsing and @clack for interactive flows:

```typescript
// packages/cli/src/commands/init.ts
import { Command } from "commander";
import * as p from "@clack/prompts";
import pc from "picocolors";
import { ProjectManager } from "../services/project-manager";

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description("Initialize renre-kit in the current project")
    .option("--name <name>", "Project name")
    .action(async (options) => {
      const pm = new ProjectManager();

      if (pm.isInitialized()) {
        p.log.error("renre-kit is already initialized in this directory");
        process.exit(1);
      }

      // Interactive mode — use @clack stepper
      if (process.stdout.isTTY && !options.name) {
        p.intro(pc.bgCyan(" renre-kit — Initialize Project "));

        const name = await p.text({
          message: "Project name?",
          placeholder: pm.defaultName(),
          defaultValue: pm.defaultName(),
        });

        if (p.isCancel(name)) {
          p.cancel("Init cancelled.");
          process.exit(0);
        }

        options.name = name;
      }

      const projectId = pm.init(options.name || pm.defaultName());

      if (process.stdout.isTTY) {
        p.log.success("Project initialized!");
        p.note(
          [
            ".renre-kit/project.json",
            ".renre-kit/extensions.json",
            ".github/hooks/",
            ".github/skills/",
          ].join("\n"),
          "Created"
        );
        p.outro(`Run ${pc.cyan("renre-kit start")} to launch the console.`);
      } else {
        // Non-interactive — plain JSON output
        console.log(JSON.stringify({ projectId, name: options.name }));
      }
    });
}
```

```typescript
// packages/cli/src/index.ts — entry point
#!/usr/bin/env node
import { Command } from "commander";
import { registerInitCommand } from "./commands/init";
import { registerStartCommand } from "./commands/start";
import { registerStopCommand } from "./commands/stop";
import { registerStatusCommand } from "./commands/status";
import { registerQueryCommand } from "./commands/query";
import { registerMarketplaceCommand } from "./commands/marketplace";
import { registerExtensionCommand } from "./commands/extension";
import { registerUninstallCommand } from "./commands/uninstall";

const program = new Command();

program
  .name("renre-kit")
  .description("Extension-based developer platform CLI")
  .version("0.1.0");

registerInitCommand(program);
registerStartCommand(program);
registerStopCommand(program);
registerStatusCommand(program);
registerQueryCommand(program);
registerMarketplaceCommand(program);
registerExtensionCommand(program);
registerUninstallCommand(program);

program.parse();
```

### CLI Project Structure
```
packages/cli/
  package.json
  tsconfig.json
  src/
    index.ts                    # entry point — registers all commands
    commands/
      init.ts
      start.ts
      stop.ts
      status.ts
      query.ts
      marketplace.ts            # sub-commands: add, remove, upgrade, search, list, register, unregister
      extension.ts              # sub-commands: validate
      uninstall.ts
    services/
      project-manager.ts        # .renre-kit/project.json + ~/.renre-kit/projects/ CRUD
      extension-installer.ts    # download, cache, validate, copy hooks/skills
      marketplace-client.ts     # fetch marketplace index, search, version resolution
      server-client.ts          # HTTP proxy to worker service (for query, reload, etc.)
      update-checker.ts         # non-blocking marketplace update check
    utils/
      config.ts                 # read/write ~/.renre-kit/config.json
      logger.ts                 # @clack/prompts wrappers + picocolors
      pid.ts                    # PID file management, stale detection
      paths.ts                  # resolve ~/.renre-kit/, .renre-kit/, walk-up
      formatter.ts              # JSON / table output formatting
```

### Build Configuration

```json
// packages/cli/package.json
{
  "name": "@renre-kit/cli",
  "version": "0.1.0",
  "type": "module",
  "bin": {
    "renre-kit": "./dist/index.js"
  },
  "scripts": {
    "build": "tsup src/index.ts --format esm --dts",
    "dev": "tsup src/index.ts --format esm --watch"
  },
  "dependencies": {
    "commander": "^12.0.0",
    "@clack/prompts": "^0.11.0",
    "picocolors": "^1.1.0",
    "simple-git": "^3.27.0",
    "cli-table3": "^0.6.0",
    "gray-matter": "^4.0.3"
  },
  "devDependencies": {
    "@renre-kit/extension-sdk": "workspace:*",
    "tsup": "^8.0.0",
    "typescript": "^5.0.0"
  }
}
```

## Consequences

### Positive
- Hybrid approach: beautiful interactive wizards for humans, clean flags for AI agents
- @clack/prompts provides modern terminal UX (spinners, steppers, selects) — same as Vercel Skills CLI
- Commander.js handles flag parsing and sub-commands reliably
- `isTTY` detection auto-switches between modes — no user configuration
- picocolors is zero-dependency and faster than chalk
- simple-git handles marketplace clone operations natively

### Negative
- Two frameworks to maintain (Commander + @clack)
- Interactive flows need testing in both modes (TTY and non-TTY)
- @clack's stepper UX may not suit all terminal emulators

### Mitigations
- Clear separation: Commander owns parsing, @clack owns interactive UI
- All commands work in non-interactive mode via flags — interactive is enhancement, not requirement
- CI/testing always uses non-interactive mode (`--yes` flag or piped input)
