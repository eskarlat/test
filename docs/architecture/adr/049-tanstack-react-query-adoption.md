# ADR-049: TanStack React Query Adoption for Console UI Data Fetching

## Status
Proposed

## Context

The Console UI currently uses a **hybrid data fetching strategy** that has grown organically across 12+ Zustand stores, a custom `useFetch` hook, and inline `fetch()` calls in route components. ADR-022 originally noted "React Query or SWR hooks" as the intended approach for `api/hooks.ts`, but the implementation diverged into a hand-rolled solution.

### Current State Analysis

**Three co-existing fetch patterns:**

| Pattern | Where Used | Count |
|---------|-----------|-------|
| Zustand store actions with direct `fetch()` | project-store, extension-store, vault-store | 3 stores |
| Zustand store actions with `apiGet()`/`apiPost()` | session, observation, error, prompt, tool-analytics, tool-rules, context-recipe, search stores | 8 stores |
| Custom `useFetch<T>` hook | Dashboard components (health, MCP status, sessions, logs, hooks, API usage) | 6 hooks |
| Inline `apiGet()` in components | MarketplaceTab (local state + useEffect) | 1+ components |

**Identified problems:**

1. **No automatic cache invalidation or deduplication** — If two components request the same endpoint, two network requests fire. The `useFetch` hook has no shared cache; each mount creates an independent fetch cycle.

2. **Inconsistent loading/error state management** — Some stores use a single shared `loading` boolean for multiple parallel fetches (e.g., `session-store` fires session detail + timeline in parallel but has one `loading` flag). Others track no loading state at all (`project-store`).

3. **Broken optimistic updates** — `observation-store`, `prompt-store`, and `tool-rules-store` apply optimistic mutations but never roll back on server error. If a DELETE fails, the item stays removed in the UI.

4. **Unhandled `Promise.all` failures** — `project-home.tsx` fires 6 parallel stat fetches via `Promise.all` with no individual error handling. One failure zeros out all intelligence counters.

5. **Split fetch patterns bypass centralized error handling** — `project-store`, `extension-store`, and `vault-store` use raw `fetch()` instead of `apiGet()`, bypassing connection status tracking and error normalization.

6. **Stale secondary data** — 5 stores fire two fetches without awaiting both (e.g., `fetchPatterns()` + `fetchTrends()` in `error-store`). The secondary data can be rendered stale relative to the primary data.

7. **Manual SSE→refetch wiring** — `events.ts` maps every SSE event type to a store's `fetch*()` method manually. Adding a new data domain requires editing `events.ts`, creating a store, and wiring the SSE handler — three files for one concern.

8. **No retry, no background refetch** — Failed requests show an error state with a manual "Retry" button. There is no automatic retry on transient failures (network blips, 503 during server restart).

9. **No request cancellation on unmount** — The custom `useFetch` hook tracks a `cancelled` flag to prevent setState after unmount, but doesn't actually abort the in-flight `fetch()`. The request completes even after the component is gone.

10. **localStorage hydration without validation** — `project-store` and `extension-store` persist to localStorage via Zustand middleware. On app load, stale cached data renders before server data arrives. There is no staleness check or background revalidation.

### Scale of the Problem

The Console UI has **12 Zustand stores with fetch logic**, **6 `useFetch` hooks**, and **~15 route components with data dependencies**. Each data domain reinvents: loading state, error state, cache, refetch triggers, and SSE integration. This is ~400 lines of boilerplate data-fetching code across stores that TanStack Query handles declaratively.

## Decision

**Adopt TanStack React Query v5** (`@tanstack/react-query`) as the standard data fetching and server-state management layer for the Console UI.

### What Changes

