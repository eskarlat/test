/**
 * Tests for worker-service.cjs event resolution logic (ADR-046).
 *
 * Since worker-service.cjs is a standalone CommonJS script that reads stdin and makes
 * HTTP requests, we test the event resolution logic by extracting the core algorithm
 * and testing it in isolation.
 */
import { describe, it, expect } from "vitest";

// Replicate the EVENT_MAP from worker-service.cjs for testing
const EVENT_MAP: Record<string, string> = {
  SessionStart: "sessionStart",
  Stop: "sessionEnd",
  UserPromptSubmit: "userPromptSubmitted",
  PreToolUse: "preToolUse",
  PostToolUse: "postToolUse",
  ErrorOccurred: "errorOccurred",
  PreCompact: "preCompact",
  SubagentStart: "subagentStart",
  SubagentStop: "subagentStop",
  sessionStart: "sessionStart",
  sessionEnd: "sessionEnd",
  userPromptSubmitted: "userPromptSubmitted",
  preToolUse: "preToolUse",
  postToolUse: "postToolUse",
  errorOccurred: "errorOccurred",
  preCompact: "preCompact",
  subagentStart: "subagentStart",
  subagentStop: "subagentStop",
};

/**
 * Replicate the event resolution logic from worker-service.cjs main().
 * This is the exact algorithm extracted for testability.
 */
function resolveEvent(
  args: string[],
  input: { event?: string },
): { event: string; feature: string; source: string } {
  const is4ArgFormat = args.length >= 4;
  const eventArg = is4ArgFormat ? args[2] : null;
  const feature = is4ArgFormat ? args[3]! : args[2]!;

  const rawEvent = eventArg || input.event || feature;
  const event = EVENT_MAP[rawEvent] || rawEvent;

  let source = "fallback";
  if (eventArg) {
    source = "cli-arg";
  } else if (input.event) {
    source = "stdin";
  }

  return { event, feature, source };
}

describe("worker-service.cjs event resolution (ADR-046)", () => {
  describe("4-arg format (new)", () => {
    it("resolves event from CLI argument", () => {
      const result = resolveEvent(
        ["hook", "agent", "sessionStart", "context-inject"],
        {},
      );
      expect(result.event).toBe("sessionStart");
      expect(result.feature).toBe("context-inject");
      expect(result.source).toBe("cli-arg");
    });

    it("normalizes PascalCase event from CLI argument", () => {
      const result = resolveEvent(
        ["hook", "agent", "SessionStart", "context-inject"],
        {},
      );
      expect(result.event).toBe("sessionStart");
      expect(result.feature).toBe("context-inject");
      expect(result.source).toBe("cli-arg");
    });

    it("handles all 9 PascalCase event mappings", () => {
      const cases: Array<[string, string]> = [
        ["SessionStart", "sessionStart"],
        ["Stop", "sessionEnd"],
        ["UserPromptSubmit", "userPromptSubmitted"],
        ["PreToolUse", "preToolUse"],
        ["PostToolUse", "postToolUse"],
        ["ErrorOccurred", "errorOccurred"],
        ["PreCompact", "preCompact"],
        ["SubagentStart", "subagentStart"],
        ["SubagentStop", "subagentStop"],
      ];

      for (const [pascal, expected] of cases) {
        const result = resolveEvent(["hook", "agent", pascal, "some-feature"], {});
        expect(result.event).toBe(expected);
      }
    });

    it("prefers CLI arg over stdin event", () => {
      const result = resolveEvent(
        ["hook", "agent", "preToolUse", "tool-governance"],
        { event: "sessionStart" },
      );
      expect(result.event).toBe("preToolUse");
      expect(result.source).toBe("cli-arg");
    });

    it("handles extension feature IDs with colons", () => {
      const result = resolveEvent(
        ["hook", "agent", "sessionStart", "jira:session-init"],
        {},
      );
      expect(result.event).toBe("sessionStart");
      expect(result.feature).toBe("jira:session-init");
    });
  });

  describe("3-arg format (backwards compatibility)", () => {
    it("falls back to stdin event when 3-arg format used", () => {
      const result = resolveEvent(
        ["hook", "agent", "context-inject"],
        { event: "sessionStart" },
      );
      expect(result.event).toBe("sessionStart");
      expect(result.feature).toBe("context-inject");
      expect(result.source).toBe("stdin");
    });

    it("falls back to feature name when no stdin event", () => {
      const result = resolveEvent(
        ["hook", "agent", "context-inject"],
        {},
      );
      expect(result.event).toBe("context-inject");
      expect(result.feature).toBe("context-inject");
      expect(result.source).toBe("fallback");
    });

    it("normalizes PascalCase stdin event", () => {
      const result = resolveEvent(
        ["hook", "agent", "tool-governance"],
        { event: "PreToolUse" },
      );
      expect(result.event).toBe("preToolUse");
      expect(result.source).toBe("stdin");
    });
  });

  describe("camelCase passthrough", () => {
    it("passes through already-canonical camelCase events", () => {
      const result = resolveEvent(
        ["hook", "agent", "sessionStart", "context-inject"],
        {},
      );
      expect(result.event).toBe("sessionStart");
    });

    it("passes through unknown events unchanged", () => {
      const result = resolveEvent(
        ["hook", "agent", "customEvent", "custom-feature"],
        {},
      );
      expect(result.event).toBe("customEvent");
    });
  });
});
