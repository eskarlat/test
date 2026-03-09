import { NavLink } from "react-router";
import { cn } from "../../../lib/utils";

interface Breadcrumb {
  label: string;
  to?: string | undefined;
}

interface PageHeaderProps {
  title: string;
  description?: string | undefined;
  actions?: React.ReactNode | undefined;
  breadcrumbs?: Breadcrumb[] | undefined;
}

export function PageHeader({ title, description, actions, breadcrumbs }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        {breadcrumbs && breadcrumbs.length > 0 && (
          <nav className="flex items-center gap-1 mb-1" aria-label="Breadcrumb">
            {breadcrumbs.map((crumb, i) => (
              <span key={i} className="flex items-center gap-1">
                {i > 0 && (
                  <span className="text-muted-foreground text-xs">/</span>
                )}
                {crumb.to ? (
                  <NavLink
                    to={crumb.to}
                    className={cn(
                      "text-xs text-muted-foreground hover:text-foreground transition-colors"
                    )}
                  >
                    {crumb.label}
                  </NavLink>
                ) : (
                  <span className="text-xs text-muted-foreground">{crumb.label}</span>
                )}
              </span>
            ))}
          </nav>
        )}
        <h1 className="text-2xl font-bold text-foreground">{title}</h1>
        {description && (
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && (
        <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>
      )}
    </div>
  );
}
