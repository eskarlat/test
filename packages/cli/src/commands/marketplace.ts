import { Command } from "commander";
import * as clack from "@clack/prompts";
import pc from "picocolors";
import { readConfig, writeConfig } from "../utils/config.js";
import { findProjectDir } from "../utils/paths.js";
import { formatTable } from "../utils/formatter.js";
import * as log from "../utils/logger.js";
import {
  loadCache,
  refreshCache,
  searchExtensions,
  resolveExtension,
  isCacheStale,
  type MarketplaceCache,
} from "../services/marketplace-client.js";
import {
  validateAndInstall,
  uninstallExtension,
  installFromLocal,
  formatPermissions,
} from "../services/extension-installer.js";
import {
  readExtensionsJson,
  writeExtensionsJson,
  readProjectJson,
} from "../services/project-manager.js";
import {
  notifyExtensionReload,
  notifyExtensionUnload,
  notifyExtensionUpgrade,
  notifyExtensionEnable,
  notifyExtensionDisable,
  readServerState,
} from "../services/server-client.js";

async function getOrRefreshCache(): Promise<{ cache: MarketplaceCache; warned: boolean }> {
  const config = readConfig();
  let cache = loadCache();
  let warned = false;

  if (!cache || isCacheStale(cache)) {
    const spin = log.spinner("Refreshing marketplace index...");
    try {
      cache = await refreshCache(config.marketplaces);
      spin.stop("Marketplace index updated");
    } catch {
      spin.stop(pc.yellow("Failed to refresh marketplace index — using stale cache"));
      warned = true;
      if (!cache) {
        cache = { marketplaces: [], fetchedAt: new Date().toISOString() };
      }
    }
  }

  return { cache, warned };
}

function getProjectContext(): { projectDir: string; projectId: string } | null {
  const projectDir = findProjectDir();
  if (!projectDir) return null;
  const projectJson = readProjectJson(projectDir);
  if (!projectJson) return null;
  return { projectDir, projectId: projectJson.id };
}

function isServerRunning(): boolean {
  const state = readServerState();
  return state !== null;
}

async function tryNotifyReload(projectId: string, name: string): Promise<void> {
  if (!isServerRunning()) return;
  await notifyExtensionReload(projectId, name);
}

async function tryNotifyUnload(projectId: string, name: string): Promise<void> {
  if (!isServerRunning()) return;
  await notifyExtensionUnload(projectId, name);
}

async function tryNotifyUpgrade(projectId: string, name: string, targetVersion: string): Promise<void> {
  if (!isServerRunning()) return;
  await notifyExtensionUpgrade(projectId, name, targetVersion);
}

async function runInstall(
  installArg: string,
  opts: { yes?: boolean; local?: string; version?: string },
): Promise<void> {
  const ctx = getProjectContext();
  if (!ctx) {
    log.error("No RenRe Kit project found. Run `renre-kit init` first.");
    process.exit(1);
  }

  const interactive = log.isInteractive();

  // Local install path
  if (opts.local) {
    const name = installArg;
    const version = opts.version ?? "local";
    log.info(`Installing ${name} from local path: ${opts.local}`);
    try {
      const extensionDir = installFromLocal(name, version, opts.local);
      const extJson = readExtensionsJson(ctx.projectDir) ?? { extensions: [] };
      const existingIdx = extJson.extensions.findIndex((e) => e.name === name);
      const entry = { name, version, enabled: true, source: opts.local!, marketplace: "local", settings: {} };
      if (existingIdx >= 0) {
        extJson.extensions[existingIdx] = entry;
      } else {
        extJson.extensions.push(entry);
      }
      writeExtensionsJson(ctx.projectDir, extJson);
      log.success(`Installed ${name}@${version} from ${extensionDir}`);
      await tryNotifyReload(ctx.projectId, name);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error(`Installation failed: ${msg}`);
      process.exit(1);
    }
    return;
  }

  const { cache } = await getOrRefreshCache();
  const resolved = resolveExtension(cache, installArg);

  if (!resolved) {
    log.error(`Extension "${installArg}" not found in any marketplace.`);
    process.exit(1);
  }

  const { marketplaceName, ext } = resolved;
  const version = opts.version ?? ext.version;

  log.info(`Found ${ext.name}@${version} in ${marketplaceName}`);

  const result = await validateAndInstall(
    {
      projectDir: ctx.projectDir,
      name: ext.name,
      version,
      repository: ext.repository,
      marketplace: marketplaceName,
      yes: opts.yes,
    },
    interactive,
  );

  if (!result.success) {
    log.error(`Installation failed: ${result.error ?? "unknown error"}`);
    process.exit(1);
  }

  log.success(`Installed ${ext.name}@${version}`);
  await tryNotifyReload(ctx.projectId, ext.name);
}

