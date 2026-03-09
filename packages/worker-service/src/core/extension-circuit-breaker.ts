interface CircuitBreakerState {
  errorCount: number;
  windowStart: number;
  suspended: boolean;
  suspendedAt: number;
  cooldownMs: number;
}

const MAX_ERRORS = 5;
const ERROR_WINDOW_MS = 60_000;
const MIN_COOLDOWN_MS = 60_000;
const MAX_COOLDOWN_MS = 15 * 60_000;

export class ExtensionCircuitBreaker {
  private readonly states = new Map<string, CircuitBreakerState>();

  private key(projectId: string, extensionName: string): string {
    return `${projectId}:${extensionName}`;
  }

  isSuspended(projectId: string, extensionName: string): boolean {
    const state = this.states.get(this.key(projectId, extensionName));
    if (!state?.suspended) return false;

    const now = Date.now();
    if (now - state.suspendedAt >= state.cooldownMs) {
      // Cooldown expired, allow retry
      state.suspended = false;
      state.errorCount = 0;
      return false;
    }
    return true;
  }

  retryAfterMs(projectId: string, extensionName: string): number {
    const state = this.states.get(this.key(projectId, extensionName));
    if (!state?.suspended) return 0;
    const remaining = state.cooldownMs - (Date.now() - state.suspendedAt);
    return Math.max(0, remaining);
  }

  recordSuccess(projectId: string, extensionName: string): void {
    const key = this.key(projectId, extensionName);
    const state = this.states.get(key);
    if (state) {
      state.errorCount = 0;
      state.suspended = false;
    }
  }

  recordError(projectId: string, extensionName: string): boolean {
    const key = this.key(projectId, extensionName);
    const now = Date.now();
    let state = this.states.get(key);

    if (!state) {
      state = {
        errorCount: 0,
        windowStart: now,
        suspended: false,
        suspendedAt: 0,
        cooldownMs: MIN_COOLDOWN_MS,
      };
      this.states.set(key, state);
    }

    // Reset window if expired
    if (now - state.windowStart > ERROR_WINDOW_MS) {
      state.errorCount = 0;
      state.windowStart = now;
    }

    state.errorCount++;

    if (state.errorCount >= MAX_ERRORS) {
      state.suspended = true;
      state.suspendedAt = now;
      // Double cooldown on consecutive suspensions, cap at max
      state.cooldownMs = Math.min(state.cooldownMs * 2, MAX_COOLDOWN_MS);
      return true; // newly suspended
    }
    return false;
  }

  reset(projectId: string, extensionName: string): void {
    this.states.delete(this.key(projectId, extensionName));
  }
}

export const circuitBreaker = new ExtensionCircuitBreaker();
