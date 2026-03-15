import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock logger
vi.mock("../core/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock backup-manager
vi.mock("../core/backup-manager.js", () => ({
  createPeriodicBackup: vi.fn().mockReturnValue("/tmp/backup.db"),
  checkDatabaseIntegrity: vi.fn().mockReturnValue(true),
  findLatestBackup: vi.fn().mockReturnValue("/tmp/latest-backup.db"),
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./backup.js";
import {
  createPeriodicBackup,
  checkDatabaseIntegrity,
  findLatestBackup,
} from "../core/backup-manager.js";

describe("backup routes", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp(router);
  });

  // -------------------------------------------------------------------------
  // POST /api/backup
  // -------------------------------------------------------------------------

  describe("POST /api/backup", () => {
    it("creates backup and returns path", async () => {
      const res = await request(app, "POST", "/api/backup");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["ok"]).toBe(true);
      expect(body["path"]).toBe("/tmp/backup.db");
      expect(createPeriodicBackup).toHaveBeenCalled();
    });

    it("returns 404 when no database to backup", async () => {
      (createPeriodicBackup as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const res = await request(app, "POST", "/api/backup");
      expect(res.status).toBe(404);
      const body = res.body as Record<string, unknown>;
      expect(body["error"]).toContain("No database");
    });

    it("returns 500 on backup error", async () => {
      (createPeriodicBackup as ReturnType<typeof vi.fn>).mockImplementation(() => {
        throw new Error("Disk full");
      });
      const res = await request(app, "POST", "/api/backup");
      expect(res.status).toBe(500);
      const body = res.body as Record<string, unknown>;
      expect(body["error"]).toContain("Disk full");
    });
  });

  // -------------------------------------------------------------------------
  // GET /api/backup/status
  // -------------------------------------------------------------------------

  describe("GET /api/backup/status", () => {
    it("returns healthy status with latest backup", async () => {
      const res = await request(app, "GET", "/api/backup/status");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["healthy"]).toBe(true);
      expect(body["latestBackup"]).toBe("/tmp/latest-backup.db");
      expect(checkDatabaseIntegrity).toHaveBeenCalled();
      expect(findLatestBackup).toHaveBeenCalled();
    });

    it("returns unhealthy status", async () => {
      (checkDatabaseIntegrity as ReturnType<typeof vi.fn>).mockReturnValue(false);
      (findLatestBackup as ReturnType<typeof vi.fn>).mockReturnValue(null);
      const res = await request(app, "GET", "/api/backup/status");
      expect(res.status).toBe(200);
      const body = res.body as Record<string, unknown>;
      expect(body["healthy"]).toBe(false);
      expect(body["latestBackup"]).toBeNull();
    });
  });
});
