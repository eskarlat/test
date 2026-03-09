import { Router, type Request, type Response } from "express";
import { createPeriodicBackup, checkDatabaseIntegrity, findLatestBackup } from "../core/backup-manager.js";
import { logger } from "../core/logger.js";

const router = Router();

router.post("/api/backup", (_req: Request, res: Response) => {
  try {
    const backupPath = createPeriodicBackup();
    if (!backupPath) {
      res.status(404).json({ error: "No database to backup" });
      return;
    }
    res.json({ ok: true, path: backupPath });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("backup", `Manual backup failed: ${msg}`);
    res.status(500).json({ error: msg });
  }
});

router.get("/api/backup/status", (_req: Request, res: Response) => {
  const healthy = checkDatabaseIntegrity();
  const latest = findLatestBackup();
  res.json({ healthy, latestBackup: latest });
});

export default router;
