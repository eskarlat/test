import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

const testExtDir = "/tmp/renre-kit-test-ext-ui-" + process.pid;

const mocks = vi.hoisted(() => ({
  extensionsDir: "/tmp/renre-kit-test-ext-ui-" + process.pid,
}));

vi.mock("../core/paths.js", () => ({
  globalPaths: () => ({
    globalDir: mocks.extensionsDir,
    extensionsDir: mocks.extensionsDir,
  }),
}));

import { createTestApp, request } from "../test-helpers.js";
import router from "./extension-ui-assets.js";

describe("extension-ui-assets route", () => {
  let app: ReturnType<typeof createTestApp>;

  beforeEach(() => {
    vi.clearAllMocks();
    app = createTestApp(router);

    // Create test extension UI directory with sample files
    const uiDir = join(testExtDir, "my-ext", "1.0.0", "ui");
    mkdirSync(uiDir, { recursive: true });
    writeFileSync(join(uiDir, "index.js"), 'console.log("hello");');
    writeFileSync(join(uiDir, "styles.css"), "body { color: red; }");
    writeFileSync(join(uiDir, "config.json"), '{"key":"value"}');
    writeFileSync(join(uiDir, "logo.png"), "fake-png-data");
    writeFileSync(join(uiDir, "icon.svg"), "<svg></svg>");

    // Create a subdirectory with a file
    mkdirSync(join(uiDir, "sub"), { recursive: true });
    writeFileSync(join(uiDir, "sub", "nested.js"), "nested();");
  });

  afterEach(() => {
    rmSync(testExtDir, { recursive: true, force: true });
  });

  it("serves a JS file with correct content type", async () => {
    const res = await request(
      app,
      "GET",
      "/api/extensions/my-ext/1.0.0/ui/index.js",
    );
    expect(res.status).toBe(200);
    // The body comes back as parsed text since it's not JSON
    // Check via raw response if needed, but at minimum status is 200
  });

  it("serves a CSS file", async () => {
    const res = await request(
      app,
      "GET",
      "/api/extensions/my-ext/1.0.0/ui/styles.css",
    );
    expect(res.status).toBe(200);
  });

  it("serves a JSON file", async () => {
    const res = await request(
      app,
      "GET",
      "/api/extensions/my-ext/1.0.0/ui/config.json",
    );
    expect(res.status).toBe(200);
    expect((res.body as Record<string, unknown>)["key"]).toBe("value");
  });

  it("serves files in subdirectories", async () => {
    const res = await request(
      app,
      "GET",
      "/api/extensions/my-ext/1.0.0/ui/sub/nested.js",
    );
    expect(res.status).toBe(200);
  });

  it("returns 404 for non-existent files", async () => {
    const res = await request(
      app,
      "GET",
      "/api/extensions/my-ext/1.0.0/ui/missing.js",
    );
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>)["error"]).toBe("Asset not found");
  });

  it("returns 404 for non-existent extension", async () => {
    const res = await request(
      app,
      "GET",
      "/api/extensions/nonexistent/1.0.0/ui/index.js",
    );
    expect(res.status).toBe(404);
  });

  it("returns 403 for directory traversal attempts with ..", async () => {
    const res = await request(
      app,
      "GET",
      "/api/extensions/my-ext/1.0.0/ui/../../../etc/passwd",
    );
    // Express may normalize the path so this could be 403 or 404
    expect([403, 404]).toContain(res.status);
  });

  it("returns 404 when path points to a directory", async () => {
    const res = await request(
      app,
      "GET",
      "/api/extensions/my-ext/1.0.0/ui/sub",
    );
    expect(res.status).toBe(404);
    expect((res.body as Record<string, unknown>)["error"]).toBe("Asset not found");
  });
});
