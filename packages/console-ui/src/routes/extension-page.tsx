import { useParams } from "react-router";
import { useProjectStore } from "../stores/project-store";
import { useExtensionStore } from "../stores/extension-store";
import { ExtensionLoader } from "../components/extensions/ExtensionLoader";
import { BASE_URL } from "../api/client";
import { AlertCircle } from "lucide-react";

export default function ExtensionPageRoute() {
  const { projectId, extensionName, pageId } = useParams<{
    projectId: string;
    extensionName: string;
    pageId: string;
  }>();

  const projects = useProjectStore((s) => s.projects);
  const getExtensionsForProject = useExtensionStore((s) => s.getExtensionsForProject);

  if (!projectId || !extensionName || !pageId) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        Invalid route parameters.
      </div>
    );
  }

  const project = projects.find((p) => p.id === projectId);
  if (!project) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        Project not found.
      </div>
    );
  }

  const extensions = getExtensionsForProject(projectId);
  const ext = extensions.find((e) => e.name === extensionName);

  if (!ext) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <AlertCircle className="h-4 w-4" aria-hidden="true" />
        Extension <strong className="ml-1">{extensionName}</strong> is not mounted.
      </div>
    );
  }

  const apiBaseUrl = `${BASE_URL}/api/${projectId}/${extensionName}`;

  return (
    <ExtensionLoader
      extensionName={extensionName}
      version={ext.version}
      pageId={pageId}
      baseUrl={BASE_URL}
      projectId={projectId}
      apiBaseUrl={apiBaseUrl}
    />
  );
}
