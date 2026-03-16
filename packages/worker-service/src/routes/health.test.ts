import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@renre-kit/extension-sdk", () => ({
  SDK_VERSION: "1.0.0-test",
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./health.js";

describe("health route", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp(router);
  });

  it("GET /health returns status 200", async () => {
    const res = await request(app, "GET", "/health");
    expect(res.status).toBe(200);
  });

  it("response has status 'ok'", async () => {
    const res = await request(app, "GET", "/health");
    const body = res.body as Record<string, unknown>;
    expect(body["status"]).toBe("ok");
  });

  it("response has uptime, version, and sdkVersion fields", async () => {
    const res = await request(app, "GET", "/health");
    const body = res.body as Record<string, unknown>;
    expect(body["uptime"]).toBeTypeOf("number");
    expect(body["version"]).toBe("0.1.0");
    expect(body["sdkVersion"]).toBe("1.0.0-test");
  });

  it("response includes memoryUsage and port", async () => {
    const res = await request(app, "GET", "/health");
    const body = res.body as Record<string, unknown>;
    expect(body["memoryUsage"]).toBeDefined();
    expect(body["port"]).toBeTypeOf("number");
  });
});
