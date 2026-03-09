# ADR-004: Dynamic Module Loading for Extension UI

## Status
Accepted

## Context
Extensions ship UI components (React pages) that appear in the Console sidebar. We need to decide how extension UIs are integrated into the main React SPA.

Options considered:
1. **Build-time integration** — rebuild the entire SPA when extensions are added/removed
2. **iframe isolation** — each extension UI runs in an iframe
3. **Dynamic module loading** — extensions ship pre-built JS bundles loaded at runtime

## Decision
**Extensions ship pre-built React bundles that the Console shell loads dynamically at runtime** (similar to Grafana's plugin panel system). The worker service serves extension UI assets from `~/.renre-kit/extensions/{name}/ui/`. The shell uses dynamic `import()` to load extension modules.

## Consequences

### Positive
- No recompilation when extensions are added/removed — instant install
- Extensions are self-contained — build once, load anywhere
- Shell stays lightweight — only loads UI for the active project's extensions
- Clear separation of concerns — shell owns layout, extensions own pages

### Negative
- Extensions must follow a specific build contract (export React components)
- Shared dependencies (React, UI library) need careful version management
- No type safety between shell and extension at runtime

### Mitigations
- Provide `@renre-kit/extension-sdk` with types, build tools, and shared deps
- Extension SDK defines the component contract:
  ```typescript
  export interface ExtensionModule {
    pages: Record<string, React.ComponentType<ExtensionPageProps>>;
  }
  ```
- React and shared libs are externalized — loaded once by shell, shared with extensions
- Extension build template provided in marketplace docs
