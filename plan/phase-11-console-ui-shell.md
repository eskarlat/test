# Phase 11 — Console UI Shell

## Goal
Build the Console UI application shell: React SPA with Vite, toolbar, sidebar, routing, project switcher, and dynamic extension page loading. No dashboard data yet — just the structural shell.

## Reference
- ADR-022: Console UI Tech Stack & Dynamic Extension Loading
- ADR-023: Real-Time Worker-UI Communication (SSE)
- ADR-024: Console UI Pages (layout structure)
- ADR-045: Console UI Graceful Degradation
- C4 Component: Console UI (Toolbar, Sidebar, Content Area, Extension UI Loader)

## Dependencies
- Phase 3 (worker service — serves Console SPA and provides APIs)

## Tasks

### 11.1 Package setup
- [ ] Create `packages/console-ui/` with Vite + React 19 + TypeScript
- [ ] Install dependencies: react-router v7, zustand, tailwindcss, lucide-react
- [ ] Initialize shadcn/ui: `cn()` helper, base components (Button, Card, Input, Select, Dialog, Skeleton, Badge, Tabs, Toast)
- [ ] Configure Vite build to output to `dist/` for worker service to serve
- [ ] Configure React externalization for extension UI compatibility (ADR-022): expose React and ReactDOM globally so dynamically imported extension bundles don't bundle their own React. Vite config: `optimizeDeps.include: ['react', 'react-dom']`

### 11.2 Worker service: serve Console SPA
- [ ] Serve `packages/console-ui/dist/` at `GET /` (static files)
- [ ] SPA fallback: all non-API routes return `index.html`
- [ ] In dev mode: proxy to Vite dev server (port 5173)
- [ ] CORS headers for extension UI bundle loading

### 11.3 Root layout (App.tsx)
- [ ] Full-height flex layout: sidebar + main area (toolbar + content)
- [ ] Responsive: sidebar collapsible on small screens
- [ ] Global error boundary wrapping content area
- [ ] Wire `useWorkerEvents` hook at App.tsx level (one SSE connection per tab — task 11.11)

### 11.4 Toolbar component
- [ ] Left: RenRe Kit logo/name
- [ ] Center: Project dropdown selector (fetches from `GET /api/projects`)
- [ ] Right: Connection status indicator (ADR-045), Vault icon (navigates to `/vault`), Settings icon (navigates to `/settings`)
- [ ] Connection status indicator: green dot (connected, hidden after 3s), amber pulsing dot + "Reconnecting..." (SSE dropped), red dot + "Server offline" (3+ failed reconnects)
- [ ] Project dropdown shows project name + path, "No project" option
- [ ] Selecting a project navigates to `/:projectId`

### 11.5 Sidebar component
- [ ] Core items (always visible): Dashboard, Extension Manager, Logs
- [ ] Extension items: generated from active project's extension manifests
- [ ] Only show extensions with `ui.pages` in manifest
- [ ] Extension sections: display name as header, pages as sub-items
- [ ] Status indicators: healthy (green), needs setup (yellow ⓘ), error (red)
- [ ] Active item highlighting based on current route
- [ ] Sidebar hidden when no project selected (system home)

### 11.6 Zustand stores
- [ ] `project-store.ts` — activeProjectId, projects list, setActiveProject, fetchProjects
  - Persist activeProjectId and projects to `localStorage` for surviving page reloads and offline viewing (seq-project-switch, ADR-045). On app init, read from localStorage, validate against server, fall back to first project if invalid
- [ ] `extension-store.ts` — extensions per project, fetchExtensions, getExtensionsForProject. Persist to `localStorage` (ADR-045)
- [ ] `vault-store.ts` — vault key names, fetchKeys. Persist to `localStorage` (ADR-045)
- [ ] `notification-store.ts` — toasts, available updates, addToast, setAvailableUpdates
- [ ] `connection-store.ts` — connection status (`connected`/`reconnecting`/`disconnected`), `lastConnectedAt`, `reconnectAttempts` (ADR-045)

### 11.7 Routing setup
- [ ] `/` — System Home page (placeholder)
- [ ] `/vault` — Vault page (placeholder)
- [ ] `/extensions` — Extension Manager (placeholder, per-project — ADR-024)
- [ ] `/logs` — Logs page (placeholder)
- [ ] `/settings` — Settings page (placeholder)
- [ ] `/:projectId` — Project Home (placeholder)
- [ ] `/:projectId/:extensionName/:pageId` — Extension page (dynamic loader)