| Concern | Before | After |
|---------|--------|-------|
| **Server state cache** | Zustand stores + localStorage persist | React Query cache (in-memory, configurable) |
| **Data fetching** | Store actions, `useFetch` hook, inline fetch | `useQuery` / `useSuspenseQuery` hooks |
| **Mutations** | Store actions with manual optimistic updates | `useMutation` with `onMutate`/`onError` rollback |
| **Loading/error states** | Manual per-store booleans | Automatic per-query `status`, `fetchStatus` |
| **SSE invalidation** | Manual `store.fetch*()` calls in `events.ts` | `queryClient.invalidateQueries({ queryKey })` |
| **Request deduplication** | None | Automatic by query key |
| **Retry** | None (manual button) | Automatic (3 retries with exponential backoff) |
| **Background refetch** | None | `refetchOnWindowFocus`, `refetchInterval` for critical data |
| **Request cancellation** | `cancelled` flag (no abort) | `AbortSignal` passed to `queryFn` |
| **Stale-while-revalidate** | localStorage hydration (unvalidated) | Built-in `staleTime` / `gcTime` |

### What Stays the Same

| Concern | Approach | Rationale |
|---------|----------|-----------|
| **Client-only UI state** (active project, sidebar, filters, modals) | Zustand stores | React Query manages *server* state; Zustand manages *client* state. They complement each other. |
| **SSE connection** | Custom `EventSource` in `events.ts` | React Query doesn't manage push connections. SSE continues to trigger query invalidations. |
| **API client** | `apiGet`/`apiPost`/`apiPut`/`apiDelete` in `client.ts` | React Query's `queryFn` / `mutationFn` wraps these. Signatures must be extended to accept `RequestInit` options (see prerequisite below). |
| **Extension module cache** | In-memory `Map` in `extension-loader.ts` | This is not server state — it's a code module cache. |

### Prerequisites

#### API Client — AbortSignal Support

The current `apiGet`/`apiPost`/`apiPut`/`apiDelete` functions do not accept `RequestInit` options. React Query passes an `AbortSignal` to `queryFn` for automatic request cancellation on unmount. The client must be updated **before** migration begins:

```typescript
// client.ts — updated signatures
export async function apiGet<T>(
  path: string,
  options?: { signal?: AbortSignal }
): Promise<ApiResponse<T>> {
  return executeFetch<T>(resolveUrl(path), {
    method: "GET",
    headers: { "Content-Type": "application/json" },
    signal: options?.signal,
  });
}

export async function apiPost<T>(
  path: string,
  body: unknown,
  options?: { signal?: AbortSignal }
): Promise<ApiResponse<T>> {
  return executeFetch<T>(resolveUrl(path), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: options?.signal,
  });
}

// Same pattern for apiPut, apiDelete
```

This change is backwards-compatible — the `options` parameter is optional, so existing call sites continue to work during incremental migration.

#### QueryClient Singleton

`events.ts` runs outside the React component tree (SSE listener), so it cannot use `useQueryClient()`. The QueryClient must be a module-level singleton exported from a dedicated file:

```typescript
// api/query-client.ts
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 2,
      retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10_000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
    },
  },
});
```

```tsx
// main.tsx — uses the singleton, does NOT create a new instance
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./api/query-client";

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      {import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
    </QueryClientProvider>
  </StrictMode>
);
```

```typescript
// events.ts — imports the same singleton
import { queryClient } from "./query-client";

function handleSSEEvent(event: string) {
  // queryClient is guaranteed to be initialized — it's a module-level const
  // created at import time, before any SSE connection is established
  queryClient.invalidateQueries({ queryKey: ... });
}
```

The module-level singleton guarantees the QueryClient exists before the first SSE event arrives, since `query-client.ts` is imported at module load time by both `main.tsx` and `events.ts`.

### Architecture

#### Query Key Convention

Hierarchical keys enable scoped invalidation:

