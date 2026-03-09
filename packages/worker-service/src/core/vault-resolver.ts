import { dbManager } from "./db-manager.js";
import { encrypt, decrypt } from "./encryption.js";
import { logger } from "./logger.js";
import { eventBus } from "./event-bus.js";
import type Database from "better-sqlite3";

interface VaultRow {
  key: string;
  encrypted_value: Buffer;
  iv: string;
  created_at: string;
  updated_at: string;
}

const VAULT_PLACEHOLDER_RE = /^\$\{VAULT:([^}]+)\}$/;

function getDb(): Database.Database {
  return dbManager.getConnection();
}

export function getSecret(key: string): string | null {
  const row = getDb().prepare(
    "SELECT encrypted_value, iv FROM _vault WHERE key = ?",
  ).get(key) as Pick<VaultRow, "encrypted_value" | "iv"> | undefined;

  if (!row) return null;

  try {
    return decrypt(row.encrypted_value, row.iv);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("vault", `Failed to decrypt key "${key}": ${msg}`);
    return null;
  }
}

export function setSecret(key: string, value: string): void {
  const { ciphertext, iv } = encrypt(value);
  const now = new Date().toISOString();

  const existing = getDb().prepare("SELECT key FROM _vault WHERE key = ?").get(key);

  if (existing) {
    getDb().prepare(
      "UPDATE _vault SET encrypted_value = ?, iv = ?, updated_at = ? WHERE key = ?",
    ).run(ciphertext, iv, now, key);
  } else {
    getDb().prepare(
      "INSERT INTO _vault (key, encrypted_value, iv, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(key, ciphertext, iv, now, now);
  }

  // Never log the value — only the key name
  logger.info("vault", `Secret set: ${key}`);
  eventBus.publish("vault:updated", { action: "set", key });
}

export function deleteSecret(key: string): boolean {
  const result = getDb().prepare("DELETE FROM _vault WHERE key = ?").run(key);
  if (result.changes > 0) {
    logger.info("vault", `Secret deleted: ${key}`);
    eventBus.publish("vault:updated", { action: "delete", key });
    return true;
  }
  return false;
}

export function listSecretKeys(): string[] {
  const rows = getDb().prepare("SELECT key FROM _vault ORDER BY key ASC").all() as Array<{ key: string }>;
  return rows.map((r) => r.key);
}

export function resolveVaultPlaceholders(
  settings: Record<string, unknown>,
  allowedKeys: string[],
  vaultTypeKeys: string[],
): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [k, v] of Object.entries(settings)) {
    if (typeof v !== "string") {
      result[k] = String(v);
      continue;
    }

    // Only resolve ${VAULT:key} in fields declared as type: "vault"
    if (!vaultTypeKeys.includes(k)) {
      result[k] = v;
      continue;
    }

    const match = VAULT_PLACEHOLDER_RE.exec(v);
    if (!match) {
      result[k] = v;
      continue;
    }

    const vaultKey = match[1];
    if (!vaultKey) {
      result[k] = v;
      continue;
    }

    // Cross-check against declared permissions
    if (!allowedKeys.includes(vaultKey)) {
      throw new Error(
        `Extension references Vault key "${vaultKey}" but does not declare it in permissions.vault`,
      );
    }

    const secret = getSecret(vaultKey);
    if (secret === null) {
      throw new Error(`Vault key "${vaultKey}" not found`);
    }

    result[k] = secret;
  }

  return result;
}
