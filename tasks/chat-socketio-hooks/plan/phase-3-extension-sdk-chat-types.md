# Phase 3 — Extension SDK: Chat Types

## Goal

Add LLM-related types to the Extension SDK: `ScopedLLM` interface, LLM request/response types, manifest `chatTools`/`chatAgents` declarations, and the `llm` permission. These types are needed by Phase 4 (backend) and Phase 7 (extension integration).

## Reference

- ADR-047: Console Chat UI with GitHub Copilot SDK (§8 Extension LLM Access, §9 Extension Tools & Custom Agents)
- ADR-019: Extension SDK Contract (amended by ADR-047)
- ADR-020: Manifest Validation (amended by ADR-047)

## Dependencies

None — type-only changes, can run in parallel with Phases 1 and 2.

## Tasks

### 3.1 Add ScopedLLM Interface and LLM Types

File: `packages/extension-sdk/src/index.ts`

- [ ] Add `ScopedLLM` interface:
  ```typescript
  export interface ScopedLLM {
    listModels(): Promise<LLMModelInfo[]>;
    complete(request: LLMCompleteRequest): Promise<LLMCompleteResponse>;
    stream(request: LLMStreamRequest, handler: LLMStreamHandler): Promise<void>;
    createSession(opts?: LLMSessionOpts): Promise<LLMSession>;
  }
  ```
- [ ] Add `LLMModelInfo` interface:
  ```typescript
  export interface LLMModelInfo {
    id: string;
    name: string;
    supportsVision: boolean;
    supportsReasoning: boolean;
    supportedReasoningEfforts?: ("low" | "medium" | "high" | "xhigh")[];
    maxContextTokens: number;
  }
  ```
- [ ] Add `LLMCompleteRequest` and `LLMCompleteResponse`:
  ```typescript
  export interface LLMCompleteRequest {
    prompt: string;
    model?: string;
    reasoningEffort?: "low" | "medium" | "high" | "xhigh";
    systemPrompt?: string;
    attachments?: LLMAttachment[];
    maxTokens?: number;
  }

  export interface LLMCompleteResponse {
    content: string;
    reasoning?: string;
    model: string;
    usage: { promptTokens: number; completionTokens: number };
  }
  ```
- [ ] Add `LLMStreamRequest` and `LLMStreamHandler`:
  ```typescript
  export interface LLMStreamRequest {
    prompt: string;
    model?: string;
    reasoningEffort?: "low" | "medium" | "high" | "xhigh";
    systemPrompt?: string;
    attachments?: LLMAttachment[];
    maxTokens?: number;
  }

  export type LLMStreamHandler = {
    onDelta?: (delta: string) => void;
    onReasoning?: (delta: string) => void;
    onComplete?: (response: LLMCompleteResponse) => void;
    onError?: (error: Error) => void;
  };
  ```
- [ ] Add `LLMSession` interface:
  ```typescript
  export interface LLMSession {
    readonly sessionId: string;
    send(prompt: string, attachments?: LLMAttachment[]): Promise<LLMCompleteResponse>;
    stream(prompt: string, handler: LLMStreamHandler, attachments?: LLMAttachment[]): Promise<void>;
    getMessages(): Promise<LLMSessionMessage[]>;
    disconnect(): Promise<void>;
  }
  ```
- [ ] Add supporting types:
  ```typescript
  export interface LLMSessionOpts {
    model?: string;
    reasoningEffort?: "low" | "medium" | "high" | "xhigh";
    systemPrompt?: string;
  }

  export interface LLMAttachment {
    type: "file" | "directory" | "selection";
    path: string;
    displayName?: string;
  }

  export interface LLMSessionMessage {
    role: "user" | "assistant";
    content: string;
    reasoning?: string;
    timestamp: number;
  }
  ```

### 3.2 Update ExtensionContext Interface

File: `packages/extension-sdk/src/index.ts`

