import { cn } from "../../../lib/utils";

function getTrendClass(trend: number): string {
  if (trend > 0) return "text-green-600";
  if (trend < 0) return "text-red-500";
  return "text-muted-foreground";
}

function getTrendArrow(trend: number): string {
  if (trend > 0) return "↑";
  if (trend < 0) return "↓";
  return "→";
}

function TrendBadge({ trend }: { trend: number }) {
  return (
    <p className={cn("mt-1 text-xs font-medium", getTrendClass(trend))}>
      {getTrendArrow(trend)} {Math.abs(trend)}%
    </p>
  );
}

interface StatsCardProps {
  label: string;
  value: string | number;
  trend?: number;
  icon?: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

export function StatsCard({ label, value, trend, icon, onClick, className }: StatsCardProps) {
  const isClickable = onClick !== undefined;

  return (
    <div
      role={isClickable ? "button" : undefined}
      tabIndex={isClickable ? 0 : undefined}
      onClick={onClick}
      onKeyDown={
        isClickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") onClick();
            }
          : undefined
      }
      className={cn(
        "rounded-lg border border-border bg-card p-4",
        isClickable &&
          "cursor-pointer hover:border-ring hover:shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-ring",
        className
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">
            {label}
          </p>
          <p className="mt-1 text-2xl font-bold text-foreground tabular-nums">{value}</p>
          {trend !== undefined && (
            <TrendBadge trend={trend} />
          )}
        </div>
        {icon && (
          <div className="flex-shrink-0 text-muted-foreground">{icon}</div>
        )}
      </div>
    </div>
  );
}
