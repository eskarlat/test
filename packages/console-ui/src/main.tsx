import { StrictMode, lazy, Suspense } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, Outlet } from "react-router";
import "./globals.css";
import { Toolbar } from "./components/layout/Toolbar";
import { Sidebar } from "./components/layout/Sidebar";
import { GlobalErrorBoundary } from "./components/layout/ContentArea";
import { ReconnectionBanner } from "./components/layout/ReconnectionBanner";
import { ToastContainer } from "./components/ui/ToastContainer";
import { Skeleton } from "./components/ui/Skeleton";
import { useWorkerEvents } from "./api/events";
import { BASE_URL } from "./api/client";
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
  useWorkerEvents(BASE_URL);

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <Sidebar />
      <div className="flex flex-col flex-1 min-w-0">
        <Toolbar />
        <ReconnectionBanner />
        <main className="flex-1 overflow-y-auto p-6">
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
