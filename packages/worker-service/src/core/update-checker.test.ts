import { describe, it, expect, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  loadCache: vi.fn(),
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  eventBusPublish: vi.fn(),
  loggerInfo: vi.fn(),
}));

vi.mock("../services/marketplace-client.js", () => ({
  loadCache: mocks.loadCache,
}));

vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
  readFileSync: mocks.readFileSync,
}));

vi.mock("../core/logger.js", () => ({
  logger: { debug: vi.fn(), info: mocks.loggerInfo, warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../core/event-bus.js", () => ({
  eventBus: { publish: mocks.eventBusPublish, subscribe: vi.fn() },
}));

import { checkAndEmitUpdates } from "./update-checker.js";

describe("update-checker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when project registry is empty", async () => {
    const registry = new Map();
    await checkAndEmitUpdates(registry);
    expect(mocks.loadCache).not.toHaveBeenCalled();
    expect(mocks.eventBusPublish).not.toHaveBeenCalled();
  });

  it("does nothing when cache is null", async () => {
    mocks.loadCache.mockReturnValue(null);
    const registry = new Map([["proj-1", { path: "/some/path" }]]);
    await checkAndEmitUpdates(registry);
    expect(mocks.eventBusPublish).not.toHaveBeenCalled();
  });

  it("does nothing when cache has no marketplaces", async () => {
    mocks.loadCache.mockReturnValue({ marketplaces: [], fetchedAt: new Date().toISOString() });
    const registry = new Map([["proj-1", { path: "/some/path" }]]);
    await checkAndEmitUpdates(registry);
    expect(mocks.eventBusPublish).not.toHaveBeenCalled();
  });

  it("does nothing when no extensions are installed", async () => {
    mocks.loadCache.mockReturnValue({
      marketplaces: [{
        name: "official",
        url: "https://example.com",
        extensions: [{ name: "ext-a", version: "2.0.0", description: "test", repository: "", tags: [] }],
        fetchedAt: new Date().toISOString(),
      }],
      fetchedAt: new Date().toISOString(),
    });
    mocks.existsSync.mockReturnValue(false);

    const registry = new Map([["proj-1", { path: "/some/path" }]]);
    await checkAndEmitUpdates(registry);
    expect(mocks.eventBusPublish).not.toHaveBeenCalled();
  });

  it("emits updates:available when newer version exists", async () => {
    mocks.loadCache.mockReturnValue({
      marketplaces: [{
        name: "official",
        url: "https://example.com",
        extensions: [{ name: "ext-a", version: "2.0.0", description: "test", repository: "", tags: [] }],
        fetchedAt: new Date().toISOString(),
      }],
      fetchedAt: new Date().toISOString(),
    });
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify({
      extensions: [{ name: "ext-a", version: "1.0.0" }],
    }));

    const registry = new Map([["proj-1", { path: "/some/path" }]]);
    await checkAndEmitUpdates(registry);

    expect(mocks.eventBusPublish).toHaveBeenCalledWith("updates:available", {
      extensions: [{ name: "ext-a", current: "1.0.0", latest: "2.0.0" }],
    });
  });

  it("does not emit when installed version is up to date", async () => {
    mocks.loadCache.mockReturnValue({
      marketplaces: [{
        name: "official",
        url: "https://example.com",
        extensions: [{ name: "ext-a", version: "1.0.0", description: "test", repository: "", tags: [] }],
        fetchedAt: new Date().toISOString(),
      }],
      fetchedAt: new Date().toISOString(),
    });
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify({
      extensions: [{ name: "ext-a", version: "1.0.0" }],
    }));

    const registry = new Map([["proj-1", { path: "/some/path" }]]);
    await checkAndEmitUpdates(registry);
    expect(mocks.eventBusPublish).not.toHaveBeenCalled();
  });

  it("does not emit when installed version is newer than marketplace", async () => {
    mocks.loadCache.mockReturnValue({
      marketplaces: [{
        name: "official",
        url: "https://example.com",
        extensions: [{ name: "ext-a", version: "1.0.0", description: "test", repository: "", tags: [] }],
        fetchedAt: new Date().toISOString(),
      }],
      fetchedAt: new Date().toISOString(),
    });
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify({
      extensions: [{ name: "ext-a", version: "2.0.0" }],
    }));

    const registry = new Map([["proj-1", { path: "/some/path" }]]);
    await checkAndEmitUpdates(registry);
    expect(mocks.eventBusPublish).not.toHaveBeenCalled();
  });

  it("deduplicates extensions across multiple projects", async () => {
    mocks.loadCache.mockReturnValue({
      marketplaces: [{
        name: "official",
        url: "https://example.com",
        extensions: [{ name: "ext-a", version: "2.0.0", description: "test", repository: "", tags: [] }],
        fetchedAt: new Date().toISOString(),
      }],
      fetchedAt: new Date().toISOString(),
    });
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify({
      extensions: [{ name: "ext-a", version: "1.0.0" }],
    }));

    const registry = new Map([
      ["proj-1", { path: "/path1" }],
      ["proj-2", { path: "/path2" }],
    ]);
    await checkAndEmitUpdates(registry);

    expect(mocks.eventBusPublish).toHaveBeenCalledTimes(1);
    const call = mocks.eventBusPublish.mock.calls[0];
    expect(call[1].extensions).toHaveLength(1);
  });

  it("picks the highest version from multiple marketplaces", async () => {
    mocks.loadCache.mockReturnValue({
      marketplaces: [
        {
          name: "mp1",
          url: "https://a.com",
          extensions: [{ name: "ext-a", version: "2.0.0", description: "test", repository: "", tags: [] }],
          fetchedAt: new Date().toISOString(),
        },
        {
          name: "mp2",
          url: "https://b.com",
          extensions: [{ name: "ext-a", version: "3.0.0", description: "test", repository: "", tags: [] }],
          fetchedAt: new Date().toISOString(),
        },
      ],
      fetchedAt: new Date().toISOString(),
    });
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify({
      extensions: [{ name: "ext-a", version: "1.0.0" }],
    }));

    const registry = new Map([["proj-1", { path: "/path" }]]);
    await checkAndEmitUpdates(registry);

    expect(mocks.eventBusPublish).toHaveBeenCalledWith("updates:available", {
      extensions: [{ name: "ext-a", current: "1.0.0", latest: "3.0.0" }],
    });
  });

  it("handles malformed extensions.json gracefully", async () => {
    mocks.loadCache.mockReturnValue({
      marketplaces: [{
        name: "official",
        url: "https://example.com",
        extensions: [{ name: "ext-a", version: "2.0.0", description: "test", repository: "", tags: [] }],
        fetchedAt: new Date().toISOString(),
      }],
      fetchedAt: new Date().toISOString(),
    });
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue("not valid json");

    const registry = new Map([["proj-1", { path: "/path" }]]);
    await checkAndEmitUpdates(registry);
    // Should not throw, should not emit
    expect(mocks.eventBusPublish).not.toHaveBeenCalled();
  });

  it("handles extensions.json with no extensions array", async () => {
    mocks.loadCache.mockReturnValue({
      marketplaces: [{
        name: "official",
        url: "https://example.com",
        extensions: [{ name: "ext-a", version: "2.0.0", description: "test", repository: "", tags: [] }],
        fetchedAt: new Date().toISOString(),
      }],
      fetchedAt: new Date().toISOString(),
    });
    mocks.existsSync.mockReturnValue(true);
    mocks.readFileSync.mockReturnValue(JSON.stringify({ settings: {} }));

    const registry = new Map([["proj-1", { path: "/path" }]]);
    await checkAndEmitUpdates(registry);
    expect(mocks.eventBusPublish).not.toHaveBeenCalled();
  });
});
