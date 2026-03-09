import { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import pc from "picocolors";

const VALID_NAME_RE = /^[a-z0-9-]+$/;
const VALID_SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;
const VALID_HOOK_EVENTS = new Set([
  "sessionStart",
  "sessionEnd",
  "userPromptSubmitted",
  "preToolUse",
  "postToolUse",
  "errorOccurred",
  "preCompact",
  "subagentStart",
  "subagentStop",
]);
const VALID_SETTING_TYPES = new Set([
  "string",
  "vault",
  "number",
  "boolean",
  "select",
]);
const MCP_COMMAND_ALLOWLIST = new Set([
  "node",
  "npx",
  "python",
  "python3",
  "deno",
  "bun",
  "uvx",
  "docker",
]);
const SHELL_METACHAR_RE = /[;|&`$()><]/;
const VALID_HTTP_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);

interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

type ManifestRecord = Record<string, unknown>;

function checkRequiredFields(m: ManifestRecord, errors: string[]): void {
  for (const field of [
    "name",
    "version",
    "displayName",
    "description",
    "author",
  ]) {
    if (!m[field]) errors.push(`Missing required field: ${field}`);
  }
}

function checkNameAndVersion(m: ManifestRecord, errors: string[]): void {
  if (typeof m["name"] === "string") {
    if (!VALID_NAME_RE.test(m["name"])) {
      errors.push(`Invalid name format: must match /^[a-z0-9-]+$/`);
    }
    if (m["name"].startsWith("__")) {
      errors.push(`Name cannot start with __ (reserved for core)`);
    }
  }
  if (
    typeof m["version"] === "string" &&
    !VALID_SEMVER_RE.test(m["version"])
  ) {
    errors.push(`Invalid version: must be valid semver (e.g. 1.2.3)`);
  }
  if (
    m["minSdkVersion"] !== undefined &&
    (typeof m["minSdkVersion"] !== "string" ||
      !VALID_SEMVER_RE.test(m["minSdkVersion"]))
  ) {
    errors.push("minSdkVersion must be a valid semver string");
  }
}

function checkBackend(backend: ManifestRecord, errors: string[]): void {
  if (!backend["entrypoint"]) {
    errors.push("backend.entrypoint is required when backend is declared");
  }
  const actions = backend["actions"] as ManifestRecord[] | undefined;
  if (!Array.isArray(actions)) return;
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (!action) continue;
    if (!action["name"]) errors.push(`backend.actions[${i}]: missing name`);
    if (!action["description"]) {
      errors.push(`backend.actions[${i}]: missing description`);
    }
    if (!action["method"] || !VALID_HTTP_METHODS.has(String(action["method"]))) {
      errors.push(
        `backend.actions[${i}]: invalid method "${String(action["method"])}"`,
      );
    }
  }
}

function checkUi(ui: ManifestRecord, errors: string[]): void {
  if (!ui["bundle"]) {
    errors.push("ui.bundle is required when ui is declared");
  }
  const pages = ui["pages"] as ManifestRecord[] | undefined;
  if (!Array.isArray(pages)) return;
  const seenPaths = new Set<string>();
  for (let i = 0; i < pages.length; i++) {
    const page = pages[i];
    if (!page) continue;
    if (!page["id"]) errors.push(`ui.pages[${i}]: missing id`);
    if (!page["label"]) errors.push(`ui.pages[${i}]: missing label`);
    if (!page["path"]) {
      errors.push(`ui.pages[${i}]: missing path`);
    } else if (typeof page["path"] === "string") {
      if (seenPaths.has(page["path"])) {
        errors.push(`ui.pages[${i}]: duplicate path "${page["path"]}"`);
      }
      seenPaths.add(page["path"]);
    }
  }
}

function checkMcpStdio(mcp: ManifestRecord, errors: string[]): void {
  if (!mcp["command"]) {
    errors.push("mcp.command required for stdio transport");
  } else if (!MCP_COMMAND_ALLOWLIST.has(String(mcp["command"]))) {
    errors.push(
      `mcp.command "${String(mcp["command"])}" not in allowlist: ${Array.from(MCP_COMMAND_ALLOWLIST).join(", ")}`,
    );
  }
  if (!Array.isArray(mcp["args"])) {
    errors.push("mcp.args must be an array for stdio transport");
  } else {
    for (const arg of mcp["args"] as string[]) {
      if (SHELL_METACHAR_RE.test(arg)) {
        errors.push(`mcp.args contains shell metacharacter in: "${arg}"`);
      }
    }
  }
}

function checkMcp(mcp: ManifestRecord, errors: string[]): void {
  if (mcp["transport"] === "stdio") {
    checkMcpStdio(mcp, errors);
  } else if (mcp["transport"] === "sse") {
    if (!mcp["url"]) errors.push("mcp.url required for sse transport");
  } else {
    errors.push(`mcp.transport must be "stdio" or "sse"`);
  }
}

function checkPermissions(
  permissions: ManifestRecord,
  warnings: string[],
): void {
  const knownKeys = new Set([
    "database",
    "network",
    "mcp",
    "hooks",
    "vault",
    "filesystem",
  ]);
  for (const key of Object.keys(permissions)) {
    if (!knownKeys.has(key)) warnings.push(`Unknown permission key: "${key}"`);
  }
  if (permissions["network"]) {
    warnings.push("network permission is advisory — access not enforced");
  }
  if (permissions["filesystem"]) {
    warnings.push(
      "filesystem permission is advisory — access not enforced",
    );
  }
}

function checkSettings(settings: ManifestRecord, errors: string[]): void {
  const schema = settings["schema"] as ManifestRecord[] | undefined;
  if (!Array.isArray(schema)) return;
  for (let i = 0; i < schema.length; i++) {
    const s = schema[i];
    if (!s) continue;
    if (!s["key"]) errors.push(`settings.schema[${i}]: missing key`);
    const settingType = String(s["type"] ?? "");
    if (!VALID_SETTING_TYPES.has(settingType)) {
      errors.push(`settings.schema[${i}]: invalid type "${settingType}"`);
    }
    if (settingType === "select" && !Array.isArray(s["options"])) {
      errors.push(
        `settings.schema[${i}]: select type requires options array`,
      );
    }
  }
}

function checkHooks(hooks: ManifestRecord, errors: string[]): void {
  const events = hooks["events"];
  if (!Array.isArray(events)) return;
  for (const event of events) {
    if (!VALID_HOOK_EVENTS.has(String(event))) {
      errors.push(`hooks.events: unknown event "${String(event)}"`);
    }
  }
}

function checkSkills(skills: ManifestRecord[], errors: string[]): void {
  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i];
    if (!skill) continue;
    if (!skill["name"]) errors.push(`skills[${i}]: missing name`);
    if (!skill["description"]) {
      errors.push(`skills[${i}]: missing description`);
    }
    if (!skill["file"]) errors.push(`skills[${i}]: missing file`);
  }
}

function checkContextProvider(
  contextProvider: ManifestRecord,
  backend: ManifestRecord | undefined,
  hooks: ManifestRecord | undefined,
  errors: string[],
  warnings: string[],
): void {
  if (!contextProvider["entrypoint"]) {
    errors.push("contextProvider.entrypoint is required");
  }
  if (!backend) {
    errors.push("contextProvider requires backend to be declared");
  }
  const hookEvents = (hooks?.["events"] as string[] | undefined) ?? [];
  if (!hookEvents.includes("sessionStart")) {
    warnings.push(
      "contextProvider: recommend adding 'sessionStart' to hooks.events",
    );
  }
}

function validateExtensionManifest(m: ManifestRecord): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  checkRequiredFields(m, errors);
  checkNameAndVersion(m, errors);

  const backend = m["backend"] as ManifestRecord | undefined;
  if (backend !== undefined) checkBackend(backend, errors);

  const ui = m["ui"] as ManifestRecord | undefined;
  if (ui !== undefined) checkUi(ui, errors);

  const mcp = m["mcp"] as ManifestRecord | undefined;
  if (mcp !== undefined) checkMcp(mcp, errors);

  const permissions = m["permissions"] as ManifestRecord | undefined;
  if (permissions !== undefined) checkPermissions(permissions, warnings);

  const settings = m["settings"] as ManifestRecord | undefined;
  if (settings !== undefined) checkSettings(settings, errors);

  const hooks = m["hooks"] as ManifestRecord | undefined;
  if (hooks !== undefined) checkHooks(hooks, errors);

  const skills = m["skills"] as ManifestRecord[] | undefined;
  if (Array.isArray(skills)) checkSkills(skills, errors);

  const contextProvider = m["contextProvider"] as ManifestRecord | undefined;
  if (contextProvider !== undefined) {
    checkContextProvider(contextProvider, backend, hooks, errors, warnings);
  }

  return { valid: errors.length === 0, errors, warnings };
}

export function registerExtensionCommand(program: Command): void {
  const ext = program
    .command("extension")
    .description("Extension management commands");

  ext
    .command("validate <path>")
    .description("Validate an extension manifest.json")
    .action((extPath: string) => {
      const resolvedPath = resolve(extPath);
      const manifestPath = join(resolvedPath, "manifest.json");

      if (!existsSync(manifestPath)) {
        console.error(
          pc.red(`✗ manifest.json not found at ${manifestPath}`),
        );
        process.exit(1);
      }

      let manifest: ManifestRecord;
      try {
        manifest = JSON.parse(
          readFileSync(manifestPath, "utf8"),
        ) as ManifestRecord;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(pc.red(`✗ Failed to parse manifest.json: ${msg}`));
        process.exit(1);
      }

      const result = validateExtensionManifest(manifest);

      if (result.errors.length > 0) {
        console.log(pc.red("\nErrors:"));
        for (const error of result.errors) {
          console.log(pc.red(`  ✗ ${error}`));
        }
      }

      if (result.warnings.length > 0) {
        console.log(pc.yellow("\nWarnings:"));
        for (const warning of result.warnings) {
          console.log(pc.yellow(`  ⚠ ${warning}`));
        }
      }

      if (result.valid) {
        console.log(
          pc.green(
            `\n✓ ${String(manifest["name"])}@${String(manifest["version"])} is valid`,
          ),
        );
      } else {
        console.log(
          pc.red(
            `\n✗ Validation failed (${result.errors.length} error(s))`,
          ),
        );
        process.exit(1);
      }
    });
}
