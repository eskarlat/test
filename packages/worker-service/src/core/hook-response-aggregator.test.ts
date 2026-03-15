import { describe, it, expect } from "vitest";
import { aggregateResults } from "./hook-response-aggregator.js";
import type { HookFeatureResult } from "./hook-request-queue.js";

function ok(output: Record<string, unknown>): HookFeatureResult {
  return { featureId: "f1", success: true, output } as HookFeatureResult;
}
function fail(): HookFeatureResult {
  return { featureId: "f2", success: false, error: "boom" } as HookFeatureResult;
}

describe("aggregateResults", () => {
  describe("preToolUse (permissions)", () => {
    it("returns allow when all results allow", () => {
      const r = aggregateResults("preToolUse", [
        ok({ decision: "allow" }),
        ok({ decision: "allow" }),
      ]);
      expect(r.decision).toBe("allow");
    });

    it("returns deny if any result denies", () => {
      const r = aggregateResults("preToolUse", [
        ok({ decision: "allow" }),
        ok({ decision: "deny" }),
      ]);
      expect(r.decision).toBe("deny");
    });

    it("returns ask if any result asks and none deny", () => {
      const r = aggregateResults("preToolUse", [
        ok({ decision: "allow" }),
        ok({ decision: "ask" }),
      ]);
      expect(r.decision).toBe("ask");
    });

    it("ignores failed results", () => {
      const r = aggregateResults("preToolUse", [fail(), ok({ decision: "allow" })]);
      expect(r.decision).toBe("allow");
    });

    it("returns allow with no results", () => {
      const r = aggregateResults("preToolUse", []);
      expect(r.decision).toBe("allow");
    });
  });

  describe("preCompact", () => {
    it("joins system messages", () => {
      const r = aggregateResults("preCompact", [
        ok({ systemMessage: "msg1" }),
        ok({ systemMessage: "msg2" }),
      ]);
      expect(r.continue).toBe(true);
      expect(r.systemMessage).toBe("msg1\n\nmsg2");
    });

    it("filters undefined messages", () => {
      const r = aggregateResults("preCompact", [ok({}), ok({ systemMessage: "only" })]);
      expect(r.systemMessage).toBe("only");
    });

    it("ignores failed results", () => {
      const r = aggregateResults("preCompact", [fail()]);
      expect(r.continue).toBe(true);
      expect(r.systemMessage).toBe("");
    });
  });

  describe("context events (sessionStart, userPromptSubmitted, subagentStart)", () => {
    for (const event of ["sessionStart", "userPromptSubmitted", "subagentStart"] as const) {
      it(`aggregates additionalContext for ${event}`, () => {
        const r = aggregateResults(event, [
          ok({ additionalContext: "ctx1" }),
          ok({ additionalContext: "ctx2" }),
        ]);
        expect(r.additionalContext).toBe("ctx1\n\nctx2");
      });

      it(`aggregates observations for ${event}`, () => {
        const r = aggregateResults(event, [
          ok({ observations: [{ a: 1 }] }),
          ok({ observations: [{ b: 2 }] }),
        ]);
        expect(r.observations).toEqual([{ a: 1 }, { b: 2 }]);
      });

      it(`returns undefined observations when none present for ${event}`, () => {
        const r = aggregateResults(event, [ok({})]);
        expect(r.observations).toBeUndefined();
      });
    }
  });

  describe("other events", () => {
    it("returns empty object for sessionEnd", () => {
      const r = aggregateResults("sessionEnd", [ok({})]);
      expect(r).toEqual({});
    });

    it("returns empty object for postToolUse", () => {
      const r = aggregateResults("postToolUse", [ok({})]);
      expect(r).toEqual({});
    });
  });
});
