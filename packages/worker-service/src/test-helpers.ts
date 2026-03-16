import express from "express";
import { createServer } from "node:http";

/**
 * Create a minimal Express app for testing with a router.
 */
export function createTestApp(...routers: express.Router[]): express.Application {
  const app = express();
  app.use(express.json());
  for (const router of routers) {
    app.use(router);
  }
  return app;
}

/**
 * HTTP request helper for tests — creates ephemeral server, sends request, returns response.
 */
export async function request(
  app: express.Application,
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS",
  url: string,
  body?: unknown,
): Promise<{ status: number; body: unknown; headers: Record<string, string> }> {
  const server = createServer(app);
  const port = await new Promise<number>((resolve, reject) => {
    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Failed to start server"));
        return;
      }
      resolve(addr.port);
    });
  });
  const options: RequestInit = {
    method,
    headers: { "Content-Type": "application/json" },
  };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }
  try {
    const res = await fetch(`http://localhost:${port}${url}`, options);
    const text = await res.text();
    let responseBody: unknown;
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = text || undefined;
    }
    const headers: Record<string, string> = {};
    res.headers.forEach((val, key) => {
      headers[key] = val;
    });
    return { status: res.status, body: responseBody, headers };
  } finally {
    server.close();
  }
}

/**
 * Create a mock logger that captures log calls.
 */
export function createMockLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}
