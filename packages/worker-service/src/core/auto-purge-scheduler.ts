import { logger } from "./logger.js";
import { purgeOld as purgePrompts } from "./prompt-journal.js";
import { purgeOld as purgeErrors } from "./error-intelligence.js";
import { purgeOld as purgeToolUsage } from "./tool-analytics.js";
import { archiveOldSessions } from "./session-memory.js";
import { archiveStale as archiveStaleObservations } from "./observations-service.js";

export function runAutoPurge(): void {
  try {
    const purgedPrompts = purgePrompts(30);
    const purgedErrors = purgeErrors(30);
    const purgedTools = purgeToolUsage(30);
    const archivedSessions = archiveOldSessions();
    const archivedObservations = archiveStaleObservations();

    logger.info(
      "auto-purge",
      `Purged ${purgedPrompts} old prompts, ${purgedErrors} old errors, ` +
        `${purgedTools} old tool records, archived ${archivedSessions} sessions, ` +
        `archived ${archivedObservations} stale observations`,
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn("auto-purge", `Auto-purge encountered an error: ${msg}`);
  }
}