- [ ] Add `llm` field to `ExtensionContext`:
  ```typescript
  export interface ExtensionContext {
    projectId: string;
    db: ScopedDatabase | null;
    logger: ExtensionLogger;
    config: Record<string, string>;
    mcp: MCPClient | null;
    llm: ScopedLLM | null;  // NEW — null if extension lacks "llm" permission
  }
  ```

### 3.3 Update ExtensionPermissions Interface

File: `packages/extension-sdk/src/index.ts`

- [ ] Add `llm` permission field:
  ```typescript
  export interface ExtensionPermissions {
    database?: boolean;
    network?: string[];
    mcp?: boolean;
    hooks?: HookEvent[];
    vault?: string[];
    filesystem?: string[];
    llm?: boolean;  // NEW — allows extension to use ScopedLLM
  }
  ```

### 3.4 Add Chat Tool and Agent Manifest Types

File: `packages/extension-sdk/src/index.ts`

- [ ] Add `ChatToolDefinition` interface:
  ```typescript
  export interface ChatToolDefinition {
    name: string;
    description: string;
    parameters: Record<string, unknown>;  // JSON Schema
    endpoint: string;  // "GET /path" or "POST /path"
  }
  ```
- [ ] Add `ChatAgentDefinition` interface:
  ```typescript
  export interface ChatAgentDefinition {
    name: string;
    displayName: string;
    description: string;
    prompt: string;  // System prompt for this agent
    tools: string[];  // References to chatTools by name
  }
  ```
- [ ] Add fields to `ExtensionManifest`:
  ```typescript
  export interface ExtensionManifest {
    // ... existing fields ...
    chatTools?: ChatToolDefinition[];
    chatAgents?: ChatAgentDefinition[];
  }
  ```

### 3.5 Update Manifest JSON Schema

File: `schemas/manifest.json`

- [ ] Add `chatTools` array schema:
  - Each item: `name` (string, required), `description` (string, required), `parameters` (object, required), `endpoint` (string, pattern: `^(GET|POST|PUT|DELETE|PATCH) /`, required)
- [ ] Add `chatAgents` array schema:
  - Each item: `name` (string, required), `displayName` (string, required), `description` (string, required), `prompt` (string, required), `tools` (array of strings, required)
- [ ] Add `llm` boolean to `permissions` object schema
- [ ] Validate that `chatAgents[].tools` entries reference valid `chatTools[].name` values
  - This cross-reference validation happens at runtime in `manifest-validator.ts`, not in JSON Schema

### 3.6 Update Manifest Validator

File: `packages/worker-service/src/core/manifest-validator.ts`

- [ ] Add validation for `chatTools`:
  - `name` must be a valid identifier (alphanumeric + hyphens)
  - `endpoint` must match format `METHOD /path`
  - `parameters` must be a valid JSON Schema object
  - No duplicate tool names within an extension
- [ ] Add validation for `chatAgents`:
  - `name` must be a valid identifier
  - `tools` array entries must all exist in the extension's `chatTools` names
  - No duplicate agent names within an extension
- [ ] Add validation: if `chatTools` or `chatAgents` are present, `permissions.llm` should be `true` (warn if missing)

### 3.7 Verification

```bash
# Build extension SDK
pnpm --filter @renre-kit/extension-sdk run build

# Verify types are exported
pnpm --filter @renre-kit/extension-sdk exec tsc --noEmit

# Build all packages to check downstream type compatibility
pnpm run build

# Validate manifest schema
node -e "const s = require('./schemas/manifest.json'); console.log(Object.keys(s.properties))"
# Should include: chatTools, chatAgents

# Lint
pnpm run lint
pnpm run lint:duplication
```

## Files Modified

```
packages/extension-sdk/src/index.ts                    — Add ScopedLLM, LLM types, update ExtensionContext/Permissions/Manifest
schemas/manifest.json                                  — Add chatTools, chatAgents, llm permission schemas
packages/worker-service/src/core/manifest-validator.ts — Validate chatTools/chatAgents
```
