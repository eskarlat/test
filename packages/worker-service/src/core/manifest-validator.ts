import { existsSync } from "node:fs";
import { join } from "node:path";
import { validateMcpCommand, validateMcpArgs } from "./mcp-command-validator.js";

const CURRENT_SDK_VERSION = "0.1.0";
const VALID_NAME_RE = /^[a-z0-9-]+$/;
const VALID_SEMVER_RE = /^\d+\.\d+\.\d+(-[\w.]+)?$/;

const VALID_HTTP_METHODS = new Set(["GET", "POST", "PUT", "DELETE", "PATCH"]);
const VALID_SETTING_TYPES = new Set(["string", "vault", "number", "boolean", "select"]);
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
const KNOWN_PERMISSION_KEYS = new Set([
  "database",
  "network",
  "mcp",
  "hooks",
  "vault",
  "filesystem",
  "llm",
  "scheduler",
]);

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  incompatible?: boolean;
}

function parseSemver(v: string): [number, number, number] | null {
  const match = /^(\d+)\.(\d+)\.(\d+)/.exec(v);
  if (!match) return null;
  return [parseInt(match[1]!, 10), parseInt(match[2]!, 10), parseInt(match[3]!, 10)];
}

function semverGt(a: [number, number, number], b: [number, number, number]): boolean {
  if (a[0] !== b[0]) return a[0] > b[0];
  if (a[1] !== b[1]) return a[1] > b[1];
  return a[2] > b[2];
}

function validateNameAndVersion(
  m: Record<string, unknown>,
  errors: string[],
): void {
  if (typeof m["name"] === "string") {
    if (!VALID_NAME_RE.test(m["name"])) {
      errors.push(`Invalid name format: must match /^[a-z0-9-]+$/`);
    }
    if (m["name"].startsWith("__")) {
      errors.push(`Name cannot start with __ (reserved for core)`);
    }
  }
  if (typeof m["version"] === "string" && !VALID_SEMVER_RE.test(m["version"])) {
    errors.push(`Invalid version: must be valid semver (e.g. 1.2.3)`);
  }
}

function validateMinSdkVersion(
  m: Record<string, unknown>,
  errors: string[],
  warnings: string[],
): boolean {
  if (m["minSdkVersion"] === undefined) return false;
  if (typeof m["minSdkVersion"] !== "string" || !VALID_SEMVER_RE.test(m["minSdkVersion"])) {
    errors.push("minSdkVersion must be a valid semver string");
    return false;
  }
  const minParsed = parseSemver(m["minSdkVersion"]);
  const currentParsed = parseSemver(CURRENT_SDK_VERSION);
  if (!minParsed || !currentParsed) return false;

  if (semverGt(minParsed, currentParsed)) {
    errors.push(
      `Extension requires SDK >= ${m["minSdkVersion"]} but current SDK is ${CURRENT_SDK_VERSION}`,
    );
    return true; // incompatible
  }
  if (currentParsed[0] === minParsed[0] && currentParsed[1] - minParsed[1] > 2) {
    warnings.push(
      `minSdkVersion ${m["minSdkVersion"]} is more than 2 minor versions behind current SDK ${CURRENT_SDK_VERSION}`,
    );
  }
  return false;
}

function validateBackend(
  backend: Record<string, unknown>,
  errors: string[],
): void {
  if (!backend["entrypoint"] || typeof backend["entrypoint"] !== "string") {
    errors.push("backend.entrypoint must be a non-empty string");
  }
  const actions = backend["actions"] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(actions)) return;
  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (!action) continue;
    if (!action["name"]) errors.push(`backend.actions[${i}]: missing name`);
    if (!action["description"]) errors.push(`backend.actions[${i}]: missing description`);
    if (!action["method"] || !VALID_HTTP_METHODS.has(String(action["method"]))) {
      errors.push(`backend.actions[${i}]: method must be one of GET, POST, PUT, DELETE, PATCH`);
    }
  }
}

function validateUiPages(
  pages: Array<Record<string, unknown>>,
  errors: string[],
): void {
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

function validateUi(
  ui: Record<string, unknown>,
  errors: string[],
): void {
  if (!ui["bundle"] || typeof ui["bundle"] !== "string") {
    errors.push("ui.bundle must be a non-empty string");
  }
  const pages = ui["pages"] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(pages)) validateUiPages(pages, errors);
}

function validateMcp(
  mcp: Record<string, unknown>,
  errors: string[],
): void {
  if (mcp["transport"] === "stdio") {
    validateMcpStdio(mcp, errors);
  } else if (mcp["transport"] === "sse") {
    if (!mcp["url"] || typeof mcp["url"] !== "string") {
      errors.push("mcp.url is required for sse transport");
    }
  } else {
    errors.push(`mcp.transport must be "stdio" or "sse"`);
  }
}

