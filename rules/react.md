# React Rules

## Tech Stack

- React 19, Vite, React Router v7, Zustand, shadcn/ui, Tailwind CSS, Lucide React icons
- All components in TypeScript (.tsx)
- React is a peer dependency for extension UI bundles (externalized in Vite build)

## Application Layout

```
App.tsx — root layout
├── Sidebar          # Dynamic per project (extensions define menu items)
└── Main area
    ├── Toolbar      # Project dropdown, Vault icon, notifications
    └── ContentArea  # <Outlet /> with error boundary
```

Full-height flex layout: sidebar left, main area right. Sidebar collapsible on small screens.

## Routing

React Router v7 with nested routes:

```
/                                      → System Home (all projects overview)
/vault                                 → Vault page (global secrets)
/extensions                            → Extension manager
/logs                                  → Log viewer
/settings                              → Global settings
/:projectId                            → Project Home (dashboard)
/:projectId/:extensionName/:pageId     → Extension page (dynamic import)
```

Extension pages are loaded dynamically — no build-time knowledge of extensions.

## State Management — Zustand Stores

Four global stores, accessed via hooks or `getState()` in async contexts:

**project-store.ts:**
```typescript
interface ProjectStore {
  activeProjectId: string | null;      // persisted to localStorage
  projects: ActiveProject[];
  workerPort: number;
  setActiveProject: (id: string) => void;
  fetchProjects: () => Promise<void>;
}
```

**extension-store.ts:**
```typescript
interface ExtensionStore {
  extensions: Record<string, MountedExtension[]>;  // keyed by projectId
  fetchExtensions: (projectId: string) => Promise<void>;
  getExtensionsForProject: (projectId: string) => MountedExtension[];
}
```

**vault-store.ts:**
```typescript
interface VaultStore {
  keys: string[];                      // key names only, never values
  fetchKeys: () => Promise<void>;
}
```

**notification-store.ts:**
```typescript
interface NotificationStore {
  toasts: Toast[];
  availableUpdates: UpdateInfo[];
  addToast: (message: string, type?: "success" | "error" | "info") => void;
  setAvailableUpdates: (updates: UpdateInfo[]) => void;
}
```

Persist `activeProjectId` to localStorage for surviving page reloads.

## Dynamic Extension UI Loading

Extensions ship pre-built ES module bundles. The Console loads them at runtime:

```typescript
// lib/extension-loader.ts
const moduleCache = new Map<string, ExtensionModule>();

export async function loadExtensionModule(
  name: string,
  version: string,
  baseUrl: string,
): Promise<ExtensionModule> {
  const key = `${name}@${version}`;
  if (moduleCache.has(key)) return moduleCache.get(key)!;

  const url = `${baseUrl}/extensions/${name}/${version}/ui/index.js`;
  const module = await import(/* @vite-ignore */ url);
  const ext: ExtensionModule = module.default;

  if (!ext.pages || typeof ext.pages !== "object") {
    throw new Error(`Extension "${name}" missing "pages" export`);
  }

  moduleCache.set(key, ext);
  return ext;
}

export function invalidateExtensionModule(name: string): void {
  for (const k of moduleCache.keys()) {
    if (k.startsWith(`${name}@`)) moduleCache.delete(k);
  }
}
```

Cache invalidated on extension upgrade, removal, or remount.

## Extension Page Rendering

Use `React.lazy` + `Suspense` + error boundary:

```tsx
function ExtensionPage() {
  const { projectId, extensionName, pageId } = useParams();
  const workerPort = useProjectStore((s) => s.workerPort);

  const PageComponent = useMemo(
    () => lazy(async () => {
      const ext = useExtensionStore.getState().getExtensionsForProject(projectId!);
      const manifest = ext.find((e) => e.name === extensionName);
      const module = await loadExtensionModule(extensionName!, manifest!.version, `http://localhost:${workerPort}`);
      return { default: module.pages[pageId!] };
    }),
    [projectId, extensionName, pageId, workerPort],
  );

  return (
    <ExtensionErrorBoundary extensionName={extensionName!}>
      <Suspense fallback={<Skeleton className="w-full h-96" />}>
        <PageComponent
          projectId={projectId!}
          extensionName={extensionName!}
          apiBaseUrl={`http://localhost:${workerPort}/api/${projectId}/${extensionName}`}
        />
      </Suspense>
    </ExtensionErrorBoundary>
  );
}
```

## Extension Module Contract

Every extension UI must default-export this shape:
```typescript
interface ExtensionModule {
  pages: Record<string, React.ComponentType<ExtensionPageProps>>;
}

