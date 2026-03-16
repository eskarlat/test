/**
 * Single-pass template variable substitution.
 * Replaces {{key}} patterns with values from the vars map.
 * Unresolved variables are kept as-is.
 * Escaped braces \{\{ and \}\} are converted to literal {{ and }}.
 */
export function resolveTemplate(template: string, vars: Record<string, string>): string {
  // Single-pass: replace all {{key}} in one replace() call
  // eslint-disable-next-line sonarjs/slow-regex -- character class [^}] is linear, not vulnerable to backtracking
  const result = template.replace(/\{\{([^}]+)\}\}/g, (_match, key: string) => {
    const trimmed = key.trim();
    const value = vars[trimmed];
    return value !== undefined ? value : `{{${key}}}`;
  });
  // Unescape literal braces
  return result.replace(/\\\{\\\{/g, "{{").replace(/\\\}\\\}/g, "}}");
}

/**
 * Build the full variable map for a step.
 */
export function buildTemplateVars(
  automation: { variables?: Record<string, string>; worktree?: { enabled: boolean } },
  stepIndex: number,
  stepOutputs: Map<string, string>,
  stepNames: string[],
  project: { id: string; name: string },
  worktreeInfo?: { path: string; branch: string },
): Record<string, string> {
  const vars: Record<string, string> = {};

  // Previous step output
  if (stepIndex > 0) {
    const prevName = stepNames[stepIndex - 1];
    const prevOutput = prevName ? stepOutputs.get(prevName) ?? "" : "";
    vars["prev.output"] = prevOutput;

    // Parse JSON fields from previous output
    const jsonFields = parseJsonFields(prevOutput);
    for (const [field, value] of Object.entries(jsonFields)) {
      vars[`prev.json.${field}`] = value;
    }
  } else {
    vars["prev.output"] = "";
  }

  // Named step outputs
  for (const [name, output] of stepOutputs.entries()) {
    vars[`steps.${name}.output`] = output;
  }

  // User-defined variables
  if (automation.variables) {
    for (const [key, value] of Object.entries(automation.variables)) {
      vars[`variables.${key}`] = value;
    }
  }

  // Project info
  vars["project.name"] = project.name;
  vars["project.id"] = project.id;

  // Time variables
  const now = new Date();
  vars["now"] = now.toISOString();
  vars["now.date"] = now.toISOString().slice(0, 10);
  vars["now.time"] = now.toISOString().slice(11, 19);

  // Worktree info
  if (worktreeInfo) {
    vars["worktree.path"] = worktreeInfo.path;
    vars["worktree.branch"] = worktreeInfo.branch;
  }

  return vars;
}

/**
 * Parse JSON response into flat field map.
 * Supports dot notation and bracket notation: results[0].name
 */
export function parseJsonFields(response: string): Record<string, string> {
  if (!response.trim()) return {};

  try {
    const parsed: unknown = JSON.parse(response);
    const result: Record<string, string> = {};
    flattenObject(parsed, "", result);
    return result;
  } catch {
    return { "*": "[JSON parse error: invalid response from previous step]" };
  }
}

function flattenObject(obj: unknown, prefix: string, result: Record<string, string>): void {
  if (obj === null || obj === undefined) {
    if (prefix) result[prefix] = "";
    return;
  }
  if (typeof obj === "string" || typeof obj === "number" || typeof obj === "boolean") {
    if (prefix) result[prefix] = String(obj);
    return;
  }
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      flattenObject(obj[i], prefix ? `${prefix}[${i}]` : `[${i}]`, result);
    }
    return;
  }
  if (typeof obj === "object") {
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      flattenObject(value, prefix ? `${prefix}.${key}` : key, result);
    }
  }
}