function validateMcpStdio(
  mcp: Record<string, unknown>,
  errors: string[],
): void {
  if (!mcp["command"] || typeof mcp["command"] !== "string") {
    errors.push("mcp.command is required for stdio transport");
  } else if (!validateMcpCommand(mcp["command"])) {
    errors.push(
      `mcp.command "${mcp["command"]}" not in allowlist: node, npx, python, python3, deno, bun, uvx, docker`,
    );
  }
  if (!Array.isArray(mcp["args"])) {
    errors.push("mcp.args must be an array for stdio transport");
  } else {
    const argsResult = validateMcpArgs(mcp["args"] as string[]);
    if (!argsResult.valid) {
      errors.push(`mcp.args contains shell metacharacter in: "${argsResult.invalidArg ?? ""}"`);
    }
  }
}

function validatePermissions(
  permissions: Record<string, unknown>,
  warnings: string[],
): void {
  for (const key of Object.keys(permissions)) {
    if (!KNOWN_PERMISSION_KEYS.has(key)) {
      warnings.push(`Unknown permission key: "${key}"`);
    }
  }
  if (permissions["network"]) {
    warnings.push("network permission is advisory — network access is not enforced");
  }
  if (permissions["filesystem"]) {
    warnings.push("filesystem permission is advisory — filesystem access is not enforced");
  }
}

function validateSettings(
  settings: Record<string, unknown>,
  errors: string[],
): void {
  const schema = settings["schema"] as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(schema)) return;
  for (let i = 0; i < schema.length; i++) {
    const setting = schema[i];
    if (!setting) continue;
    if (!setting["key"]) errors.push(`settings.schema[${i}]: missing key`);
    const settingType = String(setting["type"] ?? "");
    if (!VALID_SETTING_TYPES.has(settingType)) {
      errors.push(
        `settings.schema[${i}]: invalid type "${settingType}" (must be string, vault, number, boolean, or select)`,
      );
    }
    if (settingType === "select" && !Array.isArray(setting["options"])) {
      errors.push(`settings.schema[${i}]: select type requires an options array`);
    }
  }
}

function validateHooks(
  hooks: Record<string, unknown>,
  errors: string[],
): void {
  const events = hooks["events"];
  if (!Array.isArray(events)) return;
  for (const event of events) {
    if (!VALID_HOOK_EVENTS.has(String(event))) {
      errors.push(`hooks.events: unknown event "${String(event)}"`);
    }
  }
}

function validateSkills(
  skills: Array<Record<string, unknown>>,
  errors: string[],
  warnings: string[],
  extensionDir?: string,
): void {
  for (let i = 0; i < skills.length; i++) {
    const skill = skills[i];
    if (!skill) continue;
    if (!skill["name"]) errors.push(`skills[${i}]: missing name`);
    if (!skill["description"]) errors.push(`skills[${i}]: missing description`);
    if (!skill["file"]) errors.push(`skills[${i}]: missing file`);

    // Validate that the skill file actually exists in the extension directory
    if (extensionDir && typeof skill["file"] === "string") {
      const skillPath = join(extensionDir, skill["file"]);
      if (!existsSync(skillPath)) {
        warnings.push(`skills[${i}]: file "${skill["file"]}" not found at ${skillPath}`);
      }
    }
  }
}

const VALID_IDENTIFIER_RE = /^[a-zA-Z][a-zA-Z0-9-]*$/;
const VALID_ENDPOINT_RE = /^(GET|POST|PUT|DELETE|PATCH) \//;

function validateChatTools(
  tools: Array<Record<string, unknown>>,
  errors: string[],
): Set<string> {
  const names = new Set<string>();
  for (let i = 0; i < tools.length; i++) {
    const tool = tools[i];
    if (!tool) continue;

    const name = String(tool["name"] ?? "");
    if (!name) {
      errors.push(`chatTools[${i}]: missing name`);
    } else if (!VALID_IDENTIFIER_RE.test(name)) {
      errors.push(`chatTools[${i}]: name must be alphanumeric + hyphens`);
    } else if (names.has(name)) {
      errors.push(`chatTools[${i}]: duplicate tool name "${name}"`);
    } else {
      names.add(name);
    }

    if (!tool["description"]) errors.push(`chatTools[${i}]: missing description`);

    if (typeof tool["parameters"] !== "object" || tool["parameters"] === null) {
      errors.push(`chatTools[${i}]: parameters must be a JSON Schema object`);
    }

    const endpoint = String(tool["endpoint"] ?? "");
    if (!endpoint) {
      errors.push(`chatTools[${i}]: missing endpoint`);
    } else if (!VALID_ENDPOINT_RE.test(endpoint)) {
      errors.push(`chatTools[${i}]: endpoint must match "METHOD /path" format`);
    }
  }
  return names;
}