```typescript
// Query key factory
export const queryKeys = {
  projects: {
    all: ["projects"] as const,
    detail: (id: string) => ["projects", id] as const,
  },
  extensions: {
    byProject: (projectId: string) => ["extensions", projectId] as const,
  },
  vault: {
    keys: ["vault", "keys"] as const,
  },
  sessions: {
    byProject: (projectId: string) => ["sessions", projectId] as const,
    detail: (projectId: string, sessionId: string) =>
      ["sessions", projectId, sessionId] as const,
    timeline: (projectId: string, sessionId: string) =>
      ["sessions", projectId, sessionId, "timeline"] as const,
  },
  observations: {
    byProject: (projectId: string) => ["observations", projectId] as const,
  },
  errors: {
    patterns: (projectId: string) => ["errors", "patterns", projectId] as const,
    trends: (projectId: string) => ["errors", "trends", projectId] as const,
  },
  prompts: {
    byProject: (projectId: string) => ["prompts", projectId] as const,
    stats: (projectId: string) => ["prompts", "stats", projectId] as const,
  },
  tools: {
    analytics: (projectId: string) => ["tools", "analytics", projectId] as const,
    warnings: (projectId: string) => ["tools", "warnings", projectId] as const,
    rules: (projectId: string) => ["tools", "rules", projectId] as const,
    auditLog: (projectId: string) => ["tools", "audit", projectId] as const,
  },
  contextRecipes: {
    byProject: (projectId: string) => ["context-recipes", projectId] as const,
    preview: (projectId: string) => ["context-recipes", "preview", projectId] as const,
  },
  health: ["health"] as const,
  logs: (projectId: string | null, limit: number) =>
    ["logs", projectId, limit] as const,
  mcp: {
    status: (projectId: string) => ["mcp", "status", projectId] as const,
  },
  config: ["config"] as const,
  marketplace: ["marketplace"] as const,
  search: (projectId: string, query: string) =>
    ["search", projectId, query] as const,
} as const;
```

#### SSE → Query Invalidation

Replace manual store refetch calls with targeted invalidation:

```typescript
// events.ts — simplified SSE handler
import { queryClient } from "./query-client";

function handleSSEEvent(event: string, data: unknown) {

  const invalidationMap: Record<string, QueryKey[]> = {
    "extension:installed": [["extensions"]],
    "extension:removed": [["extensions"]],
    "extension:upgraded": [["extensions"]],
    "extension:enabled": [["extensions"]],
    "extension:disabled": [["extensions"]],
    "project:registered": [["projects"]],
    "project:unregistered": [["projects"]],
    "vault:updated": [queryKeys.vault.keys],
    "session:started": [["sessions"]],
    "session:ended": [["sessions"]],
    "observation:created": [["observations"]],
    "observation:updated": [["observations"]],
    "error:recorded": [["errors"]],
    "prompt:recorded": [["prompts"]],
    "tool:used": [["tools"]],
    "tool:denied": [["tools"]],
    "mcp:connected": [["mcp"], ["extensions"]],
    "mcp:disconnected": [["mcp"], ["extensions"]],
  };

  const keys = invalidationMap[event];
  if (keys) {
    keys.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
  }
}
```

This replaces ~60 lines of manual store-wiring with a declarative map. Adding a new data domain requires only a new query key and an entry in the map.

#### Example: Query Hook (Replacing useFetch + Store)

Before (store + custom hook + route):
```typescript
// stores/session-store.ts — 80+ lines
interface SessionStore {
  sessions: Session[];
  loading: boolean;
  error: string | null;
  fetchSessions: (projectId: string) => Promise<void>;
  // ... more state and actions
}

// routes/sessions/index.tsx
useEffect(() => { fetchSessions(projectId); }, [projectId]);
```

After (query hook + route):
```typescript
// api/queries/sessions.ts
export function useSessions(projectId: string) {
  return useQuery({
    queryKey: queryKeys.sessions.byProject(projectId),
    queryFn: ({ signal }) =>
      apiGet<Session[]>(`/api/${projectId}/sessions`, { signal }),
    staleTime: 30_000, // SSE invalidation is primary freshness mechanism
  });
}

// routes/sessions/index.tsx
const { data: sessions, isLoading, error } = useSessions(projectId);
```

#### Example: Mutation with Optimistic Update and Rollback

Before (broken rollback):
```typescript
// stores/observation-store.ts
deleteObservation: async (projectId, id) => {
  // Optimistic remove — NO rollback on failure
  set((s) => ({
    observations: s.observations.filter((o) => o.id !== id),
  }));
  await apiDelete(`/api/${projectId}/observations/${id}`);
}
```

