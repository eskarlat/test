import { useState, useEffect, useCallback } from "react";
import { apiGet } from "./client";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

export interface HealthData {
  status: string;
  port: number;
  uptime: number;
  memoryUsage: { heapUsed: number; heapTotal: number; rss: number };
  pid?: number;
  version?: string;
  sdkVersion?: string;
}

export interface MCPStatusEntry {
  extensionName: string;
  transport: string;
  status: "connecting" | "connected" | "disconnected" | "error";
  pid?: number;
  url?: string;
  uptime: number;
  error?: string;
}

export interface ActiveSession {
  id: string;
  projectId: string;
  startedAt: string;
  agent: string;
  status: "active" | "ended";
}

export interface HookActivityEntry {
  timestamp: string;
  event: string;
  feature: string;
  extensionName?: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

export interface APIStatRow {
  extension: string;
  action: string;
  calls: number;
  avgLatencyMs: number;
}

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error" | "debug";
  source: string;
  message: string;
}

// ---------------------------------------------------------------------------
// Generic data fetching hook
// ---------------------------------------------------------------------------

interface FetchState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

function useFetch<T>(path: string | null): FetchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const reload = useCallback(() => setRevision((r) => r + 1), []);

  useEffect(() => {
    if (!path) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      const result = await apiGet<T>(path!);
      if (cancelled) return;
      if (result.data !== null) {
        setData(result.data);
      } else {
        // 404 → treat as empty, not an error (endpoint may not exist yet)
        if (result.status === 404) {
          setData(null);
        } else {
          setError(result.error ?? "Request failed");
        }
      }
      setLoading(false);
    }

    void load();
    return () => { cancelled = true; };
  }, [path, revision]);

  return { data, loading, error, reload };
}

// ---------------------------------------------------------------------------
// Named hooks
// ---------------------------------------------------------------------------

export function useHealth(): FetchState<HealthData> {
  return useFetch<HealthData>("/health");
}

export function useMCPStatus(projectId: string | null): FetchState<MCPStatusEntry[]> {
  return useFetch<MCPStatusEntry[]>(projectId ? `/api/${projectId}/mcp/status` : null);
}

export function useSessions(projectId: string | null): FetchState<ActiveSession[]> {
  return useFetch<ActiveSession[]>(projectId ? `/api/${projectId}/sessions` : null);
}

export function useHookActivity(projectId: string | null): FetchState<HookActivityEntry[]> {
  return useFetch<HookActivityEntry[]>(projectId ? `/api/${projectId}/hooks/activity` : null);
}

export function useAPIUsage(projectId: string | null): FetchState<APIStatRow[]> {
  return useFetch<APIStatRow[]>(projectId ? `/api/${projectId}/stats/api` : null);
}

export function useLogs(projectId: string | null, limit = 10): FetchState<LogEntry[]> {
  const path = projectId
    ? `/api/${projectId}/logs?limit=${limit}`
    : `/api/logs?limit=${limit}`;
  return useFetch<LogEntry[]>(path);
}
