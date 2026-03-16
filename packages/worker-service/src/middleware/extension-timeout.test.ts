import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import { request } from "../test-helpers.js";
import { extensionTimeout } from "./extension-timeout.js";

describe("extension-timeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("passes through requests that complete before timeout", async () => {
    vi.useRealTimers(); // use real timers for this test
    const app = express();
    app.use(express.json());
    app.use(extensionTimeout(5000));
    app.get("/test", (_req, res) => {
      res.json({ ok: true });
    });

    const res = await request(app, "GET", "/test");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("returns 504 when request times out", async () => {
    vi.useRealTimers(); // use real timers for short timeout
    const app = express();
    app.use(express.json());
    app.use(extensionTimeout(50)); // very short timeout
    app.get("/slow", (_req, _res) => {
      // never responds
    });

    const res = await request(app, "GET", "/slow");
    expect(res.status).toBe(504);
    expect((res.body as Record<string, unknown>).error).toBe("Gateway Timeout");
  });
});