After (correct rollback):
```typescript
// api/mutations/observations.ts
export function useDeleteObservation(projectId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiDelete(`/api/${projectId}/observations/${id}`),
    onMutate: async (id) => {
      await queryClient.cancelQueries({
        queryKey: queryKeys.observations.byProject(projectId),
      });
      const previous = queryClient.getQueryData<Observation[]>(
        queryKeys.observations.byProject(projectId)
      );
      queryClient.setQueryData<Observation[]>(
        queryKeys.observations.byProject(projectId),
        (old) => old?.filter((o) => o.id !== id)
      );
      return { previous };
    },
    onError: (_err, _id, context) => {
      // Rollback on failure
      queryClient.setQueryData(
        queryKeys.observations.byProject(projectId),
        context?.previous
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({
        queryKey: queryKeys.observations.byProject(projectId),
      });
    },
  });
}
```

#### Stale Time Strategy

| Data Domain | `staleTime` | Rationale |
|-------------|-------------|-----------|
| Health | `10_000` (10s) | Polled status, changes frequently |
| Projects | `60_000` (1min) | Rarely changes, SSE invalidates |
| Extensions | `60_000` (1min) | Changes via install/uninstall, SSE invalidates |
| Vault keys | `Infinity` | Only changes on user action + SSE |
| Sessions | `30_000` (30s) | Active sessions update frequently |
| Intelligence (observations, errors, prompts, tools) | `30_000` (30s) | Background collection, SSE invalidates |
| Config/Settings | `Infinity` | Only changes on explicit save |
| Logs | `0` (always stale) | Always want latest on focus |

#### QueryClient Configuration

