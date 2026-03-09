import { useEffect, useState, useCallback } from "react";
import { useParams, useNavigate } from "react-router";
import {
  Puzzle,
  Wifi,
  Users,
  Zap,
  BarChart2,
  ScrollText,
  Eye,
  MessageSquare,
  AlertCircle,
  Wrench,
  Shield,
} from "lucide-react";
import { Skeleton } from "../components/ui/Skeleton";
import { ExtensionStatusList } from "../components/dashboard/ExtensionStatusList";
import { MCPStatus } from "../components/dashboard/MCPStatus";
import { SessionList } from "../components/dashboard/SessionList";
import { HookActivity } from "../components/dashboard/HookActivity";
import { APIUsage } from "../components/dashboard/APIUsage";
import { RecentLogs } from "../components/dashboard/RecentLogs";
import { apiGet } from "../api/client";
import { useProjectStore } from "../stores/project-store";
import { useExtensionStore, type MountedExtension } from "../stores/extension-store";
import { StatsCard } from "../components/intelligence/shared/StatsCard";

interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  registeredAt?: string;
}

interface DashboardCardProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
}

function DashboardCard({ icon, title, children }: DashboardCardProps) {
  return (
    <div className="rounded-lg border border-border bg-card flex flex-col min-h-0">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <span className="text-muted-foreground" aria-hidden="true">{icon}</span>
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <div className="p-4 flex-1 overflow-auto">{children}</div>
    </div>
  );
}

interface IntelligenceStats {
  sessions: number;
  observations: number;
  errors: number;
  prompts: number;
  rules: number;
  toolTotal: number;
}

export default function ProjectHomePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const projects = useProjectStore((s) => s.projects);
  const getExtensionsForProject = useExtensionStore((s) => s.getExtensionsForProject);
  const fetchExtensions = useExtensionStore((s) => s.fetchExtensions);
  const navigate = useNavigate();

  const [projectInfo, setProjectInfo] = useState<ProjectInfo | null>(null);
  const [projectLoading, setProjectLoading] = useState(true);
  const [extLoading, setExtLoading] = useState(true);
  const [extError, setExtError] = useState<string | null>(null);
  const [intStats, setIntStats] = useState<IntelligenceStats | null>(null);

  const project = projects.find((p) => p.id === projectId);
  const extensions: MountedExtension[] = projectId ? getExtensionsForProject(projectId) : [];

  useEffect(() => {
    async function load() {
      if (!projectId) return;
      const result = await apiGet<ProjectInfo>(`/api/projects/${projectId}`);
      if (result.data) setProjectInfo(result.data);
      setProjectLoading(false);
    }
    void load();
  }, [projectId]);

  useEffect(() => {
    async function loadIntelligence() {
      if (!projectId) return;
      const [sessions, observations, errors, promptStats, rules, toolAnalytics] =
        await Promise.all([
          apiGet<unknown[]>(`/api/${projectId}/sessions`),
          apiGet<unknown[]>(`/api/${projectId}/observations`),
          apiGet<unknown[]>(`/api/${projectId}/errors`),
          apiGet<{ total: number }>(`/api/${projectId}/prompts/stats`),
          apiGet<unknown[]>(`/api/${projectId}/tool-rules`),
          apiGet<{ totalCount: number }>(`/api/${projectId}/tool-analytics`),
        ]);
      setIntStats({
        sessions: Array.isArray(sessions.data) ? sessions.data.length : 0,
        observations: Array.isArray(observations.data) ? observations.data.length : 0,
        errors: Array.isArray(errors.data) ? errors.data.length : 0,
        prompts: promptStats.data?.total ?? 0,
        rules: Array.isArray(rules.data) ? rules.data.length : 0,
        toolTotal: toolAnalytics.data?.totalCount ?? 0,
      });
    }
    void loadIntelligence();
  }, [projectId]);

  const loadExtensions = useCallback(async () => {
    if (!projectId) return;
    setExtLoading(true);
    setExtError(null);
    try {
      await fetchExtensions(projectId);
    } catch {
      setExtError("Failed to load extensions");
    }
    setExtLoading(false);
  }, [projectId, fetchExtensions]);

  useEffect(() => {
    void loadExtensions();
  }, [loadExtensions]);

  if (!projectId) return null;

  const projectName = projectInfo?.name ?? project?.name ?? projectId;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        {projectLoading ? (
          <Skeleton className="h-8 w-48" />
        ) : (
          <h1 className="text-2xl font-bold text-foreground">{projectName}</h1>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatsCard
          label="Sessions"
          value={intStats?.sessions ?? 0}
          icon={<Users className="h-4 w-4" />}
          onClick={() => void navigate(`/${projectId}/sessions`)}
        />
        <StatsCard
          label="Observations"
          value={intStats?.observations ?? 0}
          icon={<Eye className="h-4 w-4" />}
          onClick={() => void navigate(`/${projectId}/observations`)}
        />
        <StatsCard
          label="Prompts"
          value={intStats?.prompts ?? 0}
          icon={<MessageSquare className="h-4 w-4" />}
          onClick={() => void navigate(`/${projectId}/prompts`)}
        />
        <StatsCard
          label="Errors"
          value={intStats?.errors ?? 0}
          icon={<AlertCircle className="h-4 w-4" />}
          onClick={() => void navigate(`/${projectId}/errors`)}
        />
        <StatsCard
          label="Tool Rules"
          value={intStats?.rules ?? 0}
          icon={<Shield className="h-4 w-4" />}
          onClick={() => void navigate(`/${projectId}/tool-governance`)}
        />
        <StatsCard
          label="Tool Uses"
          value={intStats?.toolTotal ?? 0}
          icon={<Wrench className="h-4 w-4" />}
          onClick={() => void navigate(`/${projectId}/tools`)}
        />
      </div>

      {/* Main grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DashboardCard
          icon={<Puzzle className="h-4 w-4" />}
          title={`Extensions (${extensions.length})`}
        >
          <ExtensionStatusList
            extensions={extensions}
            projectId={projectId}
            loading={extLoading}
            error={extError}
            onRetry={() => void loadExtensions()}
          />
        </DashboardCard>

        <DashboardCard
          icon={<Users className="h-4 w-4" />}
          title="Active Sessions"
        >
          <SessionList projectId={projectId} />
        </DashboardCard>

        <DashboardCard
          icon={<Wifi className="h-4 w-4" />}
          title="MCP Connections"
        >
          <MCPStatus projectId={projectId} />
        </DashboardCard>

        <DashboardCard
          icon={<Zap className="h-4 w-4" />}
          title="Hook Activity"
        >
          <HookActivity projectId={projectId} />
        </DashboardCard>

        <DashboardCard
          icon={<BarChart2 className="h-4 w-4" />}
          title="API Usage (last hour)"
        >
          <APIUsage projectId={projectId} />
        </DashboardCard>

        <DashboardCard
          icon={<ScrollText className="h-4 w-4" />}
          title="Recent Logs"
        >
          <RecentLogs projectId={projectId} />
        </DashboardCard>
      </div>
    </div>
  );
}
