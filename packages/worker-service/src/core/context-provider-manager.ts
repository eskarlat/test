import type Database from "better-sqlite3";
import { dbManager } from "./db-manager.js";
import { logger } from "./logger.js";
import type { ExtensionManifest } from "@renre-kit/extension-sdk";

export interface ContextProvider {
  id: string;
  type: "core" | "extension";
  extensionName?: string;
  name: string;
  description: string;
  icon?: string;
  configSchema?: string;
  defaultEnabled: boolean;
}

function ensureTable(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS _context_providers (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      extension_name TEXT,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      icon TEXT,
      config_schema TEXT,
      default_enabled INTEGER DEFAULT 1
    )
  `);
}

export function registerExtensionProvider(
  extensionName: string,
  manifest: ExtensionManifest,
): void {
  if (!manifest.contextProvider) return;

  const db = dbManager.getConnection();
  ensureTable(db);

  const id = `ext:${extensionName}`;
  const configSchema = manifest.settings?.schema
    ? JSON.stringify(manifest.settings.schema)
    : null;

  db.prepare(`
    INSERT OR REPLACE INTO _context_providers
      (id, type, extension_name, name, description, icon, config_schema, default_enabled)
    VALUES (?, 'extension', ?, ?, ?, ?, ?, 1)
  `).run(
    id,
    extensionName,
    manifest.displayName,
    manifest.description,
    null,
    configSchema,
  );

  logger.info(`ext:${extensionName}`, "Context provider registered");
}

export function unregisterExtensionProvider(extensionName: string): void {
  try {
    const db = dbManager.getConnection();
    ensureTable(db);
    db.prepare("DELETE FROM _context_providers WHERE extension_name = ?").run(extensionName);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn(`ext:${extensionName}`, `Failed to unregister context provider: ${msg}`);
  }
}

export function listProviders(): ContextProvider[] {
  try {
    const db = dbManager.getConnection();
    ensureTable(db);
    return db.prepare("SELECT * FROM _context_providers").all() as ContextProvider[];
  } catch {
    return [];
  }
}