See [Prerequisites — QueryClient Singleton](#queryClient-singleton) above for the full configuration. The QueryClient is instantiated as a module-level singleton in `api/query-client.ts`, not inside a React component.

#### File Structure

```
packages/console-ui/src/api/
  client.ts               # Updated — apiGet/apiPost/apiPut/apiDelete accept optional { signal }
  events.ts               # Simplified — SSE → queryClient.invalidateQueries
  query-keys.ts           # Query key factory (new)
  query-client.ts         # QueryClient singleton (new) — imported by both main.tsx and events.ts
  queries/
    projects.ts           # useProjects, useProjectDetail
    extensions.ts         # useExtensions
    vault.ts              # useVaultKeys
    sessions.ts           # useSessions, useSessionTimeline
    observations.ts       # useObservations
    errors.ts             # useErrorPatterns, useErrorTrends
    prompts.ts            # usePrompts, usePromptStats
    tools.ts              # useToolAnalytics, useToolWarnings, useToolRules, useAuditLog
    context-recipes.ts    # useContextRecipe, useRecipePreview
    health.ts             # useHealth
    logs.ts               # useLogs
    mcp.ts                # useMCPStatus
    config.ts             # useConfig
    search.ts             # useSearch
    marketplace.ts        # useMarketplace (replaces MarketplaceTab inline fetch)
  mutations/
    vault.ts              # useSetVaultKey, useDeleteVaultKey
    observations.ts       # useCreateObservation, useUpdateObservation, useDeleteObservation
    errors.ts             # useUpdateErrorPattern
    prompts.ts            # useDeletePrompt
    tools.ts              # useCreateRule, useUpdateRule, useDeleteRule
    context-recipes.ts    # useSaveRecipe
    extensions.ts         # useInstallExtension, useUninstallExtension, etc.
    config.ts             # useUpdateConfig
packages/console-ui/src/hooks/
  useActiveProject.ts     # Combines useProjects query + project-store activeProjectId (new)
```

### Zustand Stores — What Remains

After migration, Zustand stores shrink to **client-only UI state**:

| Store | Keeps | Removes |
|-------|-------|---------|
| `project-store` | `activeProjectId`, `setActiveProject()`, `activeProjectId` validation (see note below) | `projects[]`, `fetchProjects()`, localStorage persist for projects |
| `extension-store` | (delete entirely) | All — replaced by `useExtensions()` query |
| `vault-store` | (delete entirely) | All — replaced by `useVaultKeys()` query + mutations |
| `connection-store` | `status`, `reconnectAttempts` | Unchanged |
| `notification-store` | `toasts`, `updates` | Unchanged |
| `session-store` | `filter` (client-side filter state) | `sessions[]`, `loading`, `error`, `fetchSessions()`, `fetchTimeline()` |
| `observation-store` | (delete entirely) | All — replaced by query + mutations |
| `error-store` | (delete entirely) | All — replaced by queries + mutations |
| `prompt-store` | (delete entirely) | All — replaced by queries + mutations |
| `tool-analytics-store` | (delete entirely) | All — replaced by queries |
| `tool-rules-store` | (delete entirely) | All — replaced by queries + mutations |
| `context-recipe-store` | `debouncedSave` timer state | `recipe`, `loading`, `fetchRecipe()`, `saveRecipe()` |
| `search-store` | `activeFilters` (client-side filter state) | `results`, `loading`, `search()` |

Net result: **8 stores deleted entirely**, 4 stores reduced to minimal client state.

#### Project Store — Derived State Handling

The current `project-store` has validation logic that runs after fetching projects: if the stored `activeProjectId` no longer exists in the project list, it falls back to the first project. This logic sits at the intersection of server state (project list) and client state (selected project).

After migration, this is handled via a custom hook that combines both:

```typescript
// hooks/useActiveProject.ts
export function useActiveProject() {
  const { data: projects } = useProjects();
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);

  // Validate: if stored ID doesn't match any project, reset to first
  const validId =
    activeProjectId && projects?.some((p) => p.id === activeProjectId)
      ? activeProjectId
      : (projects?.[0]?.id ?? null);

  // Sync store if validation changed the value
  useEffect(() => {
    if (validId !== activeProjectId) {
      setActiveProject(validId);
    }
  }, [validId, activeProjectId, setActiveProject]);

  return {
    activeProjectId: validId,
    projects: projects ?? [],
    setActiveProject,
  };
}
```

The `project-store` retains Zustand `persist` middleware for `activeProjectId` only (a single string), so the user's project selection survives page reloads without waiting for the projects query.

#### localStorage Persistence Trade-off

Three stores currently persist server data to localStorage (`project-store`, `extension-store`, `vault-store`). This provides **offline resilience**: if the worker is temporarily down, the UI renders cached data instead of a loading spinner.

After migration, React Query's in-memory cache clears on page reload. This means:
- **First render after reload**: loading spinner until the worker responds (instead of showing cached data)
- **Worker down**: error state instead of stale cached data

This trade-off is **acceptable** because:
1. The Console UI is served by the worker itself — if the worker is down, the SPA can't load at all
2. Stale cached data (project/extension lists from hours ago) is arguably worse than a clear loading state
3. React Query's `staleTime` + `gcTime` provide in-session caching (no redundant fetches during navigation)

If offline resilience becomes a requirement later, React Query supports optional persistence via `@tanstack/query-persist-client-core` + `createSyncStoragePersister`. This can be added incrementally without changing the query/mutation hooks.

### Migration Strategy

Incremental, not big-bang. React Query and Zustand stores can coexist:

1. **Phase A — Foundation**: Add `@tanstack/react-query` + `@tanstack/react-query-devtools`. Update `apiGet`/`apiPost`/`apiPut`/`apiDelete` to accept optional `{ signal }` (backwards-compatible). Create `query-client.ts` (singleton), `query-keys.ts`. Wrap app in `QueryClientProvider` in `main.tsx`.
2. **Phase B — Custom hooks**: Migrate `useFetch`-based hooks (health, MCP, logs, sessions, hooks, API usage) → `useQuery`. Delete `useFetch` hook.
3. **Phase C — Read-only stores + inline fetches**: Migrate read-only stores (tool-analytics, search) and inline component fetches (MarketplaceTab, project-home intelligence stats) → queries. Delete stores.
4. **Phase D — Mutation stores**: Migrate stores with mutations (observations, errors, prompts, tool-rules, vault, context-recipes) → queries + mutations with proper rollback. Delete stores.
5. **Phase E — Core stores + SSE**: Migrate project/extension stores → queries. Create `useActiveProject` hook for derived state. Refactor SSE event handler from store method calls to `queryClient.invalidateQueries()` map. Remove localStorage persistence from project/extension stores.
6. **Phase F — Cleanup**: Remove dead code, delete empty store files, update tests, verify no remaining direct `fetch()` calls outside `client.ts`.

Each phase is independently deployable. The app works correctly at every step.

### DevTools

TanStack React Query Devtools (`@tanstack/react-query-devtools`) provides a floating panel showing all active queries, their status, cache age, and refetch triggers. Included only in dev builds:

```tsx
import { ReactQueryDevtools } from "@tanstack/react-query-devtools";

// In root layout, dev only
{import.meta.env.DEV && <ReactQueryDevtools initialIsOpen={false} />}
```

## Alternatives Considered

### 1. SWR (Vercel)

| Criteria | TanStack Query | SWR |
|----------|---------------|-----|
| Mutation support | First-class `useMutation` with optimistic update/rollback | Manual — `mutate()` for cache, no built-in rollback |
| Query invalidation | `invalidateQueries({ queryKey })` with prefix matching | `mutate(key)` — exact key only, no prefix matching |
| Devtools | Built-in floating panel | Third-party, limited |
| Dependent queries | `enabled` option | `useSWR(() => ready ? key : null)` |
| Bundle size | ~13kB gzipped | ~4kB gzipped |
| TypeScript | Excellent inference | Good |

**Rejected because**: SWR lacks first-class mutation support. Our UI has significant mutation needs (CRUD on observations, rules, vault keys, recipes, prompts) where optimistic updates with rollback are critical. SWR would require us to build the same mutation/rollback patterns manually — defeating the purpose.

### 2. Keep Zustand + Improve Custom Hooks

We could fix the identified problems within the current architecture:
- Add retry logic to `useFetch`
- Fix optimistic rollback in stores
- Add `AbortController` to `useFetch`
- Add request deduplication via a shared cache layer

**Rejected because**: This reinvents React Query. Every fix would replicate a feature that React Query provides out of the box, tested and maintained by a large community. The maintenance cost of a hand-rolled solution grows with every new data domain, while React Query's declarative model scales without additional boilerplate.

### 3. RTK Query (Redux Toolkit)

**Rejected because**: Introducing Redux for server-state management when we already have Zustand for client state adds unnecessary complexity. RTK Query is best suited to projects already using Redux.

### 4. tRPC

**Rejected because**: Requires shared type definitions between client and server. The worker service is a separate package with its own Express routes — tRPC would require a major refactor of the worker API layer and wouldn't work with extension-provided endpoints.

## Consequences

### Positive

- **Eliminates ~400 lines of boilerplate** data-fetching code across 12 stores
- **Automatic request deduplication** — multiple components using `useExtensions(projectId)` share one request
- **Correct optimistic updates** — `useMutation` provides `onMutate`/`onError` rollback, fixing the 3 stores with broken rollback
- **Automatic retry** with exponential backoff — replaces manual "Retry" buttons for transient errors
- **Built-in request cancellation** via `AbortSignal` — no more wasted requests for unmounted components
- **SSE integration simplifies** from ~60 lines of manual store wiring to a declarative invalidation map
- **DevTools** provide real-time visibility into cache state, query timing, and invalidation — significant debugging improvement
- **Stale-while-revalidate** eliminates the flash of loading state on page navigation — cached data shows instantly, fresh data replaces it
- **Scales without boilerplate** — adding a new data domain is one query hook + one key entry, not a new Zustand store

### Negative

- **+13kB gzipped** bundle size increase (React Query + devtools excluded from prod)
- **Learning curve** for contributors unfamiliar with React Query's cache model
- **Two state paradigms** — React Query for server state, Zustand for client state. Clear separation, but contributors must know which to use
- **Migration effort** across 12 stores, 6 hooks, and 15 route components — estimated 6 phases

### Mitigations

- Bundle size: 13kB is offset by removing Zustand persist middleware + localStorage serialization code from 3 stores
- Learning curve: React Query is the most widely adopted React data-fetching library (40k+ GitHub stars, extensive docs). Query key factory + co-located hooks make patterns discoverable
- Two paradigms: The rule is simple — "Does this data come from the server? → React Query. Is this UI-only state? → Zustand."
- Migration effort: Incremental strategy allows each phase to be a separate PR. No big-bang rewrite required

## References

- [ADR-022: Console UI Tech Stack](./022-console-ui-tech-stack.md) — original tech stack decision, notes "React Query or SWR hooks" as intended pattern
- [ADR-023: Realtime Worker-UI Communication](./023-realtime-worker-ui-communication.md) — SSE event model
- [TanStack React Query v5 docs](https://tanstack.com/query/latest)
