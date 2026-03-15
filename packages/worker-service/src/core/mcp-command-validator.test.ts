import { describe, it, expect } from "vitest";
import { validateMcpCommand, validateMcpArgs } from "./mcp-command-validator.js";

describe("validateMcpCommand", () => {
  const allowedCommands = ["node", "npx", "python", "python3", "deno", "bun", "uvx", "docker"];

  it.each(allowedCommands)("accepts allowed command: %s", (cmd) => {
    expect(validateMcpCommand(cmd)).toBe(true);
  });

  it.each(["bash", "sh", "curl", "wget", "rm", "cat", "eval", ""])(
    "rejects disallowed command: %s",
    (cmd) => {
      expect(validateMcpCommand(cmd)).toBe(false);
    },
  );

  it("rejects commands with extra whitespace or casing", () => {
    expect(validateMcpCommand("Node")).toBe(false);
    expect(validateMcpCommand(" node")).toBe(false);
    expect(validateMcpCommand("node ")).toBe(false);
  });
});

describe("validateMcpArgs", () => {
  it("accepts empty args array", () => {
    expect(validateMcpArgs([])).toEqual({ valid: true });
  });

  it("accepts safe arguments", () => {
    expect(validateMcpArgs(["--flag", "value", "-p", "3000", "src/index.ts"])).toEqual({
      valid: true,
    });
  });

  it("accepts arguments with dashes, dots, slashes", () => {
    expect(validateMcpArgs(["--config=./path/to/file.json", "-v", "1.2.3"])).toEqual({
      valid: true,
    });
  });

  const metachars = [";", "|", "&", "`", "$", "(", ")", ">", "<"];

  it.each(metachars)("rejects argument containing shell metacharacter: %s", (char) => {
    const badArg = `safe${char}bad`;
    const result = validateMcpArgs(["--flag", badArg]);
    expect(result.valid).toBe(false);
    expect(result.invalidArg).toBe(badArg);
  });

  it("returns the first invalid argument when multiple are bad", () => {
    const result = validateMcpArgs(["ok", "bad;arg", "also|bad"]);
    expect(result.valid).toBe(false);
    expect(result.invalidArg).toBe("bad;arg");
  });

  it("rejects command substitution patterns", () => {
    const result = validateMcpArgs(["$(whoami)"]);
    expect(result.valid).toBe(false);
    expect(result.invalidArg).toBe("$(whoami)");
  });

  it("rejects backtick command substitution", () => {
    const result = validateMcpArgs(["`whoami`"]);
    expect(result.valid).toBe(false);
    expect(result.invalidArg).toBe("`whoami`");
  });

  it("rejects pipe redirection", () => {
    const result = validateMcpArgs(["file.txt", ">", "/dev/null"]);
    expect(result.valid).toBe(false);
    expect(result.invalidArg).toBe(">");
  });
});
