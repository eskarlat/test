import { useEffect } from "react";
import { FolderOpen, Activity, Terminal } from "lucide-react";
import { ServerStatus } from "../components/dashboard/ServerStatus";
import { ProjectCard } from "../components/dashboard/ProjectCard";
import { ActivityFeed } from "../components/dashboard/ActivityFeed";
import { useProjectStore } from "../stores/project-store";

function ActiveProjects() {
  const projects = useProjectStore((s) => s.projects);
  const fetchProjects = useProjectStore((s) => s.fetchProjects);

  // Load on mount; SSE events keep the store fresh after that
  useEffect(() => {
    void fetchProjects();
  }, [fetchProjects]);

  if (projects.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border p-6 text-center">
        <FolderOpen className="h-8 w-8 text-muted-foreground mx-auto mb-2" aria-hidden="true" />
        <p className="text-sm font-medium text-foreground">No projects running</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Start a project to see it here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {projects.map((project) => (
        <ProjectCard key={project.id} project={project} />
      ))}
    </div>
  );
}

export default function SystemHome() {
  return (
    <div className="max-w-3xl mx-auto space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">RenRe Kit Console</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Monitor and manage your AI agent context services.
        </p>
      </div>

      {/* Server status — loads independently */}
      <section aria-labelledby="server-status-heading">
        <h2 id="server-status-heading" className="text-sm font-semibold text-foreground mb-3 sr-only">
          Server Status
        </h2>
        <ServerStatus />
      </section>

      {/* Active projects */}
      <section aria-labelledby="projects-heading">
        <div className="flex items-center gap-2 mb-3">
          <FolderOpen className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 id="projects-heading" className="text-sm font-semibold text-foreground">
            Active Projects
          </h2>
        </div>
        <ActiveProjects />
      </section>

      {/* Recent activity */}
      <section aria-labelledby="activity-heading">
        <div className="flex items-center gap-2 mb-3">
          <Activity className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <h2 id="activity-heading" className="text-sm font-semibold text-foreground">
            Recent Activity
          </h2>
        </div>
        <ActivityFeed />
      </section>

      {/* Getting started guidance */}
      <section
        aria-labelledby="getting-started-heading"
        className="rounded-lg border border-dashed border-border p-5"
      >
        <div className="flex items-start gap-3">
          <Terminal className="h-5 w-5 text-muted-foreground flex-shrink-0 mt-0.5" aria-hidden="true" />
          <div>
            <h2 id="getting-started-heading" className="text-sm font-semibold text-foreground">
              No projects running?
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Run these commands in your project directory:
            </p>
            <div className="mt-2 space-y-1">
              <code className="block text-xs font-mono bg-muted rounded px-3 py-1.5 text-foreground">
                renre-kit init
              </code>
              <code className="block text-xs font-mono bg-muted rounded px-3 py-1.5 text-foreground">
                renre-kit start
              </code>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
