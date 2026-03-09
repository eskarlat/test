# Phase 7 — Extension Chat Integration

## Goal

Wire extensions into the chat system: extension-declared `chatTools` and `chatAgents` registered with Copilot SDK sessions, `ScopedLLM` proxy provided to extensions via `ExtensionContext`, extension tool namespace enforcement, and intelligence hooks for chat sessions.

## Reference

- ADR-047: Console Chat UI with GitHub Copilot SDK (§8 Extension LLM Access, §9 Extension Tools & Custom Agents, §10 Console Built-in Tools, §13 Intelligence Integration)
- ADR-019: Extension SDK Contract (amended)
- ADR-029: Tool Governance

## Dependencies

- Phase 3 (Extension SDK Types) — ScopedLLM, ChatToolDefinition, ChatAgentDefinition types
- Phase 4 (CopilotBridge) — Bridge must exist for ScopedLLM to delegate to

## Tasks

### 7.1 Implement ScopedLLM Proxy

File: `packages/worker-service/src/core/scoped-llm.ts`

- [ ] Export `createScopedLLM(extensionName: string, projectId: string, bridge: CopilotBridge): ScopedLLM`
- [ ] Implement `listModels()`:
  - Delegates to `bridge.listModels()`
  - No filtering — extensions see all available models
- [ ] Implement `complete(request)`:
  - Creates ephemeral session: `bridge.createEphemeralSession(projectId)`
  - Sends single message
  - Waits for complete response
  - Destroys ephemeral session
  - Returns `LLMCompleteResponse`
- [ ] Implement `stream(request, handler)`:
  - Creates ephemeral session
  - Sends message
  - Subscribes to SDK events, forwards to handler callbacks:
    - `assistant.message_delta` → `handler.onDelta(delta)`
    - `assistant.reasoning_delta` → `handler.onReasoning(delta)`
    - `assistant.message` → `handler.onComplete(response)`
    - `session.error` → `handler.onError(error)`
  - Destroys ephemeral session on completion
- [ ] Implement `createSession(opts?)`:
  - Creates managed session via `bridge.createManagedSession(projectId, opts)`
  - Returns `LLMSession` proxy:
    - `send()` → `bridge.sendMessage()` + wait for response
    - `stream()` → `bridge.sendMessage()` + subscribe to events
    - `getMessages()` → `bridge.getSessionMessages()`
    - `disconnect()` → `bridge.deleteSession()`
- [ ] Rate limiting: track requests per extension per minute (log warning at 60 req/min, future: enforce)
- [ ] Error isolation: catch and wrap SDK errors in extension-friendly error types
- [ ] Logging: log extension LLM calls at debug level (`[ext:name] LLM complete, model=X, tokens=Y`)

### 7.2 Wire ScopedLLM into Extension Loading

File: `packages/worker-service/src/core/extension-loader.ts`

- [ ] Update `ExtensionContext` creation to include `llm`:
  ```typescript
  const context: ExtensionContext = {
    projectId,
    db: scopedDb,
    logger: scopedLogger,
    config: resolvedSettings,
    mcp: mcpClient,
    llm: manifest.permissions?.llm ? createScopedLLM(extensionName, projectId, copilotBridge) : null,
  };
  ```
- [ ] Only provide `llm` if extension has `permissions.llm: true` in manifest
- [ ] If CopilotBridge is not available (`status !== "ready"`), provide `null` regardless of permission
  - Extensions should handle `llm === null` gracefully

### 7.3 Register Extension Chat Tools with SDK Sessions

File: `packages/worker-service/src/core/copilot-bridge.ts` (update)