interface ExtensionPageProps {
  projectId: string;
  extensionName: string;
  apiBaseUrl: string;        // pre-built URL to the extension's backend
}
```

## Error Boundaries

- `ExtensionErrorBoundary` wraps every extension page — catches crashes, shows error + "Reload" button
- Extension UI crashes never break the Console shell
- Failed sections in dashboard show inline error with retry button, not full-page errors
- UI error reports sent to `POST /api/errors` for logging

## SSE Event Hook

Wire at the App shell level — one connection per session:

```typescript
// api/events.ts
export function useWorkerEvents(workerBaseUrl: string) {
  useEffect(() => {
    const source = new EventSource(`${workerBaseUrl}/api/events`);

    source.addEventListener("extension:installed", (e) => {
      const data = JSON.parse(e.data);
      useExtensionStore.getState().fetchExtensions(data.projectId);
      useNotificationStore.getState().addToast(`Installed ${data.name}@${data.version}`);
    });

    source.addEventListener("extension:upgraded", (e) => {
      const data = JSON.parse(e.data);
      invalidateExtensionModule(data.name);
      useExtensionStore.getState().fetchExtensions(data.projectId);
    });

    source.addEventListener("extension:removed", (e) => {
      const data = JSON.parse(e.data);
      invalidateExtensionModule(data.name);
      useExtensionStore.getState().fetchExtensions(data.projectId);
    });

    source.addEventListener("project:registered", () => {
      useProjectStore.getState().fetchProjects();
    });

    source.addEventListener("project:unregistered", () => {
      useProjectStore.getState().fetchProjects();
    });

    source.addEventListener("extension:error", (e) => {
      const data = JSON.parse(e.data);
      useNotificationStore.getState().addToast(`Error in ${data.name}: ${data.error}`, "error");
    });

    source.onerror = () => console.warn("SSE connection lost, reconnecting...");
    return () => source.close();
  }, [workerBaseUrl]);
}
```

## Dashboard Patterns

- Each dashboard section loads independently using Suspense boundaries
- Skeleton loading states per section
- Parallel data fetching — fast sections render immediately
- Failed sections show inline error + retry, not full-page error

## Sidebar

**Core items** (always visible): Dashboard, Extension Manager, Logs.

**Dynamic items** (per project): Built from extensions with `ui.pages` in their manifest. Each extension with UI shows as a menu group with nested page links.

**Intelligence group** (collapsible): Session Timeline, Observations, Tool Governance, Prompt Journal, Error Dashboard, Context Recipes.

**Status indicators per extension:**
- Green (✓): Healthy, mounted
- Yellow (ⓘ): Needs setup (missing settings or vault secrets)
- Red (✗): Error (mount failure, MCP crash)
- Blue (⬆): Update available

## Extension Settings Form

Auto-generated from `settings.schema` in the extension manifest:
- Field types: `string`, `vault`, `number`, `boolean`, `select`
- `vault` type renders a vault key picker (select existing or create new)
- On save: `PUT /api/{pid}/extensions/{name}/settings` → triggers remount
- Show loading indicator during remount
- Handle 503 gracefully (extension temporarily unavailable)

## File Organization

```
packages/console-ui/src/
  main.tsx                        # Entry point
  App.tsx                         # Root layout + SSE hook
  routes/                         # React Router pages
  components/
    layout/                       # Toolbar, Sidebar, ContentArea
    extensions/                   # ExtensionLoader, ErrorBoundary, SettingsForm
    dashboard/                    # ServerStatus, ProjectCard, ActivityFeed, etc.
    vault/                        # VaultKeyList, AddSecretDialog
    logs/                         # LogViewer, LogFilter
    ui/                           # shadcn/ui components
  stores/                         # Zustand stores
  api/
    client.ts                     # HTTP client to worker
    hooks.ts                      # Data fetching hooks
    events.ts                     # useWorkerEvents SSE hook
  lib/
    extension-loader.ts           # Dynamic import logic + cache
    utils.ts                      # cn() helper, formatters
```

## Extension UI Build (Vite)

Extension authors build their UI with React externalized:
```typescript
export default defineConfig({
  plugins: [react()],
  build: {
    lib: {
      entry: "src/index.tsx",
      formats: ["es"],
      fileName: "index",
    },
    rollupOptions: {
      external: ["react", "react-dom"],
    },
  },
});
```

The Console shell provides React at runtime. Extension bundles served at `/extensions/{name}/{version}/ui/index.js` with immutable cache headers.
