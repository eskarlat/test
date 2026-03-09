import { describe, it, expect } from "vitest";
import { resolveTemplate, buildTemplateVars, parseJsonFields } from "./template-engine.js";

describe("template-engine", () => {
  describe("resolveTemplate", () => {
    it("substitutes basic variables", () => {
      const result = resolveTemplate("Hello {{name}}", { name: "World" });
      expect(result).toBe("Hello World");
    });

    it("substitutes multiple variables", () => {
      const result = resolveTemplate("{{greeting}} {{name}}!", {
        greeting: "Hello",
        name: "World",
      });
      expect(result).toBe("Hello World!");
    });

    it("trims whitespace in keys", () => {
      const result = resolveTemplate("{{ name }}", { name: "World" });
      expect(result).toBe("World");
    });

    it("keeps unresolved variables as-is", () => {
      const result = resolveTemplate("Hello {{name}} and {{unknown}}", { name: "World" });
      expect(result).toBe("Hello World and {{unknown}}");
    });

    it("performs single-pass: injected {{}} in values are not re-evaluated", () => {
      const result = resolveTemplate("{{a}}", { a: "{{b}}", b: "should-not-appear" });
      expect(result).toBe("{{b}}");
    });

    it("unescapes literal braces", () => {
      const result = resolveTemplate("Use \\{\\{ and \\}\\} for templates", {});
      expect(result).toBe("Use {{ and }} for templates");
    });

    it("handles empty template", () => {
      const result = resolveTemplate("", { name: "World" });
      expect(result).toBe("");
    });

    it("handles template with no variables", () => {
      const result = resolveTemplate("No variables here", { name: "World" });
      expect(result).toBe("No variables here");
    });

    it("substitutes dot-notation variables", () => {
      const result = resolveTemplate("{{variables.name}}", { "variables.name": "test" });
      expect(result).toBe("test");
    });

    it("substitutes bracket-notation variables", () => {
      const result = resolveTemplate("{{prev.json.results[0].name}}", {
        "prev.json.results[0].name": "first-result",
      });
      expect(result).toBe("first-result");
    });
  });

  describe("parseJsonFields", () => {
    it("parses flat JSON object", () => {
      const result = parseJsonFields(JSON.stringify({ name: "test", count: 42 }));
      expect(result).toEqual({ name: "test", count: "42" });
    });

    it("parses nested JSON object with dot notation", () => {
      const result = parseJsonFields(JSON.stringify({ data: { name: "inner" } }));
      expect(result).toEqual({ "data.name": "inner" });
    });

    it("parses arrays with bracket notation", () => {
      const result = parseJsonFields(JSON.stringify({ results: ["a", "b", "c"] }));
      expect(result).toEqual({
        "results[0]": "a",
        "results[1]": "b",
        "results[2]": "c",
      });
    });

    it("parses nested arrays: results[0].name", () => {
      const result = parseJsonFields(
        JSON.stringify({ results: [{ name: "first" }, { name: "second" }] }),
      );
      expect(result["results[0].name"]).toBe("first");
      expect(result["results[1].name"]).toBe("second");
    });

    it("returns error for invalid JSON", () => {
      const result = parseJsonFields("not valid json");
      expect(result["*"]).toBe("[JSON parse error: invalid response from previous step]");
    });

    it("returns empty object for empty string", () => {
      const result = parseJsonFields("");
      expect(result).toEqual({});
    });

    it("returns empty object for whitespace-only string", () => {
      const result = parseJsonFields("   ");
      expect(result).toEqual({});
    });

    it("handles null values as empty string", () => {
      const result = parseJsonFields(JSON.stringify({ value: null }));
      expect(result["value"]).toBe("");
    });

    it("handles boolean values", () => {
      const result = parseJsonFields(JSON.stringify({ active: true, deleted: false }));
      expect(result["active"]).toBe("true");
      expect(result["deleted"]).toBe("false");
    });

    it("handles deeply nested structures", () => {
      const result = parseJsonFields(
        JSON.stringify({ a: { b: { c: { d: "deep" } } } }),
      );
      expect(result["a.b.c.d"]).toBe("deep");
    });
  });

  describe("buildTemplateVars", () => {
    const project = { id: "proj-1", name: "Test Project" };

    it("includes project.name and project.id", () => {
      const vars = buildTemplateVars(
        {},
        0,
        new Map(),
        [],
        project,
      );
      expect(vars["project.name"]).toBe("Test Project");
      expect(vars["project.id"]).toBe("proj-1");
    });

    it("includes now, now.date, now.time with valid timestamps", () => {
      const vars = buildTemplateVars({}, 0, new Map(), [], project);
      // now should be a valid ISO string
      expect(() => new Date(vars["now"]!)).not.toThrow();
      expect(vars["now"]!).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      // now.date should be YYYY-MM-DD
      expect(vars["now.date"]!).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // now.time should be HH:MM:SS
      expect(vars["now.time"]!).toMatch(/^\d{2}:\d{2}:\d{2}$/);
    });

    it("sets prev.output to empty string for step 0", () => {
      const vars = buildTemplateVars({}, 0, new Map(), [], project);
      expect(vars["prev.output"]).toBe("");
    });

    it("sets prev.output from previous step output", () => {
      const stepOutputs = new Map([["analyze", "Previous output text"]]);
      const vars = buildTemplateVars(
        {},
        1,
        stepOutputs,
        ["analyze", "summarize"],
        project,
      );
      expect(vars["prev.output"]).toBe("Previous output text");
    });

    it("sets prev.json.* from JSON previous output", () => {
      const stepOutputs = new Map([
        ["analyze", JSON.stringify({ status: "ok", count: 5 })],
      ]);
      const vars = buildTemplateVars(
        {},
        1,
        stepOutputs,
        ["analyze", "summarize"],
        project,
      );
      expect(vars["prev.json.status"]).toBe("ok");
      expect(vars["prev.json.count"]).toBe("5");
    });

    it("sets prev.json.* error for invalid JSON", () => {
      const stepOutputs = new Map([["analyze", "not json"]]);
      const vars = buildTemplateVars(
        {},
        1,
        stepOutputs,
        ["analyze", "summarize"],
        project,
      );
      expect(vars["prev.json.*"]).toBe(
        "[JSON parse error: invalid response from previous step]",
      );
    });

    it("includes named step outputs", () => {
      const stepOutputs = new Map([
        ["step-a", "output A"],
        ["step-b", "output B"],
      ]);
      const vars = buildTemplateVars(
        {},
        2,
        stepOutputs,
        ["step-a", "step-b", "step-c"],
        project,
      );
      expect(vars["steps.step-a.output"]).toBe("output A");
      expect(vars["steps.step-b.output"]).toBe("output B");
    });

    it("includes user-defined variables", () => {
      const vars = buildTemplateVars(
        { variables: { repo: "my-repo", branch: "main" } },
        0,
        new Map(),
        [],
        project,
      );
      expect(vars["variables.repo"]).toBe("my-repo");
      expect(vars["variables.branch"]).toBe("main");
    });

    it("includes worktree info when provided", () => {
      const vars = buildTemplateVars(
        { worktree: { enabled: true } },
        0,
        new Map(),
        [],
        project,
        { path: "/tmp/wt", branch: "feature/test" },
      );
      expect(vars["worktree.path"]).toBe("/tmp/wt");
      expect(vars["worktree.branch"]).toBe("feature/test");
    });

    it("does not include worktree info when not provided", () => {
      const vars = buildTemplateVars({}, 0, new Map(), [], project);
      expect(vars["worktree.path"]).toBeUndefined();
      expect(vars["worktree.branch"]).toBeUndefined();
    });

    it("handles missing previous step name gracefully", () => {
      // Step index 1 but step names array has only 1 entry (current step)
      const vars = buildTemplateVars(
        {},
        1,
        new Map(),
        ["only-step"],
        project,
      );
      expect(vars["prev.output"]).toBe("");
    });
  });

  describe("integration: resolveTemplate + buildTemplateVars", () => {
    it("resolves a full automation prompt template", () => {
      const automation = {
        variables: { language: "TypeScript", style: "concise" },
      };
      const stepOutputs = new Map([["analyze", "Found 3 issues"]]);
      const project = { id: "p1", name: "MyProject" };

      const vars = buildTemplateVars(
        automation,
        1,
        stepOutputs,
        ["analyze", "fix"],
        project,
      );

      const template =
        "For project {{project.name}}, fix issues in {{variables.language}}.\n" +
        "Previous analysis: {{prev.output}}\n" +
        "Style: {{variables.style}}";

      const result = resolveTemplate(template, vars);

      expect(result).toBe(
        "For project MyProject, fix issues in TypeScript.\n" +
          "Previous analysis: Found 3 issues\n" +
          "Style: concise",
      );
    });
  });
});