async function runRemove(extensionName: string, opts: { yes?: boolean }): Promise<void> {
  const ctx = getProjectContext();
  if (!ctx) {
    log.error("No RenRe Kit project found.");
    process.exit(1);
  }

  const interactive = log.isInteractive();

  if (interactive && !opts.yes) {
    const confirmed = await clack.confirm({ message: `Remove extension "${extensionName}"?` });
    if (clack.isCancel(confirmed) || !confirmed) {
      log.info("Removal cancelled.");
      return;
    }
  }

  await tryNotifyUnload(ctx.projectId, extensionName);
  uninstallExtension(ctx.projectDir, extensionName);
  log.success(`Removed ${extensionName}`);
}

async function runUpgrade(extensionName: string | undefined, opts: { all?: boolean; yes?: boolean }): Promise<void> {
  const ctx = getProjectContext();
  if (!ctx) {
    log.error("No RenRe Kit project found.");
    process.exit(1);
  }

  const { cache } = await getOrRefreshCache();
  const extJson = readExtensionsJson(ctx.projectDir);
  if (!extJson || extJson.extensions.length === 0) {
    log.info("No extensions installed.");
    return;
  }

  const allExtensions = opts.all ? extJson.extensions : [];
  const toUpgrade = extensionName
    ? extJson.extensions.filter((e) => e.name === extensionName)
    : allExtensions;

  if (toUpgrade.length === 0 && !extensionName) {
    log.warn("Specify an extension name or use --all to upgrade all extensions.");
    return;
  }

  if (toUpgrade.length === 0) {
    log.error(`Extension "${extensionName ?? ""}" not found.`);
    process.exit(1);
  }

  const interactive = log.isInteractive();

  for (const installed of toUpgrade) {
    const resolved = resolveExtension(cache, installed.name);
    if (!resolved) {
      log.warn(`${installed.name}: not found in marketplace, skipping.`);
      continue;
    }

    const { ext, marketplaceName } = resolved;
    if (ext.version === installed.version) {
      log.info(`${installed.name}: already at latest version ${installed.version}`);
      continue;
    }

    log.info(`Upgrading ${installed.name}: ${installed.version} → ${ext.version}`);

    // Check for new permissions in the upgraded version
    if (ext.permissions && interactive && !opts.yes) {
      const newPerms = formatPermissions(ext.permissions as Record<string, unknown>);
      log.info(`Permissions for ${installed.name}@${ext.version}:\n${newPerms}`);
      const accepted = await clack.confirm({ message: "Accept permissions for upgraded version?" });
      if (clack.isCancel(accepted) || !accepted) {
        log.info(`Skipping upgrade for ${installed.name}: permissions not accepted.`);
        continue;
      }
    }

    // Check for new required settings in the upgraded version
    if (ext.settings && Array.isArray((ext.settings as { schema?: unknown[] }).schema)) {
      const schema = (ext.settings as { schema: Array<{ key: string; required?: boolean }> }).schema;
      const existingSettings = installed.settings ?? {};
      const missingRequired = schema.filter(
        (s) => s.required && !(s.key in (existingSettings as Record<string, unknown>)),
      );
      if (missingRequired.length > 0) {
        const keys = missingRequired.map((s) => s.key).join(", ");
        log.warn(
          `${installed.name}@${ext.version} requires new settings: ${keys}. ` +
          `Configure after upgrade via \`renre-kit marketplace list\` or the Console UI.`,
        );
      }
    }

    const result = await validateAndInstall(
      {
        projectDir: ctx.projectDir,
        name: installed.name,
        version: ext.version,
        repository: ext.repository,
        marketplace: marketplaceName,
        yes: opts.yes,
      },
      interactive,
    );

    if (!result.success) {
      log.error(`Upgrade failed for ${installed.name}: ${result.error ?? "unknown error"}`);
      continue;
    }

    log.success(`Upgraded ${installed.name} to ${ext.version}`);
    await tryNotifyUpgrade(ctx.projectId, installed.name, ext.version);
  }
}

