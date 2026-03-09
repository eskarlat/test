import { Link, NavLink } from "react-router";
import {
  LayoutDashboard,
  Puzzle,
  ScrollText,
  CheckCircle2,
  Info,
  XCircle,
  ChevronDown,
  ChevronRight,
  Shield,
  Users,
  Eye,
  MessageSquare,
  AlertCircle,
  Wrench,
  BookOpen,
  Search,
} from "lucide-react";
import { useState } from "react";
import { cn } from "../../lib/utils";
import { useProjectStore } from "../../stores/project-store";
import { useExtensionStore } from "../../stores/extension-store";

interface StatusIconProps {
  status: string;
}

function StatusIcon({ status }: StatusIconProps) {
  if (status === "healthy") {
    return <CheckCircle2 className="h-3.5 w-3.5 text-green-500 flex-shrink-0" aria-label="Healthy" />;
  }
  if (status === "needs-setup" || status === "needs_setup") {
    return <Info className="h-3.5 w-3.5 text-yellow-500 flex-shrink-0" aria-label="Needs setup" />;
  }
  if (status === "error") {
    return <XCircle className="h-3.5 w-3.5 text-red-500 flex-shrink-0" aria-label="Error" />;
  }
  return null;
}

interface ExtensionSectionProps {
  projectId: string;
  extensionName: string;
  displayName: string;
  status: string;
  pages: Array<{ id: string; label: string; path: string }>;
}

function ExtensionSection({
  projectId,
  extensionName,
  displayName,
  status,
  pages,
}: ExtensionSectionProps) {
  const [expanded, setExpanded] = useState(true);

  return (
    <div>
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide hover:text-foreground transition-colors"
      >
        {expanded ? (
          <ChevronDown className="h-3 w-3" aria-hidden="true" />
        ) : (
          <ChevronRight className="h-3 w-3" aria-hidden="true" />
        )}
        <span className="flex-1 text-left truncate">{displayName}</span>
        <StatusIcon status={status} />
      </button>
      {expanded && (
        <div className="ml-3">
          {pages.map((page) => (
            <NavLink
              key={page.id}
              to={`/${projectId}/${extensionName}/${page.id}`}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-colors",
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
                )
              }
            >
              {page.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

const navLinkClass = ({ isActive }: { isActive: boolean }) =>
  cn(
    "flex items-center gap-2.5 px-3 py-2 rounded-md text-sm transition-colors",
    isActive
      ? "bg-accent text-accent-foreground font-medium"
      : "text-muted-foreground hover:text-foreground hover:bg-accent/50"
  );

export function Sidebar() {
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const getExtensionsForProject = useExtensionStore((s) => s.getExtensionsForProject);

  const extensions = activeProjectId ? getExtensionsForProject(activeProjectId) : [];
  const extensionsWithUI = extensions.filter(
    (ext) => ext.ui?.pages && ext.ui.pages.length > 0
  );

  return (
    <aside className="w-56 flex-shrink-0 border-r border-border bg-background flex flex-col overflow-y-auto">
      {/* Logo */}
      <Link
        to="/"
        className="flex items-center gap-2 px-4 h-14 border-b border-border font-semibold text-foreground hover:opacity-80 transition-opacity flex-shrink-0"
      >
        <span className="text-sm font-bold tracking-tight">RenRe Kit</span>
      </Link>

      <nav className="flex-1 py-4 space-y-1 px-2" aria-label="Primary navigation">
        {/* Core items — shown when a project is active */}
        {activeProjectId && (
          <>
            <NavLink to={`/${activeProjectId}`} end className={navLinkClass}>
              <LayoutDashboard className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              Dashboard
            </NavLink>

            <NavLink to={`/${activeProjectId}/sessions`} className={navLinkClass}>
              <Users className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              Sessions
            </NavLink>
            <NavLink to={`/${activeProjectId}/observations`} className={navLinkClass}>
              <Eye className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              Observations
            </NavLink>
            <NavLink to={`/${activeProjectId}/prompts`} className={navLinkClass}>
              <MessageSquare className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              Prompts
            </NavLink>
            <NavLink to={`/${activeProjectId}/errors`} className={navLinkClass}>
              <AlertCircle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              Errors
            </NavLink>
            <NavLink to={`/${activeProjectId}/tools`} className={navLinkClass}>
              <Wrench className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              Tool Analytics
            </NavLink>
            <NavLink to={`/${activeProjectId}/context-recipes`} className={navLinkClass}>
              <BookOpen className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              Context Recipes
            </NavLink>
            <NavLink to={`/${activeProjectId}/search`} className={navLinkClass}>
              <Search className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              Search
            </NavLink>
            <NavLink to={`/${activeProjectId}/tool-governance`} className={navLinkClass}>
              <Shield className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
              Tool Governance
            </NavLink>

            {/* Extension sections */}
            {extensionsWithUI.length > 0 && (
              <div className="pt-2 space-y-0.5">
                <div className="px-3 py-1 text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Extensions
                </div>
                {extensionsWithUI.map((ext) => (
                  <ExtensionSection
                    key={ext.name}
                    projectId={activeProjectId}
                    extensionName={ext.name}
                    displayName={ext.displayName ?? ext.name}
                    status={ext.status}
                    pages={ext.ui!.pages}
                  />
                ))}
              </div>
            )}

            <div className="pt-2 border-t border-border space-y-0.5">
              <NavLink to="/extensions" className={navLinkClass}>
                <Puzzle className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                Extension Manager
              </NavLink>
              <NavLink to="/logs" className={navLinkClass}>
                <ScrollText className="h-4 w-4 flex-shrink-0" aria-hidden="true" />
                Logs
              </NavLink>
            </div>
          </>
        )}

        {/* When no project selected — show minimal navigation */}
        {!activeProjectId && (
          <div className="px-3 py-2 text-sm text-muted-foreground">
            Select a project to see navigation
          </div>
        )}
      </nav>
    </aside>
  );
}
