import { Suspense, lazy, useMemo } from "react";
import type { ExtensionPageProps } from "@renre-kit/extension-sdk";
import { Skeleton } from "../ui/Skeleton";
import { ExtensionErrorBoundary } from "./ExtensionErrorBoundary";
import { loadExtensionModule } from "../../lib/extension-loader";

interface ExtensionLoaderProps extends ExtensionPageProps {
  extensionName: string;
  version: string;
  pageId: string;
  baseUrl: string;
}

export function ExtensionLoader({
  extensionName,
  version,
  pageId,
  baseUrl,
  projectId,
  apiBaseUrl,
}: ExtensionLoaderProps) {
  const PageComponent = useMemo(
    () =>
      lazy(async () => {
        const module = await loadExtensionModule(extensionName, version, baseUrl);
        const page = module.pages[pageId];
        if (!page) {
          throw new Error(`Page "${pageId}" not found in extension "${extensionName}"`);
        }
        return { default: page };
      }),
    [extensionName, version, pageId, baseUrl]
  );

  return (
    <ExtensionErrorBoundary extensionName={extensionName}>
      <Suspense
        fallback={
          <div className="space-y-3 p-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-32 w-full" />
          </div>
        }
      >
        <PageComponent
          projectId={projectId}
          extensionName={extensionName}
          apiBaseUrl={apiBaseUrl}
        />
      </Suspense>
    </ExtensionErrorBoundary>
  );
}
