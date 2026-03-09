import { Command } from "commander";
import pc from "picocolors";
import { findProjectDir } from "../utils/paths.js";
import { readProjectJson, readExtensionsJson } from "../services/project-manager.js";
import { readServerState } from "../utils/pid.js";
import { formatJson, formatTable } from "../utils/formatter.js";
import { isInteractive } from "../utils/logger.js";

interface QueryOptions {
  json?: boolean;
  data?: string;
  method?: string;
  project?: string;
}

type HttpMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

function resolveMethod(options: QueryOptions): HttpMethod {
  if (options.method) {
    return options.method.toUpperCase() as HttpMethod;
  }
  return options.data ? "POST" : "GET";
}

function buildUrl(port: number, projectId: string, extension: string, action: string | undefined, extraArgs: string[]): string {
  const base = `http://localhost:${port}/api/${projectId}/${extension}`;
  const actionSegment = action ? `/${action}` : "";
  if (extraArgs.length === 0) {
    return `${base}${actionSegment}`;
  }
  const params = new URLSearchParams();
  extraArgs.forEach((val, idx) => {
    params.set(`arg${idx}`, val);
  });
  return `${base}${actionSegment}?${params.toString()}`;
}

function isArrayOfObjects(data: unknown): data is Record<string, unknown>[] {
  return (
    Array.isArray(data) &&
    data.length > 0 &&
    typeof data[0] === "object" &&
    data[0] !== null &&
    !Array.isArray(data[0])
  );
}

function formatResponseAsTable(data: Record<string, unknown>[]): string {
  const headers = Object.keys(data[0]);
  const rows = data.map((row) => headers.map((h) => String(row[h] ?? "")));
  return formatTable(headers, rows);
}

function outputResponse(data: unknown, forceJson: boolean): void {
  if (!forceJson && isInteractive() && isArrayOfObjects(data)) {
    console.log(formatResponseAsTable(data));
  } else {
    console.log(formatJson(data));
  }
}

async function fetchActions(port: number, projectId: string, extension: string): Promise<void> {
  const url = `http://localhost:${port}/api/${projectId}/${extension}/__actions`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  } catch (err) {
    handleFetchError(err);
  }

  if (!res.ok) {
    const body = await tryParseBody(res);
    const msg = extractErrorMessage(body, res.status);
    const statusLabel = `HTTP ${res.status}`;
    console.error(`${pc.red(statusLabel)} ${msg}`);
    process.exit(1);
  }

  const data = await res.json() as unknown;
  console.log(formatJson(data));
}

function handleFetchError(err: unknown): never {
  if (err instanceof Error && err.name === "TimeoutError") {
    console.error("Worker service not responding");
    process.exit(1);
  }
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "ECONNREFUSED") {
    console.error("Worker service not running. Run `renre-kit start`");
    process.exit(1);
  }
  throw err;
}

async function tryParseBody(res: Response): Promise<unknown> {
  try {
    return await res.json() as unknown;
  } catch {
    return null;
  }
}

function extractErrorMessage(body: unknown, status: number): string {
  if (body && typeof body === "object" && "error" in body) {
    return String((body as Record<string, unknown>).error);
  }
  return `Request failed with status ${status}`;
}

export function registerQueryCommand(program: Command): void {
  program
    .command("query")
    .description("Query an extension action on the worker service")
    .argument("<extension>", "Extension name")
    .argument("[action]", "Action path (or --help to list actions)")
    .argument("[args...]", "Extra positional args mapped to ?arg0=value&arg1=value")
    .option("--json", "Force JSON output")
    .option("-d, --data <json>", "JSON body for the request")
    .option("--method <method>", "Override HTTP method (GET/POST/PUT/DELETE/PATCH)")
    .option("--project <id>", "Explicit project ID override")
    .allowUnknownOption(false)
    .addHelpText("after", "\nUse `renre-kit query <extension> --help` to list available actions.")
    .action(async (extension: string, action: string | undefined, extraArgs: string[], options: QueryOptions) => {
      // Extension-level help: fetch __actions
      if (action === "--help" || action === "-h") {
        const { projectId } = resolveProjectContext(options);
        const serverState = readServerState();
        if (!serverState) {
          console.error("Worker service not running. Run `renre-kit start`");
          process.exit(1);
        }
        await fetchActions(serverState.port, projectId, extension);
        return;
      }

      // Resolve project directory and ID
      const { projectId, projectDir } = resolveProjectContext(options);

      // CLI-side pre-validation: verify extension is installed
      if (projectDir) {
        const extensionsJson = readExtensionsJson(projectDir);
        const installed = extensionsJson?.extensions ?? [];
        const found = installed.some((e) => e.name === extension);
        if (!found) {
          console.error(
            `Error: Extension "${extension}" not installed. Run \`renre-kit marketplace search ${extension}\``,
          );
          process.exit(1);
        }
      }

      // Resolve server state
      const serverState = readServerState();
      if (!serverState) {
        console.error("Worker service not running. Run `renre-kit start`");
        process.exit(1);
      }

      const method = resolveMethod(options);
      const url = buildUrl(serverState.port, projectId, extension, action, extraArgs);

      const fetchOptions: RequestInit = {
        method,
        signal: AbortSignal.timeout(3000),
        headers: {} as Record<string, string>,
      };

      if (options.data) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(options.data) as unknown;
        } catch {
          console.error("Invalid JSON provided to --data");
          process.exit(1);
        }
        (fetchOptions.headers as Record<string, string>)["Content-Type"] = "application/json";
        fetchOptions.body = JSON.stringify(parsed);
      }

      let res: Response;
      try {
        res = await fetch(url, fetchOptions);
      } catch (err) {
        handleFetchError(err);
      }

      const body = await tryParseBody(res);

      if (!res.ok) {
        const msg = extractErrorMessage(body, res.status);
        const statusLabel = `HTTP ${res.status}`;
        console.error(`${pc.red(statusLabel)} ${msg}`);
        process.exit(res.status >= 500 ? 2 : 1);
      }

      outputResponse(body, Boolean(options.json));
    });
}

function resolveProjectContext(options: QueryOptions): { projectId: string; projectDir: string | null } {
  if (options.project) return { projectId: options.project, projectDir: findProjectDir() };
  const projectDir = findProjectDir();
  if (!projectDir) {
    console.error("Not inside a renre-kit project. Run `renre-kit init` first.");
    process.exit(1);
  }
  const projectJson = readProjectJson(projectDir);
  if (!projectJson) {
    console.error("Could not read project.json. Run `renre-kit init` first.");
    process.exit(1);
  }
  return { projectId: projectJson.id, projectDir };
}
