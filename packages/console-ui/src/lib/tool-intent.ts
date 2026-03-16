/**
 * Tool intent generation — human-readable one-line descriptions of tool calls.
 * Used by compact and standard tool display modes (ADR-052 §1.4).
 */

function truncate(value: string, maxLen: number): string {
  if (value.length <= maxLen) return value;
  return value.slice(0, maxLen - 3) + "...";
}

function shortenPath(filePath: string): string {
  if (!filePath) return "";
  const parts = filePath.split("/");
  if (parts.length <= 3) return filePath;
  return ".../" + parts.slice(-2).join("/");
}

/** Convert camelCase/snake_case tool name into human-readable form */
function humanize(name: string): string {
  // Strip extension namespace prefix (extName__toolName → toolName)
  const idx = name.indexOf("__");
  const raw = idx > 0 ? name.slice(idx + 2) : name;
  // Convert camelCase and snake_case to spaced words
  return raw
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^./, (c) => c.toUpperCase());
}

type IntentFn = (args: Record<string, unknown>) => string;

const TOOL_INTENTS: Record<string, IntentFn> = {
  Read: (args) => `Read ${shortenPath(String(args.file_path ?? ""))}`,
  Edit: (args) => `Edit ${shortenPath(String(args.file_path ?? ""))}`,
  Write: (args) => `Write ${shortenPath(String(args.file_path ?? ""))}`,
  Bash: (args) => "Run `" + truncate(String(args.command ?? ""), 40) + "`",
  Grep: (args) => "Search for \"" + truncate(String(args.pattern ?? ""), 30) + "\"",
  Glob: (args) => `Find files matching ${String(args.pattern ?? "")}`,
  WebFetch: (args) => `Fetch ${truncate(String(args.url ?? ""), 40)}`,
  WebSearch: (args) => `Search "${truncate(String(args.query ?? ""), 30)}"`,
  Agent: (args) => `Delegate: ${truncate(String(args.description ?? ""), 40)}`,
  TodoWrite: () => "Update task list",
  NotebookEdit: (args) => `Edit notebook ${shortenPath(String(args.notebook_path ?? ""))}`,
  // read_file / edit_file — lowercase variants (Copilot SDK may use these)
  read_file: (args) => `Read ${shortenPath(String(args.file_path ?? ""))}`,
  edit_file: (args) => `Edit ${shortenPath(String(args.file_path ?? ""))}`,
  write_file: (args) => `Write ${shortenPath(String(args.file_path ?? ""))}`,
  list_directory: (args) => `List ${shortenPath(String(args.path ?? ""))}`,
};

/**
 * Generate a human-readable intent string for a tool call.
 * Example: `getToolIntent("Read", { file_path: "src/index.ts" })` → `"Read .../index.ts"`
 */
export function getToolIntent(toolName: string, args: Record<string, unknown>): string {
  const fn = TOOL_INTENTS[toolName];
  if (fn) return fn(args);

  // Fallback: humanize tool name + first argument value
  const firstArg = Object.values(args)[0];
  const suffix = firstArg ? ` — ${truncate(String(firstArg), 40)}` : "";
  return `${humanize(toolName)}${suffix}`;
}

export { truncate, shortenPath, humanize };