function runSearch(query: string | undefined): void {
  const ctx = getProjectContext();
  const cache = loadCache();

  if (!cache) {
    log.warn("Marketplace cache is empty. Run `renre-kit marketplace list` to populate.");
    return;
  }

  const results = searchExtensions(cache, query ?? "");

  if (results.length === 0) {
    log.info(query ? `No extensions found matching "${query}".` : "No extensions found.");
    return;
  }

  const installedNames = new Set<string>();
  if (ctx) {
    const extJson = readExtensionsJson(ctx.projectDir);
    for (const e of extJson?.extensions ?? []) {
      installedNames.add(e.name);
    }
  }

  const rows = results.map((r) => [
    r.name,
    r.version,
    r.marketplace,
    r.description.length > 50 ? r.description.slice(0, 47) + "..." : r.description,
    installedNames.has(r.name) ? pc.green("yes") : "no",
  ]);

  console.log(formatTable(["Name", "Version", "Marketplace", "Description", "Installed"], rows));
}

function runList(): void {
  const ctx = getProjectContext();
  if (!ctx) {
    log.error("No RenRe Kit project found.");
    process.exit(1);
  }

  const extJson = readExtensionsJson(ctx.projectDir);
  if (!extJson || extJson.extensions.length === 0) {
    log.info("No extensions installed.");
    return;
  }

  const cache = loadCache();

  const rows = extJson.extensions.map((e) => {
    let updateAvailable = "no";
    if (cache) {
      const resolved = resolveExtension(cache, e.name);
      if (resolved && resolved.ext.version !== e.version) {
        updateAvailable = pc.yellow(`yes (${resolved.ext.version})`);
      }
    }
    return [e.name, e.version, e.marketplace ?? e.source, e.enabled ? pc.green("yes") : pc.dim("no"), updateAvailable];
  });

  console.log(formatTable(["Name", "Version", "Source", "Enabled", "Update Available"], rows));
}

function runRegister(url: string, opts: { name: string }): void {
  const config = readConfig();
  const existing = config.marketplaces.find((m) => m.name === opts.name || m.url === url);
  if (existing) {
    log.warn(`Marketplace "${opts.name}" already registered.`);
    return;
  }
  config.marketplaces.push({ name: opts.name, url });
  writeConfig(config);
  log.success(`Registered marketplace "${opts.name}" at ${url}`);
}

function runUnregister(name: string): void {
  const config = readConfig();
  const before = config.marketplaces.length;
  config.marketplaces = config.marketplaces.filter((m) => m.name !== name);
  if (config.marketplaces.length === before) {
    log.warn(`Marketplace "${name}" not found.`);
    return;
  }
  writeConfig(config);
  log.success(`Unregistered marketplace "${name}"`);
}

function runListSources(): void {
  const config = readConfig();
  if (config.marketplaces.length === 0) {
    log.info("No marketplaces configured.");
    return;
  }
  const rows = config.marketplaces.map((m) => [m.name, m.url]);
  console.log(formatTable(["Name", "URL"], rows));
}

