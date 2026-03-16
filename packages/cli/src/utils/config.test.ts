import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return memfs.fs;
});

vi.mock("./paths.js", () => ({
  globalDir: () => "/home/test/.renre-kit",
  globalPaths: () => ({
    globalDir: "/home/test/.renre-kit",
    configFile: "/home/test/.renre-kit/config.json",
    dataDb: "/home/test/.renre-kit/data.db",
    extensionsDir: "/home/test/.renre-kit/extensions",
    scriptsDir: "/home/test/.renre-kit/scripts",
    logsDir: "/home/test/.renre-kit/logs",
    backupsDir: "/home/test/.renre-kit/backups",
    projectsDir: "/home/test/.renre-kit/projects",
    migrationsDir: "/home/test/.renre-kit/migrations",
  }),
}));

describe("config", () => {
  beforeEach(() => {
    vol.reset();
    vol.mkdirSync("/home/test/.renre-kit", { recursive: true });
  });

  afterEach(() => {
    vol.reset();
  });

  it("readConfig returns defaults when no config file exists", async () => {
    const { readConfig } = await import("./config.js");
    const config = readConfig();
    expect(config.port).toBe(42888);
    expect(config.logLevel).toBe("info");
    expect(config.marketplaces).toHaveLength(1);
    expect(config.backup.intervalHours).toBe(24);
    expect(config.backup.maxCount).toBe(10);
    expect(config.backup.maxAgeDays).toBe(30);
  });

  it("readConfig merges partial config with defaults", async () => {
    vol.writeFileSync(
      "/home/test/.renre-kit/config.json",
      JSON.stringify({ port: 9999, logLevel: "debug" }),
    );
    const { readConfig } = await import("./config.js");
    const config = readConfig();
    expect(config.port).toBe(9999);
    expect(config.logLevel).toBe("debug");
    // Defaults preserved for unset fields
    expect(config.marketplaces).toHaveLength(1);
    expect(config.backup.intervalHours).toBe(24);
  });

  it("readConfig deep-merges backup config", async () => {
    vol.writeFileSync(
      "/home/test/.renre-kit/config.json",
      JSON.stringify({ backup: { maxCount: 5 } }),
    );
    const { readConfig } = await import("./config.js");
    const config = readConfig();
    expect(config.backup.maxCount).toBe(5);
    expect(config.backup.intervalHours).toBe(24); // default preserved
    expect(config.backup.maxAgeDays).toBe(30); // default preserved
  });

  it("writeConfig creates config file", async () => {
    const { writeConfig, readConfig } = await import("./config.js");
    writeConfig({
      port: 5555,
      logLevel: "warn",
      marketplaces: [],
      backup: { intervalHours: 12, maxCount: 5, maxAgeDays: 7 },
    });
    const config = readConfig();
    expect(config.port).toBe(5555);
    expect(config.logLevel).toBe("warn");
    expect(config.backup.intervalHours).toBe(12);
  });

  it("ensureDefaultConfig creates config when missing", async () => {
    const { ensureDefaultConfig } = await import("./config.js");
    const config = ensureDefaultConfig();
    expect(config.port).toBe(42888);
    // Verify file was created
    const exists = vol.existsSync("/home/test/.renre-kit/config.json");
    expect(exists).toBe(true);
  });

  it("ensureDefaultConfig reads existing config", async () => {
    vol.writeFileSync(
      "/home/test/.renre-kit/config.json",
      JSON.stringify({ port: 7777 }),
    );
    const { ensureDefaultConfig } = await import("./config.js");
    const config = ensureDefaultConfig();
    expect(config.port).toBe(7777);
  });
});
