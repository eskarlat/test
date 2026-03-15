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
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  url: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  return new Promise((resolve, reject) => {
    const server = createServer(app);
    server.listen(0, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        server.close();
        reject(new Error("Failed to start server"));
        return;
      }
      const port = addr.port;
      const options: RequestInit = {
        method,
        headers: { "Content-Type": "application/json" },
      };
      if (body !== undefined) {
        options.body = JSON.stringify(body);
      }
      fetch(`http://localhost:${port}${url}`, options)
        .then(async (res) => {
          let responseBody: unknown;
          const text = await res.text();
          try {
            responseBody = JSON.parse(text);
          } catch {
            responseBody = text || undefined;
          }
          server.close();
          resolve({ status: res.status, body: responseBody });
        })
        .catch((err) => {
          server.close();
          reject(err);
        });
    });
  });
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
