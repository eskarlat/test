import { cn } from "../../../lib/utils";

interface BadgeDecisionProps {
  decision: "deny" | "ask" | "allow";
}

const decisionClassMap: Record<string, string> = {
  deny: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  ask: "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400",
  allow: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
};

export function BadgeDecision({ decision }: BadgeDecisionProps) {
  const cls = decisionClassMap[decision] ?? "bg-muted text-muted-foreground";

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold uppercase tracking-wide",
        cls
      )}
    >
      {decision}
    </span>
  );
}

interface BadgeIntentProps {
  intent: string;
}

const intentColorMap: Record<string, string> = {
  code: "bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-400",
  explain: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  debug: "bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400",
  test: "bg-cyan-100 text-cyan-700 dark:bg-cyan-900/30 dark:text-cyan-400",
  refactor: "bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-400",
  review: "bg-pink-100 text-pink-700 dark:bg-pink-900/30 dark:text-pink-400",
  general: "bg-muted text-muted-foreground",
};

export function BadgeIntent({ intent }: BadgeIntentProps) {
  const cls = intentColorMap[intent.toLowerCase()] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        cls
      )}
    >
      {intent}
    </span>
  );
}

interface BadgeAgentProps {
  agent: string;
}

export function BadgeAgent({ agent }: BadgeAgentProps) {
  const display = agent.length > 14 ? agent.slice(0, 14) + "…" : agent;
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-accent text-accent-foreground">
      {display}
    </span>
  );
}

interface BadgeStatusProps {
  status: string;
}

const statusColorMap: Record<string, string> = {
  active: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  ended: "bg-muted text-muted-foreground",
  resolved: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  ignored: "bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400",
  connected: "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400",
  disconnected: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
  error: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

export function BadgeStatus({ status }: BadgeStatusProps) {
  const cls = statusColorMap[status.toLowerCase()] ?? "bg-muted text-muted-foreground";
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium",
        cls
      )}
    >
      {status}
    </span>
  );
}
