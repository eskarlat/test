import { describe, it, expect, vi, beforeEach } from "vitest";

/* ── hoisted mock functions ─────────────────────────────────────────── */
const mocks = vi.hoisted(() => {
  const fakeNetServer = {
    once: vi.fn((event: string, cb: () => void) => {
      // Simulate port available immediately
      if (event === "listening") Promise.resolve().then(cb);
    }),
    listen: vi.fn(),
    close: vi.fn(),
  };

  const fakeHttpServer = {
    listen: vi.fn((_port: number, _host: string, cb?: () => void) => {
      if (cb) cb();
    }),
    close: vi.fn((cb?: () => void) => { if (cb) cb(); }),
    on: vi.fn(),
  };

  const fakeIO = {
    close: vi.fn((cb?: () => void) => { if (cb) cb(); }),
    on: vi.fn(),
  };

  return {
    // fs
    existsSync: vi.fn(() => false),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
    readFileSync: vi.fn(() => "{}"),
    copyFileSync: vi.fn(),
    readdirSync: vi.fn(() => []),
    // app
    createApp: vi.fn(() => ({})),
    // socket.io
    SocketIOServer: vi.fn(() => fakeIO),
    fakeIO,
    // db-manager
    dbManager: {
      initialize: vi.fn(),
      runCoreMigrations: vi.fn(),
      close: vi.fn(),
      getConnection: vi.fn(() => ({})),
    },
    // extension-registry
    startMemoryMonitor: vi.fn(),
    getExtensionRegistry: vi.fn(() => new Map()),
    // logger
    loggerInfo: vi.fn(),
    loggerWarn: vi.fn(),
    loggerError: vi.fn(),
    setLogLevel: vi.fn(),
    // paths
    globalPaths: vi.fn(() => ({
      globalDir: "/fake/.renre-kit",
      configFile: "/fake/.renre-kit/config.json",
      dataDb: "/fake/.renre-kit/data.db",
      serverPid: "/fake/.renre-kit/server.pid",
      serverJson: "/fake/.renre-kit/server.json",
      extensionsDir: "/fake/.renre-kit/extensions",
      logsDir: "/fake/.renre-kit/logs",
      scriptsDir: "/fake/.renre-kit/scripts",
      backupsDir: "/fake/.renre-kit/backups",
      coreMigrationsDir: "/fake/.renre-kit/migrations/core",
    })),
    // backup-manager
    shouldRunPeriodicBackup: vi.fn(() => false),
    createPeriodicBackup: vi.fn(),
    pruneBackups: vi.fn(),
    // platform
    setFilePermissions: vi.fn(),
    // server-port
    setServerPort: vi.fn(),
    // update-checker
    checkAndEmitUpdates: vi.fn(() => Promise.resolve()),
    // projects
    getProjectRegistry: vi.fn(() => new Map()),
    // auto-purge
    runAutoPurge: vi.fn(),
    // copilot-bridge
    copilotBridge: { setIO: vi.fn(), shutdown: vi.fn(() => Promise.resolve()) },
    // socket-bridge
    attachSocketBridge: vi.fn(),
    // extension-loader
    setExtensionLoaderIO: vi.fn(),
    // ext-cron
    setExtCronDb: vi.fn(),
    // worktree-manager
    WorktreeManager: vi.fn(() => ({
      start: vi.fn(() => Promise.resolve()),
      stop: vi.fn(),
    })),
    setWorktreeManager: vi.fn(),
    // automation-engine
    AutomationEngine: vi.fn(() => ({
      setCopilotBridge: vi.fn(),
      setWorktreeManager: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    })),
    setAutomationEngine: vi.fn(),
    setAutomationCopilotBridge: vi.fn(),
    setAutomationDb: vi.fn(),
    // net
    createNetServer: vi.fn(() => fakeNetServer),
    fakeNetServer,
    // http
    createHttpServer: vi.fn(() => fakeHttpServer),
    fakeHttpServer,
    // os
    networkInterfaces: vi.fn(() => ({})),
  };
});

/* ── vi.mock calls ──────────────────────────────────────────────────── */

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
  writeFileSync: mocks.writeFileSync,
  unlinkSync: mocks.unlinkSync,
  readFileSync: mocks.readFileSync,
  copyFileSync: mocks.copyFileSync,
  readdirSync: mocks.readdirSync,
}));

vi.mock("node:net", () => ({
  createServer: mocks.createNetServer,
}));

vi.mock("node:http", () => ({
  createServer: mocks.createHttpServer,
}));

vi.mock("node:os", () => ({
  networkInterfaces: mocks.networkInterfaces,
}));