### 11.8 Extension page loader
- [ ] `lib/extension-loader.ts` — dynamic `import()` with in-memory cache
- [ ] `ExtensionLoader` component — React.lazy wrapper with Suspense + Skeleton fallback
- [ ] `ExtensionErrorBoundary` — catches extension UI crashes, shows error + "Reload" button
- [ ] Passes `ExtensionPageProps` (projectId, extensionName, apiBaseUrl) to loaded component
- [ ] Cache invalidation function for upgrades/remounts

### 11.9 ExtensionSettingsForm component (ADR-014 + ADR-022)
- [ ] Create `components/extensions/ExtensionSettingsForm.tsx`
- [ ] Auto-generate form from extension's `settings.schema` in manifest
- [ ] Support 5 field types: `string` (text input), `vault` (vault key picker + create new), `number` (number input), `boolean` (toggle), `select` (dropdown with options)
- [ ] On save: `PUT /api/{pid}/extensions/{name}/settings` triggers remount
- [ ] Show loading/remounting indicator during remount (ADR-014: UI shows brief loading state)
- [ ] Handle 503 responses during remount gracefully

### 11.10 API client
- [ ] `api/client.ts` — base HTTP client with worker service base URL
- [ ] Auto-detect worker port (from URL or config)
- [ ] JSON request/response helpers
- [ ] Error handling: connection refused → update `connection-store` to "Disconnected", return cached data where available (ADR-045)
- [ ] Auto-recovery: any successful response → update `connection-store` to "Connected"

### 11.11 SSE event listener (ADR-023)
- [ ] `useWorkerEvents(baseUrl)` hook — connects to `GET /api/events` SSE endpoint (Phase 3)
- [ ] Wire into App.tsx at shell level (one connection per tab)
- [ ] Event handlers:
  - `extension:installed/removed/upgraded` → refresh extension store
  - `extension:remounted` → invalidate extension module cache
  - `project:registered/unregistered` → refresh project store
  - `updates:available` → update notification store
  - `extension:error` → show error toast
  - `mcp:connected/disconnected` → refresh MCP status
  - `vault:updated` → refresh vault store
- [ ] SSE reconnection strategy (ADR-045): immediate → 1s → 3s → 5s max interval
- [ ] After 3 failed reconnects → set `connection-store` to "Disconnected"
- [ ] On successful reconnect → fetch `GET /api/events/history` to fill gaps, refresh all stores

### 11.12 Toast notifications
- [ ] Toast component: auto-dismiss after 5s, close button, stack up to 5
- [ ] `ToastContainer` renders toasts from notification store
- [ ] Toast variants: success, error, warning, info

### 11.13 Reconnection banner (ADR-045)
- [ ] Non-dismissible slim banner below toolbar when `connection-store.status === "disconnected"`
- [ ] Text: "Server offline — showing cached data"
- [ ] Actions: "Reconnect" button (triggers SSE reconnect + health check), "How to start" tooltip with `renre-kit start` command
- [ ] Auto-dismisses when connection is restored

## Verification
```bash
# Build Console UI
cd packages/console-ui && pnpm build

# Start worker service (serves Console)
renre-kit start --no-browser

# Open Console
open http://localhost:42888

# Should see:
# - Toolbar with project dropdown (empty or with registered projects)
# - System home placeholder
# - Navigating to a project shows sidebar with core items
# - Extension page route shows loading skeleton then error (no extension UI yet)
```

## Files Created
```
packages/console-ui/
  package.json
  tsconfig.json
  vite.config.ts
  tailwind.config.ts
  postcss.config.js
  index.html
  src/
    main.tsx
    App.tsx
    routes/
      index.tsx              # System Home placeholder
      vault.tsx              # Vault placeholder
      extensions.tsx         # Extension Manager placeholder
      logs.tsx               # Logs placeholder
      settings.tsx           # Settings placeholder
      [projectId]/
        index.tsx            # Project Home placeholder
        [extensionName]/
          [pageId].tsx       # Extension page loader
    components/
      layout/
        Toolbar.tsx
        Sidebar.tsx
        ContentArea.tsx
      extensions/
        ExtensionLoader.tsx
        ExtensionErrorBoundary.tsx
        ExtensionSettingsForm.tsx
      ui/                    # shadcn components
    stores/
      project-store.ts
      extension-store.ts
      vault-store.ts
      notification-store.ts
      connection-store.ts
    api/
      client.ts
      events.ts                  # useWorkerEvents hook
    lib/
      extension-loader.ts
      utils.ts
    components/
      ui/Toast.tsx               # Toast notification component
      ui/ToastContainer.tsx      # Toast stack container
      layout/ConnectionStatus.tsx  # Toolbar connection indicator
      layout/ReconnectionBanner.tsx # Offline banner
```