- [ ] During `createSession()`, after registering built-in tools:
  - Get installed extensions for the project
  - For each extension with `chatTools` in manifest:
    - Namespace tool name: `{extensionName}__{toolName}` (double underscore separator)
    - Call `defineTool()` on SDK session:
      ```typescript
      session.defineTool({
        name: `${extName}__${tool.name}`,
        description: `[${extDisplayName}] ${tool.description}`,
        parameters: tool.parameters,
        handler: async (args) => {
          // Route to extension's backend endpoint
          const [method, path] = tool.endpoint.split(" ");
          const response = await fetch(`http://localhost:${port}/api/${projectId}/${extName}${path}`, {
            method,
            headers: { "Content-Type": "application/json" },
            body: method !== "GET" ? JSON.stringify(args) : undefined,
          });
          return response.json();
        },
      });
      ```
- [ ] Tool governance: `preToolUse` hook runs before extension tool execution
  - If governance denies, return error result to SDK
- [ ] Extension tools appear in tool execution events with full namespace name
- [ ] UI strips namespace prefix for display (show `ext-name / tool-name`)

### 7.4 Register Extension Chat Agents

File: `packages/worker-service/src/core/copilot-bridge.ts` (update)

- [ ] During `createSession()`, register extension `chatAgents`:
  ```typescript
  for (const agent of manifest.chatAgents ?? []) {
    session.registerCustomAgent({
      name: `${extName}__${agent.name}`,
      displayName: agent.displayName,
      description: agent.description,
      prompt: agent.prompt,
      tools: agent.tools.map((t) => `${extName}__${t}`),  // Namespace tool refs
    });
  }
  ```
- [ ] Agent prompt is set as system prompt override when agent is selected
- [ ] Only register agents whose referenced tools are all valid

### 7.5 Extension Permission Checks

File: `packages/worker-service/src/core/copilot-bridge.ts` (update)

- [ ] Before registering extension tools/agents, verify:
  - Extension has `permissions.llm: true` (else skip tools/agents)
  - Extension is not in circuit-breaker suspended state
  - Extension tools reference valid backend endpoints
- [ ] Log skipped tools/agents at warn level

File: `packages/worker-service/src/core/extension-loader.ts` (update)

- [ ] Display `llm` permission during extension install confirmation (CLI already shows permissions)
- [ ] Include `chatTools` count and `chatAgents` count in extension status API

### 7.6 Intelligence Integration for Chat

File: `packages/worker-service/src/core/copilot-bridge.ts` (update from Phase 4)

- [ ] Ensure hook integration captures chat-specific metadata:
  - `sessionStart` hook payload includes: `{ source: "chat", model, projectId }`
  - `userPromptSubmitted` payload includes: `{ source: "chat", prompt, sessionId }`
  - `preToolUse` payload includes: `{ source: "chat", toolName, isExtensionTool }`
  - `postToolUse` payload includes: `{ success, durationMs, toolName }`
  - `errorOccurred` payload includes: `{ source: "chat", error, sessionId }`
- [ ] Session memory integration:
  - On `sessionEnd`, call `session-memory.recordSession()` with chat session data
  - Include: model used, tools called, extensions involved, duration, message count
- [ ] Observations integration:
  - Extension tools can create observations during chat via existing observation service
  - Chat sessions that modify files or trigger errors can auto-create observations
  - Observations reference the chat session ID as source
- [ ] Prompt journal integration (ADR-047 §13):
  - Every user message sent in a chat session is recorded to the prompt journal via `prompt-journal.recordPrompt()`
  - Include metadata: `{ source: "chat", sessionId, projectId, model }`
  - Intent detection runs on chat prompts the same as hook-sourced prompts
- [ ] FTS indexing:
  - Chat user prompts indexed for full-text search
  - Chat assistant responses indexed for full-text search
  - Index entries reference the chat session ID for cross-linking

### 7.7 Console UI — Cross-linking

File: `packages/console-ui/src/routes/sessions/detail.tsx` (update)

- [ ] For sessions with `source: "chat"`:
  - Show "Open in Chat" link that navigates to `/:projectId/chat/:sessionId`
- [ ] Tool analytics entries from chat show link to originating chat session

File: `packages/console-ui/src/components/chat/ChatToolExecution.tsx` (update)

- [ ] Extension tool cards show extension icon/badge
- [ ] Extension agent blocks show agent display name

### 7.8 Verification

```bash
# Build
pnpm run build

# Test with an extension that declares chatTools:
# 1. Create test extension with manifest.json containing chatTools
# 2. Install extension
# 3. Create chat session
# 4. Verify extension tools appear in LLM's tool list
# 5. Send a prompt that triggers extension tool use
# 6. Verify tool call routes to extension backend

# Test ScopedLLM:
# 1. Create extension with llm permission
# 2. Extension backend calls ctx.llm.complete({ prompt: "Hello" })
# 3. Verify response is returned

# Test intelligence:
# 1. Create chat session and send messages
# 2. Check /api/{pid}/sessions — chat session should appear
# 3. Check /api/{pid}/prompts — user prompts recorded
# 4. Check /api/{pid}/tool-analytics — tool calls tracked

# Lint
pnpm run lint
pnpm run lint:duplication
```

## Files Created

```
packages/worker-service/src/core/scoped-llm.ts          — ScopedLLM proxy factory
```

## Files Modified

```
packages/worker-service/src/core/copilot-bridge.ts       — Register extension tools/agents, intelligence hooks
packages/worker-service/src/core/extension-loader.ts     — Wire ScopedLLM into ExtensionContext
packages/worker-service/src/routes/extensions.ts         — Show chatTools/chatAgents count in status
packages/console-ui/src/routes/sessions/detail.tsx       — "Open in Chat" link for chat sessions
packages/console-ui/src/components/chat/ChatToolExecution.tsx — Extension tool badge
```
