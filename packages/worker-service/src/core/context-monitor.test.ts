import { describe, it, expect, beforeEach } from "vitest";
import {
  trackToolUse,
  trackPrompt,
  getUsage,
  markSuggested,
  clearSession,
  SUGGEST_THRESHOLD,
} from "./context-monitor.js";

describe("context-monitor", () => {
  beforeEach(() => {
    clearSession("s1");
    clearSession("s2");
  });

  describe("trackPrompt", () => {
    it("tracks prompt token usage", () => {
      trackPrompt("s1", "Hello world"); // ~3 tokens (11 chars / 4)
      const usage = getUsage("s1", "claude-code");
      expect(usage.tokens).toBeGreaterThan(0);
    });
  });

  describe("trackToolUse", () => {
    it("tracks tool use token usage", () => {
      trackToolUse("s1", '{"path": "/tmp"}', '{"content": "hello"}');
      const usage = getUsage("s1", "claude-code");
      expect(usage.tokens).toBeGreaterThan(0);
    });

    it("accumulates tokens across calls", () => {
      trackPrompt("s1", "first prompt");
      const usage1 = getUsage("s1", "claude-code");
      trackPrompt("s1", "second prompt");
      const usage2 = getUsage("s1", "claude-code");
      expect(usage2.tokens).toBeGreaterThan(usage1.tokens);
    });
  });

  describe("getUsage", () => {
    it("returns zero usage for unknown session", () => {
      const usage = getUsage("unknown", "claude-code");
      expect(usage.tokens).toBe(0);
      expect(usage.percentage).toBe(0);
      expect(usage.shouldSuggestLearn).toBe(false);
    });

    it("uses claude-code context window (200k)", () => {
      const usage = getUsage("s1", "claude-code");
      expect(usage.contextWindow).toBe(200_000);
    });

    it("uses copilot context window (128k)", () => {
      const usage = getUsage("s1", "copilot");
      expect(usage.contextWindow).toBe(128_000);
    });

    it("uses default context window for unknown agent", () => {
      const usage = getUsage("s1", "unknown-agent");
      expect(usage.contextWindow).toBe(128_000);
    });

    it("calculates percentage correctly", () => {
      // Track enough to be noticeable
      const bigPrompt = "x".repeat(400); // 100 tokens
      trackPrompt("s1", bigPrompt);
      const usage = getUsage("s1", "claude-code");
      expect(usage.percentage).toBeCloseTo(100 / 200_000, 5);
    });

    it("suggests learn when threshold exceeded", () => {
      // Fill up to threshold
      const threshold = SUGGEST_THRESHOLD;
      const contextWindow = 200_000;
      const neededTokens = Math.ceil(contextWindow * threshold) + 1;
      const chars = neededTokens * 4;
      trackPrompt("s1", "x".repeat(chars));
      const usage = getUsage("s1", "claude-code");
      expect(usage.shouldSuggestLearn).toBe(true);
    });
  });

  describe("markSuggested", () => {
    it("prevents further suggestions", () => {
      const contextWindow = 200_000;
      const neededTokens = Math.ceil(contextWindow * SUGGEST_THRESHOLD) + 1;
      trackPrompt("s1", "x".repeat(neededTokens * 4));

      expect(getUsage("s1", "claude-code").shouldSuggestLearn).toBe(true);
      markSuggested("s1");
      expect(getUsage("s1", "claude-code").shouldSuggestLearn).toBe(false);
    });

    it("no-ops for unknown session", () => {
      expect(() => markSuggested("unknown")).not.toThrow();
    });
  });

  describe("clearSession", () => {
    it("removes session usage data", () => {
      trackPrompt("s1", "hello");
      clearSession("s1");
      const usage = getUsage("s1", "claude-code");
      expect(usage.tokens).toBe(0);
    });
  });

  describe("isolated sessions", () => {
    it("tracks sessions independently", () => {
      trackPrompt("s1", "prompt for s1");
      trackPrompt("s2", "prompt for s2");
      const u1 = getUsage("s1", "claude-code");
      const u2 = getUsage("s2", "claude-code");
      expect(u1.tokens).toBeGreaterThan(0);
      expect(u2.tokens).toBeGreaterThan(0);
      clearSession("s1");
      expect(getUsage("s1", "claude-code").tokens).toBe(0);
      expect(getUsage("s2", "claude-code").tokens).toBeGreaterThan(0);
    });
  });
});
