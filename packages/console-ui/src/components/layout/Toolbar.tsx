import { Link, useNavigate } from "react-router";
import { useState, useEffect } from "react";
import { KeyRound, Settings, ChevronDown, Menu, Sun, Moon } from "lucide-react";
import { useProjectStore } from "../../stores/project-store";
import { ConnectionStatus } from "./ConnectionStatus";
import { SearchPalette } from "../intelligence/SearchPalette";

function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  return { dark, toggle: () => setDark((v) => !v) };
}

interface ToolbarProps {
  onMenuToggle?: () => void;
}

export function Toolbar({ onMenuToggle }: ToolbarProps) {
  const projects = useProjectStore((s) => s.projects);
  const activeProjectId = useProjectStore((s) => s.activeProjectId);
  const setActiveProject = useProjectStore((s) => s.setActiveProject);
  const navigate = useNavigate();
  const theme = useTheme();

  function handleProjectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const value = e.target.value;
    if (value === "") {
      setActiveProject(null);
      void navigate("/");
    } else {
      setActiveProject(value);
      void navigate(`/${value}`);
    }
  }

  return (
    <header className="h-14 flex items-center px-3 md:px-4 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 flex-shrink-0 gap-2 md:gap-4">
      {/* Mobile menu button */}
      <button
        onClick={onMenuToggle}
        className="md:hidden p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        aria-label="Toggle menu"
      >
        <Menu className="h-5 w-5" />
      </button>

      {/* Left: Project dropdown */}
      <div className="relative flex items-center min-w-0 flex-1 md:flex-none">
        <select
          value={activeProjectId ?? ""}
          onChange={handleProjectChange}
          className="appearance-none bg-muted border border-border rounded-md pl-3 pr-8 py-1.5 text-sm font-medium text-foreground focus:outline-none focus:ring-2 focus:ring-ring cursor-pointer w-full md:min-w-48"
          aria-label="Select project"
        >
          <option value="">No project selected</option>
          {projects.map((project) => (
            <option key={project.id} value={project.id}>
              {project.name}
            </option>
          ))}
        </select>
        <ChevronDown
          className="absolute right-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none"
          aria-hidden="true"
        />
      </div>

      <div className="flex-1" />

      {/* Right: Connection status + Search + Theme + Vault + Settings */}
      <div className="flex items-center gap-3 flex-shrink-0">
        <ConnectionStatus />
        <SearchPalette projectId={activeProjectId} />
        <button
          onClick={theme.toggle}
          className="flex items-center text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Toggle theme"
          title={theme.dark ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme.dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
        </button>
        <Link
          to="/vault"
          className="hidden md:flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm"
          aria-label="Vault"
          title="Vault"
        >
          <KeyRound className="h-4 w-4" aria-hidden="true" />
        </Link>
        <Link
          to="/settings"
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm"
          aria-label="Settings"
          title="Settings"
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
        </Link>
      </div>
    </header>
  );
}
