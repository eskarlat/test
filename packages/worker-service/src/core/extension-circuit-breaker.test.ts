import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ExtensionCircuitBreaker } from "./extension-circuit-breaker.js";

describe("ExtensionCircuitBreaker", () => {
  let cb: ExtensionCircuitBreaker;
  const projectId = "proj-1";
  const ext = "my-extension";

  beforeEach(() => {
    cb = new ExtensionCircuitBreaker();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is not suspended initially", () => {
    expect(cb.isSuspended(projectId, ext)).toBe(false);
    expect(cb.retryAfterMs(projectId, ext)).toBe(0);
  });

  it("does not suspend after 4 errors", () => {
    for (let i = 0; i < 4; i++) {
      const suspended = cb.recordError(projectId, ext);
      expect(suspended).toBe(false);
    }
    expect(cb.isSuspended(projectId, ext)).toBe(false);
  });

  it("suspends on the 5th error", () => {
    for (let i = 0; i < 4; i++) {
      cb.recordError(projectId, ext);
    }
    const suspended = cb.recordError(projectId, ext);
    expect(suspended).toBe(true);
    expect(cb.isSuspended(projectId, ext)).toBe(true);
  });

  it("retryAfterMs returns remaining cooldown time", () => {
    for (let i = 0; i < 5; i++) {
      cb.recordError(projectId, ext);
    }
    // First suspension: cooldown = MIN_COOLDOWN_MS * 2 = 120_000 (doubles on suspension)
    // Actually the initial cooldownMs is 60_000, then it doubles to 120_000 on first suspension
    const retry = cb.retryAfterMs(projectId, ext);
    expect(retry).toBe(120_000);

    // Advance 30 seconds
    vi.advanceTimersByTime(30_000);
    const retryAfter30s = cb.retryAfterMs(projectId, ext);
    expect(retryAfter30s).toBe(90_000);
  });

  it("recordSuccess resets error count and clears suspension", () => {
    for (let i = 0; i < 5; i++) {
      cb.recordError(projectId, ext);
    }
    expect(cb.isSuspended(projectId, ext)).toBe(true);

    cb.recordSuccess(projectId, ext);
    expect(cb.isSuspended(projectId, ext)).toBe(false);
    expect(cb.retryAfterMs(projectId, ext)).toBe(0);
  });

  it("reset clears state entirely", () => {
    for (let i = 0; i < 5; i++) {
      cb.recordError(projectId, ext);
    }
    expect(cb.isSuspended(projectId, ext)).toBe(true);

    cb.reset(projectId, ext);
    expect(cb.isSuspended(projectId, ext)).toBe(false);
    expect(cb.retryAfterMs(projectId, ext)).toBe(0);

    // After reset, should need 5 fresh errors to suspend again
    for (let i = 0; i < 4; i++) {
      cb.recordError(projectId, ext);
    }
    expect(cb.isSuspended(projectId, ext)).toBe(false);
  });

  it("auto-recovers after cooldown expires", () => {
    for (let i = 0; i < 5; i++) {
      cb.recordError(projectId, ext);
    }
    expect(cb.isSuspended(projectId, ext)).toBe(true);

    // First suspension cooldown is 120_000ms (60_000 * 2)
    vi.advanceTimersByTime(120_000);
    expect(cb.isSuspended(projectId, ext)).toBe(false);
  });

  it("doubles cooldown on consecutive suspensions (exponential backoff)", () => {
    // First suspension: cooldown becomes 120_000 (60_000 * 2)
    for (let i = 0; i < 5; i++) {
      cb.recordError(projectId, ext);
    }
    expect(cb.isSuspended(projectId, ext)).toBe(true);

    // Wait for cooldown to expire
    vi.advanceTimersByTime(120_000);
    expect(cb.isSuspended(projectId, ext)).toBe(false);

    // Second suspension: cooldown becomes 240_000 (120_000 * 2)
    for (let i = 0; i < 5; i++) {
      cb.recordError(projectId, ext);
    }
    expect(cb.isSuspended(projectId, ext)).toBe(true);

    // Should still be suspended at 239s
    vi.advanceTimersByTime(239_000);
    expect(cb.isSuspended(projectId, ext)).toBe(true);

    // Should recover at 240s
    vi.advanceTimersByTime(1_000);
    expect(cb.isSuspended(projectId, ext)).toBe(false);
  });

  it("caps cooldown at MAX_COOLDOWN_MS (15 minutes)", () => {
    // Drive cooldown up: 60k -> 120k -> 240k -> 480k -> 900k (capped)
    // Each suspension doubles, starting from 60_000
    // Suspension 1: 120_000
    // Suspension 2: 240_000
    // Suspension 3: 480_000
    // Suspension 4: 900_000 (capped at 15 * 60_000)
    // Suspension 5: still 900_000

    for (let cycle = 0; cycle < 5; cycle++) {
      for (let i = 0; i < 5; i++) {
        cb.recordError(projectId, ext);
      }
      // Let cooldown expire so we can trigger again
      vi.advanceTimersByTime(15 * 60_000);
    }

    // Trigger one more suspension
    for (let i = 0; i < 5; i++) {
      cb.recordError(projectId, ext);
    }

    const retry = cb.retryAfterMs(projectId, ext);
    expect(retry).toBeLessThanOrEqual(15 * 60_000);
  });

  it("resets error count when error window (60s) expires", () => {
    // Record 4 errors
    for (let i = 0; i < 4; i++) {
      cb.recordError(projectId, ext);
    }

    // Advance past the 60s error window
    vi.advanceTimersByTime(61_000);

    // Next error should be error #1 in a new window, not #5
    const suspended = cb.recordError(projectId, ext);
    expect(suspended).toBe(false);
    expect(cb.isSuspended(projectId, ext)).toBe(false);
  });

  it("tracks different extensions independently", () => {
    const extA = "ext-a";
    const extB = "ext-b";

    // Suspend ext-a
    for (let i = 0; i < 5; i++) {
      cb.recordError(projectId, extA);
    }
    expect(cb.isSuspended(projectId, extA)).toBe(true);
    expect(cb.isSuspended(projectId, extB)).toBe(false);

    // Errors on ext-b don't affect ext-a
    for (let i = 0; i < 3; i++) {
      cb.recordError(projectId, extB);
    }
    expect(cb.isSuspended(projectId, extB)).toBe(false);
  });

  it("tracks different projects independently", () => {
    const projA = "proj-a";
    const projB = "proj-b";

    for (let i = 0; i < 5; i++) {
      cb.recordError(projA, ext);
    }
    expect(cb.isSuspended(projA, ext)).toBe(true);
    expect(cb.isSuspended(projB, ext)).toBe(false);
  });
});
