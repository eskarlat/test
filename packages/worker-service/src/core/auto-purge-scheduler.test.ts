import { describe, it, expect, vi } from "vitest";

vi.mock("./logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

const mocks = vi.hoisted(() => ({
  purgePrompts: vi.fn().mockReturnValue(5),
  purgeErrors: vi.fn().mockReturnValue(3),
  purgeToolUsage: vi.fn().mockReturnValue(10),
  archiveSessions: vi.fn().mockReturnValue(2),
  archiveObservations: vi.fn().mockReturnValue(7),
}));

vi.mock("./prompt-journal.js", () => ({ purgeOld: mocks.purgePrompts }));
vi.mock("./error-intelligence.js", () => ({ purgeOld: mocks.purgeErrors }));
vi.mock("./tool-analytics.js", () => ({ purgeOld: mocks.purgeToolUsage }));
vi.mock("./session-memory.js", () => ({ archiveOldSessions: mocks.archiveSessions }));
vi.mock("./observations-service.js", () => ({ archiveStale: mocks.archiveObservations }));

import { runAutoPurge } from "./auto-purge-scheduler.js";
import { logger } from "./logger.js";

describe("runAutoPurge", () => {
  it("calls all purge functions with 30-day retention", () => {
    runAutoPurge();

    expect(mocks.purgePrompts).toHaveBeenCalledWith(30);
    expect(mocks.purgeErrors).toHaveBeenCalledWith(30);
    expect(mocks.purgeToolUsage).toHaveBeenCalledWith(30);
    expect(mocks.archiveSessions).toHaveBeenCalled();
    expect(mocks.archiveObservations).toHaveBeenCalled();
  });

  it("logs summary message", () => {
    runAutoPurge();
    expect(logger.info).toHaveBeenCalledWith("auto-purge", expect.stringContaining("Purged"));
  });

  it("handles errors gracefully", () => {
    mocks.purgePrompts.mockImplementationOnce(() => { throw new Error("DB locked"); });
    runAutoPurge();
    expect(logger.warn).toHaveBeenCalledWith("auto-purge", expect.stringContaining("DB locked"));
  });
});
