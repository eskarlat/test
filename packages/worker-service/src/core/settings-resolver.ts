import { resolveVaultPlaceholders } from "./vault-resolver.js";

export type SettingType = "string" | "vault" | "number" | "boolean" | "select";

export interface SettingDefinition {
  key: string;
  type: SettingType;
  label?: string;
  description?: string;
  required?: boolean;
  default?: string | number | boolean;
  options?: { label: string; value: string }[];
}

export interface ResolveResult {
  settings: Record<string, string>;
  missingRequired: string[];
}

export function resolveSettings(
  schema: SettingDefinition[],
  rawSettings: Record<string, unknown>,
  vaultPermissions: string[] = [],
): Record<string, string> {
  const result = resolveSettingsWithValidation(schema, rawSettings, vaultPermissions);

  if (result.missingRequired.length > 0) {
    throw new Error(
      `Extension cannot activate: missing required settings: ${result.missingRequired.join(", ")}`,
    );
  }

  return result.settings;
}

function applyDefaults(
  schema: SettingDefinition[],
  rawSettings: Record<string, unknown>,
): { working: Record<string, unknown>; missingRequired: string[] } {
  const missingRequired: string[] = [];
  const working: Record<string, unknown> = {};

  for (const def of schema) {
    const raw = rawSettings[def.key];
    if (raw !== undefined && raw !== null && raw !== "") {
      working[def.key] = raw;
    } else if (def.default !== undefined) {
      working[def.key] = def.default;
    } else if (def.required) {
      missingRequired.push(def.key);
    }
  }

  return { working, missingRequired };
}

function validateNumber(key: string, val: unknown): string {
  if (isNaN(Number(val))) {
    throw new Error(`Setting "${key}" must be a number, got: ${String(val)}`);
  }
  return String(Number(val));
}

function validateBoolean(key: string, val: unknown): string {
  if (val !== true && val !== false && val !== "true" && val !== "false") {
    throw new Error(`Setting "${key}" must be a boolean, got: ${String(val)}`);
  }
  return String(val === true || val === "true");
}

function validateSelect(key: string, val: unknown, options: { label: string; value: string }[] | undefined): string {
  if (options && !options.some((o) => o.value === String(val))) {
    const allowed = options.map((o) => o.value).join(", ");
    throw new Error(
      `Setting "${key}" value "${String(val)}" not in allowed options: ${allowed}`,
    );
  }
  return String(val);
}

function validateTypes(
  schema: SettingDefinition[],
  working: Record<string, unknown>,
): void {
  for (const def of schema) {
    const val = working[def.key];
    if (val === undefined) continue;

    if (def.type === "number") {
      working[def.key] = validateNumber(def.key, val);
    } else if (def.type === "boolean") {
      working[def.key] = validateBoolean(def.key, val);
    } else if (def.type === "select") {
      working[def.key] = validateSelect(def.key, val, def.options);
    }
  }
}

export function resolveSettingsWithValidation(
  schema: SettingDefinition[],
  rawSettings: Record<string, unknown>,
  vaultPermissions: string[] = [],
): ResolveResult {
  const vaultTypeKeys = schema.filter((s) => s.type === "vault").map((s) => s.key);

  const { working, missingRequired } = applyDefaults(schema, rawSettings);

  if (missingRequired.length > 0) {
    return { settings: {}, missingRequired };
  }

  validateTypes(schema, working);

  // Resolve vault placeholders (only for vault-type fields)
  const resolved = resolveVaultPlaceholders(
    working as Record<string, string>,
    vaultPermissions,
    vaultTypeKeys,
  );

  return { settings: resolved, missingRequired: [] };
}
