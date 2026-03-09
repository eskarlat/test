import { Link } from "react-router";
import { ArrowRight, CheckCircle2, AlertCircle } from "lucide-react";
import type { ActiveProject } from "../../stores/project-store";

interface ProjectCardProps {
  project: ActiveProject;
}

export function ProjectCard({ project }: ProjectCardProps) {
  const healthyCount = project.mountedExtensions.filter((e) => e.status === "healthy").length;
  const problemCount = project.mountedExtensions.filter((e) => e.status !== "healthy").length;

  return (
    <div className="rounded-lg border border-border p-4 bg-card hover:bg-accent/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-semibold text-foreground truncate">{project.name}</h3>
          <p className="text-xs text-muted-foreground font-mono truncate mt-0.5">{project.path}</p>
          <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-muted-foreground">
            <span>{project.extensionCount} extension{project.extensionCount !== 1 ? "s" : ""}</span>
            {healthyCount > 0 && (
              <span className="flex items-center gap-1 text-green-600">
                <CheckCircle2 className="h-3 w-3" aria-hidden="true" />
                {healthyCount} healthy
              </span>
            )}
            {problemCount > 0 && (
              <span className="flex items-center gap-1 text-yellow-600">
                <AlertCircle className="h-3 w-3" aria-hidden="true" />
                {problemCount} need attention
              </span>
            )}
          </div>
        </div>
        <Link
          to={`/${project.id}`}
          className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline flex-shrink-0"
          aria-label={`Open project ${project.name}`}
        >
          Open <ArrowRight className="h-3 w-3" aria-hidden="true" />
        </Link>
      </div>
    </div>
  );
}
