/* eslint-disable sonarjs/void-use */
import { useEffect, useRef } from "react";
import { useExtensionStore } from "../stores/extension-store";
import { useProjectStore } from "../stores/project-store";
import { useNotificationStore } from "../stores/notification-store";
import { useVaultStore } from "../stores/vault-store";
import { invalidateExtensionModule } from "../lib/extension-loader";
import { useSessionStore } from "../stores/session-store";
import { useObservationStore } from "../stores/observation-store";
import { useErrorStore } from "../stores/error-store";
import { usePromptStore } from "../stores/prompt-store";
import { useToolAnalyticsStore } from "../stores/tool-analytics-store";
import { useSocketStore } from "./socket";
import type { Socket } from "socket.io-client";

// Helper: adds event listener and returns cleanup function
function onSocket(
  socket: Socket,
  event: string,
  handler: (...args: unknown[]) => void,
): () => void {
  socket.on(event, handler);
  return () => { socket.off(event, handler); };
}

/**
 * Subscribe to system-room events (auto-joined on connect).
 * Handles: extension:*, project:*, mcp:*, vault:*, updates:*
 */
export function useSystemEvents(): void {
  const socket = useSocketStore((s) => s.socket);
  const status = useSocketStore((s) => s.status);
  const cleanupRef = useRef<Array<() => void>>([]);

  useEffect(() => {
    if (!socket || status !== "connected") return;

    // On (re)connect, refresh core stores to fill gaps
    void useProjectStore.getState().fetchProjects();
    void useVaultStore.getState().fetchKeys();
    const { activeProjectId } = useProjectStore.getState();
    if (activeProjectId) {
      void useExtensionStore.getState().fetchExtensions(activeProjectId);
    }

    const cleanups: Array<() => void> = [];

    // Handle event-history for gap recovery
    cleanups.push(onSocket(socket, "event-history", (history: unknown) => {
      if (!Array.isArray(history)) return;
      // History replayed on connect — stores already refreshed above
    }));

    // extension:installed
    cleanups.push(onSocket(socket, "extension:installed", (data: unknown) => {
      const d = data as { projectId: string; name: string; version: string };
      void useExtensionStore.getState().fetchExtensions(d.projectId);
      useNotificationStore.getState().addToast(`Installed ${d.name}@${d.version}`, "success");
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "extension:installed",
        payload: d,
      });
    }));

    // extension:removed
    cleanups.push(onSocket(socket, "extension:removed", (data: unknown) => {
      const d = data as { projectId: string; name: string };
      invalidateExtensionModule(d.name);
      void useExtensionStore.getState().fetchExtensions(d.projectId);
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "extension:removed",
        payload: d,
      });
    }));

    // extension:upgraded
    cleanups.push(onSocket(socket, "extension:upgraded", (data: unknown) => {
      const d = data as { projectId: string; name: string; oldVersion: string; newVersion: string };
      invalidateExtensionModule(d.name);
      void useExtensionStore.getState().fetchExtensions(d.projectId);
      useNotificationStore.getState().addToast(`${d.name} upgraded to ${d.newVersion}`, "info");
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "extension:upgraded",
        payload: d,
      });
    }));

    // extension:enabled
    cleanups.push(onSocket(socket, "extension:enabled", (data: unknown) => {
      const d = data as { projectId: string; name: string };
      void useExtensionStore.getState().fetchExtensions(d.projectId);
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "extension:enabled",
        payload: d,
      });
    }));

    // extension:disabled
    cleanups.push(onSocket(socket, "extension:disabled", (data: unknown) => {
      const d = data as { projectId: string; name: string };
      void useExtensionStore.getState().fetchExtensions(d.projectId);
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "extension:disabled",
        payload: d,
      });
    }));

    // extension:remounted
    cleanups.push(onSocket(socket, "extension:remounted", (data: unknown) => {
      const d = data as { projectId: string; name: string; version: string };
      invalidateExtensionModule(d.name);
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "extension:remounted",
        payload: d,
      });
    }));

    // extension:error
    cleanups.push(onSocket(socket, "extension:error", (data: unknown) => {
      const d = data as { projectId: string; name: string; error: string };
      useNotificationStore.getState().addToast(`Error in ${d.name}: ${d.error}`, "error");
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "extension:error",
        payload: d,
      });
    }));

    // project:registered
    cleanups.push(onSocket(socket, "project:registered", (data: unknown) => {
      void useProjectStore.getState().fetchProjects();
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "project:registered",
        payload: data as Record<string, unknown>,
      });
    }));

    // project:unregistered
    cleanups.push(onSocket(socket, "project:unregistered", (data: unknown) => {
      void useProjectStore.getState().fetchProjects();
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "project:unregistered",
        payload: data as Record<string, unknown>,
      });
    }));

    // updates:available
    cleanups.push(onSocket(socket, "updates:available", (data: unknown) => {
      const d = data as { extensions: Array<{ name: string; current: string; latest: string }> };
      useNotificationStore.getState().setAvailableUpdates(d.extensions);
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "updates:available",
        payload: d,
      });
    }));

    // mcp:connected
    cleanups.push(onSocket(socket, "mcp:connected", (data: unknown) => {
      const d = data as { projectId: string; extensionName: string; transport: string };
      void useExtensionStore.getState().fetchExtensions(d.projectId);
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "mcp:connected",
        payload: d,
      });
    }));

    // mcp:disconnected
    cleanups.push(onSocket(socket, "mcp:disconnected", (data: unknown) => {
      const d = data as { projectId: string; extensionName: string; reason: string };
      void useExtensionStore.getState().fetchExtensions(d.projectId);
      useNotificationStore.getState().addToast(
        `MCP ${d.extensionName} disconnected: ${d.reason}`,
        "warning",
      );
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "mcp:disconnected",
        payload: d,
      });
    }));

    // vault:updated
    cleanups.push(onSocket(socket, "vault:updated", (data: unknown) => {
      void useVaultStore.getState().fetchKeys();
      useNotificationStore.getState().addEvent({
        timestamp: new Date().toISOString(),
        event: "vault:updated",
        payload: data as Record<string, unknown>,
      });
    }));

    cleanupRef.current = cleanups;

    return () => {
      for (const cleanup of cleanups) cleanup();
      cleanupRef.current = [];
    };
  }, [socket, status]);
}

