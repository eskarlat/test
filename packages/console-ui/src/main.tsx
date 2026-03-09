import { StrictMode, lazy, Suspense, useEffect, useState, useCallback } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Outlet } from "react-router";
import "./globals.css";
import { Toolbar } from "./components/layout/Toolbar";
import { Sidebar } from "./components/layout/Sidebar";
import { GlobalErrorBoundary } from "./components/layout/ContentArea";
import { ReconnectionBanner } from "./components/layout/ReconnectionBanner";
import { ToastContainer } from "./components/ui/ToastContainer";
import { Skeleton } from "./components/ui/Skeleton";
import { useSystemEvents, useProjectEvents } from "./api/events";
import { useSocketStore } from "./api/socket";
import { BASE_URL } from "./api/client";
import { useProjectStore } from "./stores/project-store";
import SystemHome from "./routes/home";

const VaultPage = lazy(() => import("./routes/vault"));
const ExtensionsPage = lazy(() => import("./routes/extensions"));
const LogsPage = lazy(() => import("./routes/logs"));
const SettingsPage = lazy(() => import("./routes/settings"));
const ProjectHomePage = lazy(() => import("./routes/project-home"));
const ExtensionPageRoute = lazy(() => import("./routes/extension-page"));
const SessionListPage = lazy(() => import("./routes/sessions/index"));
const SessionTimelinePage = lazy(() => import("./routes/sessions/detail"));
const ObservationsPage = lazy(() => import("./routes/observations"));
const ToolGovernancePage = lazy(() => import("./routes/tool-governance"));
const PromptsPage = lazy(() => import("./routes/prompts"));
const ErrorsPage = lazy(() => import("./routes/errors"));
const ToolAnalyticsPage = lazy(() => import("./routes/tools"));
const ContextRecipesPage = lazy(() => import("./routes/context-recipes"));
const SearchPage = lazy(() => import("./routes/search"));
const ChatPage = lazy(() => import("./routes/chat"));
const WorktreesPage = lazy(() => import("./routes/worktrees"));
const AutomationsPage = lazy(() => import("./routes/automations"));
const AutomationEditorPage = lazy(() => import("./routes/automation-editor"));
const AutomationRunsPage = lazy(() => import("./routes/automation-runs"));
const AutomationRunDetailPage = lazy(() => import("./routes/automation-run-detail"));

function PageSkeleton() {
  return (
    <div className="p-6 space-y-4 max-w-3xl">
      <Skeleton className="h-8 w-64" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
}

function RootLayout() {
  const connect = useSocketStore((s) => s.connect);
  const disconnect = useSocketStore((s) => s.disconnect);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const toggleSidebar = useCallback(() => setSidebarOpen((v) => !v), []);
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);

  // Sync dark/light class with system preference
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function apply(e: MediaQueryList | MediaQueryListEvent) {
      document.documentElement.classList.toggle("dark", e.matches);
    }
    apply(mq);
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  // Initialize Socket.IO connection
  useEffect(() => {
    connect(BASE_URL);
    return () => disconnect();
  }, [connect, disconnect]);

  // Subscribe to system and project events
  useSystemEvents();
  useProjectEvents(activeProjectId);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}
      <div
        className={`fixed inset-y-0 left-0 z-50 transform transition-transform duration-200 md:relative md:translate-x-0 ${sidebarOpen ? "translate-x-0" : "-translate-x-full"}`}
      >
        <Sidebar onNavigate={closeSidebar} />
      </div>
      <div className="flex flex-col flex-1 min-w-0">
        <Toolbar onMenuToggle={toggleSidebar} />
        <ReconnectionBanner />
        <main className="flex-1 overflow-y-auto p-4 md:p-6">
          <GlobalErrorBoundary>
            <Suspense fallback={<PageSkeleton />}>
              <Outlet />
            </Suspense>
          </GlobalErrorBoundary>
        </main>
      </div>
      <ToastContainer />
    </div>
  );
}

const router = createBrowserRouter([
  {
    path: "/",
    element: <RootLayout />,
    children: [
      { index: true, element: <SystemHome /> },
      { path: "vault", element: <VaultPage /> },
      { path: "extensions", element: <ExtensionsPage /> },
      { path: "extensions/settings/:extensionName", element: <ExtensionsPage /> },
      { path: "logs", element: <LogsPage /> },
      { path: "settings", element: <SettingsPage /> },
      { path: ":projectId", element: <ProjectHomePage /> },
      { path: ":projectId/sessions", element: <SessionListPage /> },
      { path: ":projectId/sessions/:sessionId", element: <SessionTimelinePage /> },
      { path: ":projectId/observations", element: <ObservationsPage /> },
      { path: ":projectId/tool-governance", element: <ToolGovernancePage /> },
      { path: ":projectId/prompts", element: <PromptsPage /> },
      { path: ":projectId/errors", element: <ErrorsPage /> },
      { path: ":projectId/tools", element: <ToolAnalyticsPage /> },
      { path: ":projectId/context-recipes", element: <ContextRecipesPage /> },
      { path: ":projectId/search", element: <SearchPage /> },
      { path: ":projectId/chat", element: <ChatPage /> },
      { path: ":projectId/chat/:sessionId", element: <ChatPage /> },
      { path: ":projectId/worktrees", element: <WorktreesPage /> },
      { path: ":projectId/automations", element: <AutomationsPage /> },
      { path: ":projectId/automations/new", element: <AutomationEditorPage /> },
      { path: ":projectId/automations/:id/edit", element: <AutomationEditorPage /> },
      { path: ":projectId/automations/:id/runs", element: <AutomationRunsPage /> },
      { path: ":projectId/automations/:id/runs/:runId", element: <AutomationRunDetailPage /> },
      { path: ":projectId/:extensionName/:pageId", element: <ExtensionPageRoute /> },
    ],
  },
]);

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

createRoot(rootEl).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>
);