export function registerMarketplaceCommand(program: Command): void {
  const mp = program
    .command("marketplace")
    .description("Marketplace and extension management");

  // marketplace add
  mp
    .command("add [extension]")
    .alias("install")
    .description("Install an extension from the marketplace")
    .option("-y, --yes", "Skip interactive prompts")
    .option("--local <path>", "Install from a local directory path")
    .option("--version <ver>", "Override version to install")
    .action(async (extension: string | undefined, opts: { yes?: boolean; local?: string; version?: string }) => {
      if (!extension && !opts.local) {
        log.error("Specify an extension name or use --local <path>.");
        process.exit(1);
      }
      await runInstall(extension ?? "", opts);
    });

  // marketplace remove
  mp
    .command("remove <extension>")
    .alias("uninstall")
    .description("Remove an installed extension")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (extension: string, opts: { yes?: boolean }) => {
      await runRemove(extension, opts);
    });

  // marketplace upgrade
  mp
    .command("upgrade [extension]")
    .description("Upgrade an installed extension to the latest version")
    .option("--all", "Upgrade all installed extensions")
    .option("-y, --yes", "Skip interactive prompts")
    .action(async (extension: string | undefined, opts: { all?: boolean; yes?: boolean }) => {
      await runUpgrade(extension, opts);
    });

  // marketplace search
  mp
    .command("search [query]")
    .description("Search for extensions in the marketplace")
    .action(async (query: string | undefined) => {
      if (!loadCache()) {
        await getOrRefreshCache();
      }
      runSearch(query);
    });

  // marketplace list
  mp
    .command("list")
    .description("List installed extensions")
    .action(() => {
      runList();
    });

  // marketplace register
  mp
    .command("register <url>")
    .description("Register a new marketplace source")
    .requiredOption("--name <name>", "Name for the marketplace")
    .action((url: string, opts: { name: string }) => {
      runRegister(url, opts);
    });

  // marketplace unregister
  mp
    .command("unregister <name>")
    .description("Remove a registered marketplace source")
    .action((name: string) => {
      runUnregister(name);
    });

  // marketplace list-sources
  mp
    .command("list-sources")
    .description("List registered marketplace sources")
    .action(() => {
      runListSources();
    });

  // marketplace enable
  mp
    .command("enable <extension>")
    .description("Enable a disabled extension")
    .action(async (extension: string) => {
      const ctx = getProjectContext();
      if (!ctx) {
        log.error("No RenRe Kit project found.");
        process.exit(1);
      }

      const extJson = readExtensionsJson(ctx.projectDir);
      if (!extJson) {
        log.error("No extensions installed.");
        process.exit(1);
      }
      const entry = extJson.extensions.find((e) => e.name === extension);
      if (!entry) {
        log.error(`Extension "${extension}" not installed.`);
        process.exit(1);
      }
      if (entry.enabled) {
        log.info(`Extension "${extension}" is already enabled.`);
        return;
      }

      entry.enabled = true;
      writeExtensionsJson(ctx.projectDir, extJson);
      log.success(`Enabled ${extension}`);

      if (isServerRunning()) {
        await notifyExtensionEnable(ctx.projectId, extension);
      }
    });

  // marketplace disable
  mp
    .command("disable <extension>")
    .description("Disable an extension without removing it")
    .action(async (extension: string) => {
      const ctx = getProjectContext();
      if (!ctx) {
        log.error("No RenRe Kit project found.");
        process.exit(1);
      }

      const extJson = readExtensionsJson(ctx.projectDir);
      if (!extJson) {
        log.error("No extensions installed.");
        process.exit(1);
      }
      const entry = extJson.extensions.find((e) => e.name === extension);
      if (!entry) {
        log.error(`Extension "${extension}" not installed.`);
        process.exit(1);
      }
      if (!entry.enabled) {
        log.info(`Extension "${extension}" is already disabled.`);
        return;
      }

      entry.enabled = false;
      writeExtensionsJson(ctx.projectDir, extJson);
      log.success(`Disabled ${extension}`);

      if (isServerRunning()) {
        await notifyExtensionDisable(ctx.projectId, extension);
      }
    });
}