function validateChatAgents(
  agents: Array<Record<string, unknown>>,
  toolNames: Set<string>,
  errors: string[],
): void {
  const names = new Set<string>();
  for (let i = 0; i < agents.length; i++) {
    const agent = agents[i];
    if (!agent) continue;

    const name = String(agent["name"] ?? "");
    if (!name) {
      errors.push(`chatAgents[${i}]: missing name`);
    } else if (!VALID_IDENTIFIER_RE.test(name)) {
      errors.push(`chatAgents[${i}]: name must be alphanumeric + hyphens`);
    } else if (names.has(name)) {
      errors.push(`chatAgents[${i}]: duplicate agent name "${name}"`);
    } else {
      names.add(name);
    }

    if (!agent["displayName"]) errors.push(`chatAgents[${i}]: missing displayName`);
    if (!agent["description"]) errors.push(`chatAgents[${i}]: missing description`);
    if (!agent["prompt"]) errors.push(`chatAgents[${i}]: missing prompt`);

    const tools = agent["tools"];
    if (!Array.isArray(tools)) {
      errors.push(`chatAgents[${i}]: tools must be an array`);
    } else {
      for (const toolRef of tools) {
        if (!toolNames.has(String(toolRef))) {
          errors.push(`chatAgents[${i}]: tool "${String(toolRef)}" not found in chatTools`);
        }
      }
    }
  }
}

function validateContextProvider(
  contextProvider: Record<string, unknown>,
  backend: Record<string, unknown> | undefined,
  hooks: Record<string, unknown> | undefined,
  errors: string[],
  warnings: string[],
): void {
  if (!contextProvider["entrypoint"] || typeof contextProvider["entrypoint"] !== "string") {
    errors.push("contextProvider.entrypoint must be a non-empty string");
  }
  if (!backend) {
    errors.push("contextProvider requires backend to be declared");
  }
  const hookEvents = (hooks?.["events"] as string[] | undefined) ?? [];
  if (!hookEvents.includes("sessionStart")) {
    warnings.push("contextProvider: recommend adding 'sessionStart' to hooks.events");
  }
}

type ManifestFields = {
  backend?: Record<string, unknown>;
  hooks?: Record<string, unknown>;
};

function validateOptionalSections(
  m: Record<string, unknown>,
  errors: string[],
  warnings: string[],
  extensionDir?: string,
): ManifestFields {
  const backend = m["backend"] as Record<string, unknown> | undefined;
  if (backend !== undefined) validateBackend(backend, errors);

  const ui = m["ui"] as Record<string, unknown> | undefined;
  if (ui !== undefined) validateUi(ui, errors);

  const mcp = m["mcp"] as Record<string, unknown> | undefined;
  if (mcp !== undefined) validateMcp(mcp, errors);

  const permissions = m["permissions"] as Record<string, unknown> | undefined;
  if (permissions !== undefined) validatePermissions(permissions, warnings);

  const settings = m["settings"] as Record<string, unknown> | undefined;
  if (settings !== undefined) validateSettings(settings, errors);

  const hooks = m["hooks"] as Record<string, unknown> | undefined;
  if (hooks !== undefined) validateHooks(hooks, errors);

  const skills = m["skills"] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(skills)) validateSkills(skills, errors, warnings, extensionDir);

  // Chat tools and agents (ADR-047)
  const chatTools = m["chatTools"] as Array<Record<string, unknown>> | undefined;
  let toolNames = new Set<string>();
  if (Array.isArray(chatTools)) {
    toolNames = validateChatTools(chatTools, errors);
  }

  const chatAgents = m["chatAgents"] as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(chatAgents)) {
    validateChatAgents(chatAgents, toolNames, errors);
  }

  // Warn if chatTools/chatAgents present but permissions.llm not set
  if ((chatTools?.length || chatAgents?.length) && !permissions?.["llm"]) {
    warnings.push("chatTools/chatAgents declared but permissions.llm is not true");
  }

  return { backend, hooks };
}

export function validateManifest(manifest: unknown, extensionDir?: string): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (typeof manifest !== "object" || manifest === null) {
    return { valid: false, errors: ["Manifest must be a JSON object"], warnings: [] };
  }

  const m = manifest as Record<string, unknown>;

  for (const field of ["name", "version", "displayName", "description", "author"] as const) {
    if (!m[field]) errors.push(`Missing required field: ${field}`);
  }

  validateNameAndVersion(m, errors);

  const incompatible = validateMinSdkVersion(m, errors, warnings);
  if (incompatible) {
    return { valid: false, errors, warnings, incompatible: true };
  }

  const { backend, hooks } = validateOptionalSections(m, errors, warnings, extensionDir);

  const contextProvider = m["contextProvider"] as Record<string, unknown> | undefined;
  if (contextProvider !== undefined) {
    validateContextProvider(contextProvider, backend, hooks, errors, warnings);
  }

  return { valid: errors.length === 0, errors, warnings };
}