vi.mock("./app.js", () => ({ createApp: mocks.createApp }));
vi.mock("socket.io", () => ({
  Server: mocks.SocketIOServer,
}));
vi.mock("./core/db-manager.js", () => ({ dbManager: mocks.dbManager }));
vi.mock("./core/extension-registry.js", () => ({
  startMemoryMonitor: mocks.startMemoryMonitor,
  getRegistry: mocks.getExtensionRegistry,
}));
vi.mock("./core/logger.js", () => ({
  logger: {
    info: mocks.loggerInfo,
    warn: mocks.loggerWarn,
    error: mocks.loggerError,
    debug: vi.fn(),
  },
  setLogLevel: mocks.setLogLevel,
}));
vi.mock("./core/paths.js", () => ({ globalPaths: mocks.globalPaths }));
vi.mock("./core/backup-manager.js", () => ({
  shouldRunPeriodicBackup: mocks.shouldRunPeriodicBackup,
  createPeriodicBackup: mocks.createPeriodicBackup,
  pruneBackups: mocks.pruneBackups,
}));
vi.mock("./shared/platform.js", () => ({
  setFilePermissions: mocks.setFilePermissions,
}));
vi.mock("./core/server-port.js", () => ({
  setServerPort: mocks.setServerPort,
}));
vi.mock("./core/update-checker.js", () => ({
  checkAndEmitUpdates: mocks.checkAndEmitUpdates,
}));
vi.mock("./routes/projects.js", () => ({
  getRegistry: mocks.getProjectRegistry,
}));
vi.mock("./core/auto-purge-scheduler.js", () => ({
  runAutoPurge: mocks.runAutoPurge,
}));
vi.mock("./core/copilot-bridge.js", () => ({
  copilotBridge: mocks.copilotBridge,
}));
vi.mock("./core/socket-bridge.js", () => ({
  attachSocketBridge: mocks.attachSocketBridge,
}));
vi.mock("./core/extension-loader.js", () => ({
  setExtensionLoaderIO: mocks.setExtensionLoaderIO,
}));
vi.mock("./routes/ext-cron.js", () => ({
  setExtCronDb: mocks.setExtCronDb,
}));
vi.mock("./core/worktree-manager.js", () => ({
  WorktreeManager: mocks.WorktreeManager,
}));
vi.mock("./routes/worktrees.js", () => ({
  setWorktreeManager: mocks.setWorktreeManager,
}));
vi.mock("./core/automation-engine.js", () => ({
  AutomationEngine: mocks.AutomationEngine,
}));
vi.mock("./routes/automations.js", () => ({
  setAutomationEngine: mocks.setAutomationEngine,
  setCopilotBridge: mocks.setAutomationCopilotBridge,
  setDb: mocks.setAutomationDb,
}));

/* ── import module under test (after all mocks) ─────────────────────
   NOTE: importing index.ts triggers `void main()` which runs the full
   startup sequence using our mocks. We wait for it to settle before
   running tests.
   ─────────────────────────────────────────────────────────────────── */

import { getSocketIO, getWorktreeManager } from "./index.js";

// Allow main() to finish before tests run
beforeEach(async () => {
  // Give the microtask-based main() time to complete
  await new Promise((r) => setTimeout(r, 50));
});

describe("index.ts — main() startup sequence", () => {
  it("initializes database", () => {
    expect(mocks.dbManager.initialize).toHaveBeenCalled();
  });

  it("runs core migrations", () => {
    expect(mocks.dbManager.runCoreMigrations).toHaveBeenCalled();
  });

  it("creates required global directories", () => {
    expect(mocks.mkdirSync).toHaveBeenCalledWith("/fake/.renre-kit", { recursive: true });
    expect(mocks.mkdirSync).toHaveBeenCalledWith("/fake/.renre-kit/logs", { recursive: true });
    expect(mocks.mkdirSync).toHaveBeenCalledWith("/fake/.renre-kit/backups", { recursive: true });
  });

  it("logs startup message", () => {
    expect(mocks.loggerInfo).toHaveBeenCalledWith("worker", "Worker service starting...");
  });

  it("creates Express app", () => {
    expect(mocks.createApp).toHaveBeenCalled();
  });

  it("creates HTTP server wrapping Express app", () => {
    expect(mocks.createHttpServer).toHaveBeenCalled();
  });

  it("creates Socket.IO server with CORS and recovery options", () => {
    expect(mocks.SocketIOServer).toHaveBeenCalledWith(
      mocks.fakeHttpServer,
      expect.objectContaining({
        cors: { origin: "*" },
        pingInterval: 25000,
        pingTimeout: 20000,
        connectionStateRecovery: { maxDisconnectionDuration: 120000 },
      }),
    );
  });

  it("wires Socket.IO into copilot bridge and socket bridge", () => {
    expect(mocks.copilotBridge.setIO).toHaveBeenCalled();
    expect(mocks.attachSocketBridge).toHaveBeenCalled();
    expect(mocks.setExtensionLoaderIO).toHaveBeenCalled();
  });

  it("sets ext-cron db connection", () => {
    expect(mocks.setExtCronDb).toHaveBeenCalled();
  });

  it("initializes WorktreeManager and wires into routes", () => {
    expect(mocks.WorktreeManager).toHaveBeenCalled();
    expect(mocks.setWorktreeManager).toHaveBeenCalled();
  });

  it("initializes AutomationEngine and wires dependencies", () => {
    expect(mocks.AutomationEngine).toHaveBeenCalled();
    expect(mocks.setAutomationEngine).toHaveBeenCalled();
    expect(mocks.setAutomationCopilotBridge).toHaveBeenCalled();
    expect(mocks.setAutomationDb).toHaveBeenCalled();
  });

  it("starts HTTP server listening on 0.0.0.0", () => {
    expect(mocks.fakeHttpServer.listen).toHaveBeenCalledWith(
      expect.any(Number),
      "0.0.0.0",
      expect.any(Function),
    );
  });

  it("writes PID file in listen callback", () => {
    // The listen callback calls writePidFile which writes server.pid and server.json
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      "/fake/.renre-kit/server.pid",
      expect.stringContaining(String(process.pid)),
      "utf8",
    );
    expect(mocks.writeFileSync).toHaveBeenCalledWith(
      "/fake/.renre-kit/server.json",
      expect.any(String),
      "utf8",
    );
  });

  it("sets file permissions on PID files", () => {
    expect(mocks.setFilePermissions).toHaveBeenCalledWith(
      "/fake/.renre-kit/server.pid",
      0o600,
    );
    expect(mocks.setFilePermissions).toHaveBeenCalledWith(
      "/fake/.renre-kit/server.json",
      0o600,
    );
  });

  it("calls setServerPort with the chosen port", () => {
    expect(mocks.setServerPort).toHaveBeenCalled();
  });

  it("starts memory monitor", () => {
    expect(mocks.startMemoryMonitor).toHaveBeenCalled();
  });

  it("runs auto-purge scheduler", () => {
    expect(mocks.runAutoPurge).toHaveBeenCalled();
  });

  it("applies backup schedule with defaults when no config", () => {
    expect(mocks.pruneBackups).toHaveBeenCalledWith({
      maxCount: 10,
      maxAgeDays: 30,
    });
  });
});

