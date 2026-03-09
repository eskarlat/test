import Table from "cli-table3";

export const symbols = process.platform === "win32" && !process.env["WT_SESSION"]
  ? { check: "\u221a", cross: "x", arrow: "->", bullet: "*" }
  : { check: "\u2713", cross: "\u2717", arrow: "\u2192", bullet: "\u2022" };

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}

export function formatTable(
  headers: string[],
  rows: string[][],
): string {
  const table = new Table({
    head: headers,
    style: { head: [], border: [] },
  });
  for (const row of rows) {
    table.push(row);
  }
  return table.toString();
}

export interface ExtensionLike {
  readonly status: "mounted" | "failed" | "suspended";
  readonly routeCount: number;
  readonly mcpTransport?: string;
  readonly error?: string;
}

export function formatExtensionDetail(ext: ExtensionLike): string {
  if (ext.status === "mounted") {
    const mcpPart = ext.mcpTransport ? `, MCP: ${ext.mcpTransport}` : "";
    return `${ext.routeCount} routes${mcpPart}`;
  }
  return ext.error ?? "failed";
}
