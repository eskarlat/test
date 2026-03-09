/* eslint-disable sonarjs/void-use */
import { useEffect, useRef, useCallback } from "react";
import { useExtensionStore } from "../stores/extension-store";
import { useProjectStore } from "../stores/project-store";
import { useNotificationStore } from "../stores/notification-store";
import { useVaultStore } from "../stores/vault-store";
import { useConnectionStore } from "../stores/connection-store";
import { invalidateExtensionModule } from "../lib/extension-loader";
import { useSessionStore } from "../stores/session-store";
import { useObservationStore } from "../stores/observation-store";
import { useErrorStore } from "../stores/error-store";
import { usePromptStore } from "../stores/prompt-store";
import { useToolAnalyticsStore } from "../stores/tool-analytics-store";

// Reconnection delay schedule per ADR-045:
// attempt 1: immediate, 2: 1s, 3: 3s, 4+: 5s max
function getReconnectDelay(attempt: number): number {
  if (attempt <= 1) return 0;
  if (attempt === 2) return 1000;
  if (attempt === 3) return 3000;
  return 5000;
}

export function useWorkerEvents(workerBaseUrl: string): void {
  const sourceRef = useRef<EventSource | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attemptRef = useRef(0);
  const mountedRef = useRef(true);

  const connect = useCallback(() => {
    if (!mountedRef.current) return;

    const connectionStore = useConnectionStore.getState();

    // If we're past attempt 1, mark as reconnecting
    if (attemptRef.current > 0) {
      connectionStore.setStatus("reconnecting");
      connectionStore.incrementReconnectAttempts();
      // After 3 consecutive failures → disconnected
      if (connectionStore.reconnectAttempts >= 3) {
        connectionStore.setStatus("disconnected");
      }
    }

    if (sourceRef.current) {
      sourceRef.current.close();
      sourceRef.current = null;
    }

    const source = new EventSource(`${workerBaseUrl}/api/events`);
    sourceRef.current = source;

    source.onopen = () => {
      if (!mountedRef.current) return;
      attemptRef.current = 0;
      const store = useConnectionStore.getState();
      store.setStatus("connected");
      store.resetReconnectAttempts();

      // On reconnect, refresh all stores to fill gaps
      void useProjectStore.getState().fetchProjects();
      const { activeProjectId } = useProjectStore.getState();
      if (activeProjectId) {
        void useExtensionStore.getState().fetchExtensions(activeProjectId);
      }
      void useVaultStore.getState().fetchKeys();
    };

    source.onerror = () => {
      if (!mountedRef.current) return;
      source.close();
      sourceRef.current = null;

      attemptRef.current += 1;
      const delay = getReconnectDelay(attemptRef.current);

      reconnectTimerRef.current = setTimeout(() => {
        if (mountedRef.current) {
          connect();
        }
      }, delay);
    };

    // extension:installed → refresh extensions + toast
    source.addEventListener("extension:installed", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as { projectId: string; name: string; version: string };
      void useExtensionStore.getState().fetchExtensions(data.projectId);
      useNotificationStore.getState().addToast(
        `Installed ${data.name}@${data.version}`,
        "success"
      );
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "extension:installed",
        payload: data,
      });
    });

    // extension:removed → refresh extensions + invalidate cache
    source.addEventListener("extension:removed", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as { projectId: string; name: string };
      invalidateExtensionModule(data.name);
      void useExtensionStore.getState().fetchExtensions(data.projectId);
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "extension:removed",
        payload: data,
      });
    });

    // extension:upgraded → invalidate cache + refresh
    source.addEventListener("extension:upgraded", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as {
        projectId: string;
        name: string;
        oldVersion: string;
        newVersion: string;
      };
      invalidateExtensionModule(data.name);
      void useExtensionStore.getState().fetchExtensions(data.projectId);
      useNotificationStore.getState().addToast(
        `${data.name} upgraded to ${data.newVersion}`,
        "info"
      );
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "extension:upgraded",
        payload: data,
      });
    });

    // extension:enabled → refresh extensions
    source.addEventListener("extension:enabled", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as { projectId: string; name: string };
      void useExtensionStore.getState().fetchExtensions(data.projectId);
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "extension:enabled",
        payload: data,
      });
    });

    // extension:disabled → refresh extensions
    source.addEventListener("extension:disabled", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as { projectId: string; name: string };
      void useExtensionStore.getState().fetchExtensions(data.projectId);
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "extension:disabled",
        payload: data,
      });
    });

    // extension:remounted → invalidate module cache so next navigation reloads
    source.addEventListener("extension:remounted", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as { projectId: string; name: string; version: string };
      invalidateExtensionModule(data.name);
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "extension:remounted",
        payload: data,
      });
    });

    // extension:error → error toast
    source.addEventListener("extension:error", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as { projectId: string; name: string; error: string };
      useNotificationStore.getState().addToast(
        `Error in ${data.name}: ${data.error}`,
        "error"
      );
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "extension:error",
        payload: data,
      });
    });

    // project:registered → refresh project list
    source.addEventListener("project:registered", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as { projectId: string; name: string; path: string };
      void useProjectStore.getState().fetchProjects();
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "project:registered",
        payload: data,
      });
    });

    // project:unregistered → refresh project list
    source.addEventListener("project:unregistered", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as { projectId: string };
      void useProjectStore.getState().fetchProjects();
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "project:unregistered",
        payload: data,
      });
    });

    // updates:available → update notification store
    source.addEventListener("updates:available", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as {
        extensions: Array<{ name: string; current: string; latest: string }>;
      };
      useNotificationStore.getState().setAvailableUpdates(data.extensions);
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "updates:available",
        payload: data,
      });
    });

    // mcp:connected → refresh MCP status (via extension fetch)
    source.addEventListener("mcp:connected", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as {
        projectId: string;
        extensionName: string;
        transport: string;
      };
      void useExtensionStore.getState().fetchExtensions(data.projectId);
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "mcp:connected",
        payload: data,
      });
    });

    // mcp:disconnected → refresh MCP status
    source.addEventListener("mcp:disconnected", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as {
        projectId: string;
        extensionName: string;
        reason: string;
      };
      void useExtensionStore.getState().fetchExtensions(data.projectId);
      useNotificationStore.getState().addToast(
        `MCP ${data.extensionName} disconnected: ${data.reason}`,
        "warning"
      );
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "mcp:disconnected",
        payload: data,
      });
    });

    // vault:updated → refresh vault keys
    source.addEventListener("vault:updated", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as { action: "set" | "delete"; key: string };
      void useVaultStore.getState().fetchKeys();
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "vault:updated",
        payload: data,
      });
    });

    // Intelligence SSE handlers
    source.addEventListener("session:started", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as { projectId: string };
      void useSessionStore.getState().fetchSessions(data.projectId);
    });

    source.addEventListener("session:ended", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as { projectId: string };
      void useSessionStore.getState().fetchSessions(data.projectId);
    });

    source.addEventListener("observation:created", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as { projectId: string };
      void useObservationStore.getState().fetchObservations(data.projectId);
    });

    source.addEventListener("observation:updated", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as { projectId: string };
      void useObservationStore.getState().fetchObservations(data.projectId);
    });

    source.addEventListener("error:recorded", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as { projectId: string };
      void useErrorStore.getState().fetchPatterns(data.projectId);
    });

    source.addEventListener("prompt:recorded", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as { projectId: string };
      void usePromptStore.getState().fetchPrompts(data.projectId);
    });

    source.addEventListener("tool:used", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as { projectId: string };
      void useToolAnalyticsStore.getState().fetchAnalytics(data.projectId);
    });

    source.addEventListener("tool:denied", (e: MessageEvent) => {
      if (!mountedRef.current) return;
      const data = JSON.parse(e.data) as { projectId: string };
      void useToolAnalyticsStore.getState().fetchAnalytics(data.projectId);
    });
  }, [workerBaseUrl]);

  useEffect(() => {
    mountedRef.current = true;
    connect();

    return () => {
      mountedRef.current = false;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (sourceRef.current) {
        sourceRef.current.close();
        sourceRef.current = null;
      }
    };
  }, [connect]);
}