describe("index.ts — module exports", () => {
  it("getSocketIO returns the Socket.IO instance after startup", async () => {
    await new Promise((r) => setTimeout(r, 50));
    // After main() completes, ioInstance should be set
    const io = getSocketIO();
    // The mock SocketIOServer returns fakeIO
    expect(io).toBe(mocks.fakeIO);
  });

  it("getWorktreeManager returns the WorktreeManager instance after startup", async () => {
    await new Promise((r) => setTimeout(r, 50));
    const wm = getWorktreeManager();
    expect(wm).toBeDefined();
    expect(wm).not.toBeNull();
  });
});

describe("index.ts — signal handler registration", () => {
  it("registers SIGINT and SIGTERM handlers via process.on", async () => {
    await new Promise((r) => setTimeout(r, 50));
    // registerShutdownHandlers is called in main(); we verify by checking
    // that process has listeners for SIGINT and SIGTERM
    const sigintListeners = process.listenerCount("SIGINT");
    const sigtermListeners = process.listenerCount("SIGTERM");
    expect(sigintListeners).toBeGreaterThanOrEqual(1);
    expect(sigtermListeners).toBeGreaterThanOrEqual(1);
  });
});

describe("index.ts — network address detection", () => {
  it("detects IPv4 non-internal address for console output", () => {
    // getNetworkAddress is used in the listen callback. We verify the
    // networkInterfaces mock was called (it was called during main()).
    expect(mocks.networkInterfaces).toHaveBeenCalled();
  });
});

describe("index.ts — config loading", () => {
  it("does not call setLogLevel when config has no logLevel", () => {
    // existsSync returns false for config file, so loadConfig returns {}
    // Since config.logLevel is falsy, setLogLevel should not be called
    expect(mocks.setLogLevel).not.toHaveBeenCalled();
  });
});

describe("index.ts — backup schedule logic", () => {
  it("does not call createPeriodicBackup when shouldRunPeriodicBackup returns false", () => {
    expect(mocks.shouldRunPeriodicBackup).toHaveBeenCalledWith(24); // default interval
    expect(mocks.createPeriodicBackup).not.toHaveBeenCalled();
  });
});

describe("index.ts — port probing", () => {
  it("uses createNetServer to probe port availability", () => {
    expect(mocks.createNetServer).toHaveBeenCalled();
  });

  it("the net server probe listens on the preferred port", () => {
    expect(mocks.fakeNetServer.listen).toHaveBeenCalledWith(42888, "0.0.0.0");
  });
});

describe("index.ts — deploy hook script", () => {
  it("creates the scripts directory", () => {
    expect(mocks.mkdirSync).toHaveBeenCalledWith("/fake/.renre-kit/scripts", { recursive: true });
  });
});

describe("index.ts — copy core migrations", () => {
  it("creates the core migrations directory", () => {
    expect(mocks.mkdirSync).toHaveBeenCalledWith("/fake/.renre-kit/migrations/core", { recursive: true });
  });
});
