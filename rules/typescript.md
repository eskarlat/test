# TypeScript Rules

## Module & Build

- All packages use ESM (`"type": "module"` in package.json)
- Build with tsup: CLI and worker-service output ESM single file; extension-sdk outputs ESM + CJS + DTS
- Extension UIs build with Vite (React externalized as peer dependency)
- Shared base config via `tsconfig.base.json` at monorepo root; each package extends it
- Use `workspace:*` for internal package dependencies (`@renre-kit/extension-sdk`)

## Type Conventions

- PascalCase for interfaces and types: `ExtensionContext`, `ScopedDatabase`, `HookRequest`
- Factory functions follow `{Entity}Factory` pattern: `ExtensionRouterFactory`
- Union types for constrained strings, not enums:
  ```typescript
  type HookEvent = "sessionStart" | "sessionEnd" | "userPromptSubmitted" | "preToolUse" | "postToolUse" | "errorOccurred" | "preCompact" | "subagentStart" | "subagentStop";
  type SettingType = "string" | "vault" | "number" | "boolean" | "select";
  type PermissionDecision = "allow" | "deny" | "ask";
  ```
- Use `Record<string, unknown>` for open config objects, not `any` or `object`
- Mark immutable fields with `readonly` (e.g., `readonly tablePrefix: string` on ScopedDatabase)
- Optional fields use `?` — do not use `| undefined`

## Core Interfaces

Every extension backend must conform to:
```typescript
type ExtensionRouterFactory = (context: ExtensionContext) => Router;

interface ExtensionContext {
  projectId: string;
  db: ScopedDatabase | null;       // null if permissions.database is false
  logger: ExtensionLogger;
  config: Record<string, string>;  // resolved settings (vault values injected)
  mcp: MCPClient | null;           // null if no MCP config
}
```

Extension UI modules must export:
```typescript
interface ExtensionModule {
  pages: Record<string, React.ComponentType<ExtensionPageProps>>;
}

interface ExtensionPageProps {
  projectId: string;
  extensionName: string;
  apiBaseUrl: string;
}
```

## Extension Manifest Typing

```typescript
interface ExtensionManifest {
  name: string;
  version: string;              // semver
  displayName: string;
  description: string;
  author: string;
  backend?: { entrypoint: string; actions?: ActionDefinition[] };
  ui?: { pages: UIPage[]; bundle: string; styles?: string };
  mcp?: MCPStdioConfig | MCPSSEConfig;
  migrations?: string;          // directory path
  settings?: { schema: SettingDefinition[] };
  permissions?: ExtensionPermissions;
  hooks?: ExtensionHookConfig;
  skills?: SkillDefinition[];
  contextProvider?: ContextProviderManifest;
}
```

MCP config is a discriminated union on `transport`:
```typescript
interface MCPStdioConfig {
  transport: "stdio";
  command: string;              // must be in allowlist
  args: string[];
  env?: Record<string, string>; // supports ${VAULT:key}
}

interface MCPSSEConfig {
  transport: "sse";
  url: string;
  headers?: Record<string, string>; // supports ${VAULT:key}
  reconnect?: boolean;
  reconnectIntervalMs?: number;
}
```

## Error Handling

- Extension route handlers must be wrapped in try/catch — uncaught exceptions return 500 but never crash the worker
- Use typed error classes for distinct failure modes (timeout, circuit breaker, permission denied)
- Circuit breaker returns 503; timeout returns 504
- Never throw from within ScopedDatabase proxy — return error results to the extension

## Imports

- Use named imports for utilities: `import { join } from "node:path"`
- Prefer `node:` protocol for Node.js built-ins: `node:path`, `node:fs`, `node:os`, `node:child_process`
- Extension SDK types imported from `@renre-kit/extension-sdk`

## Logging Types

```typescript
interface Logger {
  error(source: string, message: string, meta?: Record<string, unknown>): void;
  warn(source: string, message: string, meta?: Record<string, unknown>): void;
  info(source: string, message: string, meta?: Record<string, unknown>): void;
  debug(source: string, message: string, meta?: Record<string, unknown>): void;
}
```

Source string convention: `"worker"`, `"cli"`, `"ext:{extension-name}"`, `"vault"`, `"mcp:{extension-name}"`.
