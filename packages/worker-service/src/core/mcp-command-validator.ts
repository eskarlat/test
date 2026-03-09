const MCP_COMMAND_ALLOWLIST = new Set(["node", "npx", "python", "python3", "deno", "bun", "uvx", "docker"]);
const SHELL_METACHAR_RE = /[;|&`$()><]/;

export function validateMcpCommand(command: string): boolean {
  return MCP_COMMAND_ALLOWLIST.has(command);
}

export function validateMcpArgs(args: string[]): { valid: boolean; invalidArg?: string } {
  for (const arg of args) {
    if (SHELL_METACHAR_RE.test(arg)) {
      return { valid: false, invalidArg: arg };
    }
  }
  return { valid: true };
}
