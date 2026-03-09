import { MCPClientImpl } from "./mcp-client.js";
import { StdioTransport, validateStdioCommand } from "./mcp-stdio-transport.js";
import { SSETransport } from "./mcp-sse-transport.js";
import { eventBus } from "./event-bus.js";
import { logger } from "./logger.js";
import { getSecret } from "./vault-resolver.js";
import type { MCPClient, MCPStdioConfig, MCPSSEConfig } from "@renre-kit/extension-sdk";

type MCPConfig = MCPStdioConfig | MCPSSEConfig;

type MCPStatus = "connecting" | "connected" | "disconnected" | "error";

interface MCPEntry {
  client: MCPClientImpl;
  status: MCPStatus;
  transport: string;
  pid?: number;
  url?: string;
  startedAt: number;
  error?: string;
}

// projectId → extensionName → entry
const connections = new Map<string, Map<string, MCPEntry>>();

function resolveVaultValues(record: Record<string, string> | undefined): Record<string, string> {
  if (!record) return {};
  const resolved: Record<string, string> = {};
  for (const [k, v] of Object.entries(record)) {
    if (v.startsWith("${VAULT:") && v.endsWith("}")) {
      const key = v.slice(8, -1);
      resolved[k] = getSecret(key) ?? v;
    } else {
      resolved[k] = v;
    }
  }
  return resolved;
}

function getEntry(projectId: string, extensionName: string): MCPEntry | undefined {
  return connections.get(projectId)?.get(extensionName);
}

function upsertEntry(projectId: string, extensionName: string, entry: MCPEntry): void {
  if (!connections.has(projectId)) {
    connections.set(projectId, new Map());
  }
  connections.get(projectId)!.set(extensionName, entry);
}

export function connect(
  projectId: string,
  extensionName: string,
  config: MCPConfig,
): MCPClient {
  const existing = getEntry(projectId, extensionName);
  if (existing) {
    return existing.client;
  }

  const newEntry: MCPEntry = {
    client: null as unknown as MCPClientImpl,
    status: "connecting",
    transport: config.transport,
    startedAt: Date.now(),
  };

  let client: MCPClientImpl;

  if (config.transport === "stdio") {
    try {
      validateStdioCommand(config.command, config.args);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`ext:mcp:${extensionName}`, msg);
      throw err;
    }
    const env = resolveVaultValues(config.env);
    const transport = new StdioTransport(config.command, config.args, env);
    newEntry.pid = transport.pid;
    transport.on("disconnected", () => {
      newEntry.status = "disconnected";
      eventBus.publish("mcp:disconnected", { name: extensionName, projectId });
    });
    transport.on("reconnected", () => {
      newEntry.status = "connected";
      eventBus.publish("mcp:connected", { name: extensionName, projectId });
    });
    client = new MCPClientImpl(transport);
    newEntry.status = "connected";
  } else {
    const headers = resolveVaultValues(config.headers);
    const transport = new SSETransport(config.url, headers);
    newEntry.url = config.url;
    transport.on("connected", () => {
      newEntry.status = "connected";
      eventBus.publish("mcp:connected", { name: extensionName, projectId });
    });
    transport.on("disconnected", () => {
      newEntry.status = "disconnected";
      eventBus.publish("mcp:disconnected", { name: extensionName, projectId });
    });
    client = new MCPClientImpl(transport);
  }

  newEntry.client = client;
  upsertEntry(projectId, extensionName, newEntry);
  return client;
}

export function disconnect(projectId: string, extensionName: string): void {
  const projectConns = connections.get(projectId);
  if (!projectConns) return;
  const entry = projectConns.get(extensionName);
  if (!entry) return;
  entry.client.close();
  projectConns.delete(extensionName);
}

export function disconnectAll(projectId: string): void {
  const projectConns = connections.get(projectId);
  if (!projectConns) return;
  for (const [name] of projectConns) {
    disconnect(projectId, name);
  }
  connections.delete(projectId);
}

export function getClient(projectId: string, extensionName: string): MCPClient | null {
  return getEntry(projectId, extensionName)?.client ?? null;
}

export function getStatus(projectId: string): Array<{
  extensionName: string;
  transport: string;
  status: MCPStatus;
  pid?: number;
  url?: string;
  uptime: number;
  error?: string;
}> {
  const projectConns = connections.get(projectId) ?? new Map<string, MCPEntry>();
  return Array.from(projectConns.entries()).map(([name, entry]) => ({
    extensionName: name,
    transport: entry.transport,
    status: entry.status,
    pid: entry.pid,
    url: entry.url,
    uptime: Math.round((Date.now() - entry.startedAt) / 1000),
    error: entry.error,
  }));
}