/**
 * Subscribe to project-room events for a specific project.
 * Joins/leaves the project room on mount/unmount/projectId change.
 */
export function useProjectEvents(projectId: string | null): void {
  const socket = useSocketStore((s) => s.socket);
  const status = useSocketStore((s) => s.status);

  useEffect(() => {
    if (!socket || status !== "connected" || !projectId) return;

    // Join project room
    socket.emit("project:join", projectId);

    const cleanups: Array<() => void> = [];

    // session:started / session:ended
    cleanups.push(onSocket(socket, "session:started", (data: unknown) => {
      const d = data as { projectId: string };
      if (d.projectId === projectId) {
        void useSessionStore.getState().fetchSessions(projectId);
      }
    }));

    cleanups.push(onSocket(socket, "session:ended", (data: unknown) => {
      const d = data as { projectId: string };
      if (d.projectId === projectId) {
        void useSessionStore.getState().fetchSessions(projectId);
      }
    }));

    // observation:created / observation:updated
    cleanups.push(onSocket(socket, "observation:created", (data: unknown) => {
      const d = data as { projectId: string };
      if (d.projectId === projectId) {
        void useObservationStore.getState().fetchObservations(projectId);
      }
    }));

    cleanups.push(onSocket(socket, "observation:updated", (data: unknown) => {
      const d = data as { projectId: string };
      if (d.projectId === projectId) {
        void useObservationStore.getState().fetchObservations(projectId);
      }
    }));

    // error:recorded
    cleanups.push(onSocket(socket, "error:recorded", (data: unknown) => {
      const d = data as { projectId: string };
      if (d.projectId === projectId) {
        void useErrorStore.getState().fetchPatterns(projectId);
      }
    }));

    // prompt:recorded
    cleanups.push(onSocket(socket, "prompt:recorded", (data: unknown) => {
      const d = data as { projectId: string };
      if (d.projectId === projectId) {
        void usePromptStore.getState().fetchPrompts(projectId);
      }
    }));

    // tool:used / tool:denied
    cleanups.push(onSocket(socket, "tool:used", (data: unknown) => {
      const d = data as { projectId: string };
      if (d.projectId === projectId) {
        void useToolAnalyticsStore.getState().fetchAnalytics(projectId);
      }
    }));

    cleanups.push(onSocket(socket, "tool:denied", (data: unknown) => {
      const d = data as { projectId: string };
      if (d.projectId === projectId) {
        void useToolAnalyticsStore.getState().fetchAnalytics(projectId);
      }
    }));

    return () => {
      for (const cleanup of cleanups) cleanup();
      socket.emit("project:leave", projectId);
    };
  }, [socket, status, projectId]);
}
