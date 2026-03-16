import { describe, it, expect, beforeEach } from "vitest";
import express from "express";
import { request } from "../test-helpers.js";
import { requestTrackerMiddleware, getStats } from "./request-tracker.js";

describe("request-tracker", () => {
  let app: express.Application;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use(requestTrackerMiddleware);
    // Simulate an extension route
    app.get("/api/:projectId/:extension/:action", (req, res) => {
      res.json({ ok: true });
    });
    // Simulate a core route (should be skipped)
    app.get("/api/:projectId/projects", (req, res) => {
      res.json({ ok: true });
    });
  });

  it("tracks extension requests", async () => {
    await request(app, "GET", "/api/proj-1/my-ext/items");
    const stats = getStats("proj-1");
    expect(stats.length).toBeGreaterThanOrEqual(1);
    const extStat = stats.find((s) => s.extension === "my-ext");
    expect(extStat).toBeDefined();
    expect(extStat!.calls).toBeGreaterThanOrEqual(1);
    expect(extStat!.avgLatencyMs).toBeGreaterThanOrEqual(0);
  });

  it("does not track core routes", async () => {
    await request(app, "GET", "/api/proj-1/projects");
    const stats = getStats("proj-1");
    const projectStat = stats.find((s) => s.extension === "projects");
    expect(projectStat).toBeUndefined();
  });

  it("returns empty stats for unknown project", () => {
    const stats = getStats("unknown-project");
    expect(stats).toEqual([]);
  });

  it("sorts stats by most calls first", async () => {
    await request(app, "GET", "/api/proj-2/ext-a/action1");
    await request(app, "GET", "/api/proj-2/ext-a/action1");
    await request(app, "GET", "/api/proj-2/ext-b/action2");
    const stats = getStats("proj-2");
    if (stats.length >= 2) {
      expect(stats[0]!.calls).toBeGreaterThanOrEqual(stats[1]!.calls);
    }
  });
});
