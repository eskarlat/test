import { readServerState } from "../utils/pid.js";
export { readServerState };

export interface HealthResponse {
  status: string;
  uptime: number;
  memoryUsage: NodeJS.MemoryUsage;
  port: number;
  version: string;
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  extensionCount: number;
  mountedExtensions: MountedExtension[];
}

export interface MountedExtension {
  name: string;
  version: string;
  status: "mounted" | "failed" | "suspended";
  routeCount: number;
  mcpTransport?: string;
  mcpStatus?: string;
  error?: string;
}

export interface RegisterResponse {
  success: boolean;
  projectId: string;
  extensions: MountedExtension[];
}

function getBaseUrl(): string | null {
  const state = readServerState();
  if (!state) return null;
  return `http://localhost:${state.port}`;
}

export async function checkHealth(port?: number): Promise<HealthResponse | null> {
  const baseUrl = port ? `http://localhost:${port}` : getBaseUrl();
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return null;
    return await res.json() as HealthResponse;
  } catch {
    return null;
  }
}

export async function isRenreKitServer(port: number): Promise<boolean> {
  const health = await checkHealth(port);
  return health?.status === "ok";
}

export async function registerProject(
  projectId: string,
  name: string,
  projectPath: string,
): Promise<RegisterResponse | null> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return null;
  try {
    const res = await fetch(`${baseUrl}/api/projects/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projectId, name, path: projectPath }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    return await res.json() as RegisterResponse;
  } catch {
    return null;
  }
}

export async function unregisterProject(projectId: string): Promise<boolean> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return false;
  try {
    const res = await fetch(`${baseUrl}/api/projects/unregister`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: projectId }),
      signal: AbortSignal.timeout(5000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function listProjects(): Promise<ProjectInfo[]> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return [];
  try {
    const res = await fetch(`${baseUrl}/api/projects`, { signal: AbortSignal.timeout(3000) });
    if (!res.ok) return [];
    return await res.json() as ProjectInfo[];
  } catch {
    return [];
  }
}

export async function stopServer(): Promise<boolean> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return false;
  try {
    await fetch(`${baseUrl}/api/server/shutdown`, {
      method: "POST",
      signal: AbortSignal.timeout(3000),
    });
    return true;
  } catch {
    return true; // server may have already shut down
  }
}

async function postExtensionAction(
  projectId: string,
  action: string,
  body: Record<string, unknown>,
): Promise<boolean> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return false;
  try {
    const res = await fetch(`${baseUrl}/api/projects/${projectId}/extensions/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function notifyExtensionReload(projectId: string, name: string): Promise<boolean> {
  return postExtensionAction(projectId, "reload", { name });
}

export async function notifyExtensionUnload(projectId: string, name: string): Promise<boolean> {
  return postExtensionAction(projectId, "unload", { name });
}

export async function notifyExtensionUpgrade(
  projectId: string,
  name: string,
  targetVersion: string,
): Promise<boolean> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return false;
  try {
    const res = await fetch(`${baseUrl}/api/projects/${projectId}/extensions/upgrade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, targetVersion }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function notifyExtensionEnable(projectId: string, name: string): Promise<boolean> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return false;
  try {
    const res = await fetch(`${baseUrl}/api/projects/${projectId}/extensions/${name}/enable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function notifyExtensionDisable(projectId: string, name: string): Promise<boolean> {
  const baseUrl = getBaseUrl();
  if (!baseUrl) return false;
  try {
    const res = await fetch(`${baseUrl}/api/projects/${projectId}/extensions/${name}/disable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}
