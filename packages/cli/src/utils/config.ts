import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { globalPaths } from "./paths.js";
import { DEFAULT_MARKETPLACE_URL } from "../shared/urls.js";

export interface MarketplaceConfig {
  name: string;
  url: string;
}

export interface BackupConfig {
  intervalHours: number;
  maxCount: number;
  maxAgeDays: number;
}

export interface Config {
  port: number;
  logLevel: "error" | "warn" | "info" | "debug";
  marketplaces: MarketplaceConfig[];
  backup: BackupConfig;
}

const DEFAULTS: Config = {
  port: 42888,
  logLevel: "info",
  marketplaces: [
    {
      name: "RenRe Kit Official Marketplace",
      url: DEFAULT_MARKETPLACE_URL,
    },
  ],
  backup: {
    intervalHours: 24,
    maxCount: 10,
    maxAgeDays: 30,
  },
};

export function readConfig(): Config {
  const paths = globalPaths();
  if (!existsSync(paths.configFile)) {
    return { ...DEFAULTS };
  }
  const raw = readFileSync(paths.configFile, "utf8");
  const parsed = JSON.parse(raw) as Partial<Config>;
  return {
    ...DEFAULTS,
    ...parsed,
    backup: { ...DEFAULTS.backup, ...(parsed.backup ?? {}) },
  };
}

export function writeConfig(config: Config): void {
  const paths = globalPaths();
  mkdirSync(paths.globalDir, { recursive: true });
  writeFileSync(paths.configFile, JSON.stringify(config, null, 2) + "\n", "utf8");
}

export function ensureDefaultConfig(): Config {
  const paths = globalPaths();
  if (!existsSync(paths.configFile)) {
    const config = { ...DEFAULTS };
    writeConfig(config);
    return config;
  }
  return readConfig();
}
