import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

// Mock API client
const mockApiGet = vi.fn();
vi.mock("../api/client", () => ({
  apiGet: (...args: unknown[]) => mockApiGet(...args),
  BASE_URL: "http://localhost:42888",
}));

const { default: SettingsPage } = await import("./settings");

describe("SettingsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiGet.mockImplementation((url: string) => {
      if (url === "/api/config") {
        return Promise.resolve({
          data: { logLevel: "debug", marketplaces: [{ name: "Official", url: "https://mp.test" }] },
          error: null,
          status: 200,
        });
      }
      if (url === "/health") {
        return Promise.resolve({
          data: {
            status: "ok",
            port: 42888,
            version: "1.0.0",
            sdkVersion: "0.1.0",
            uptime: 3661,
            pid: 12345,
            memoryUsage: { heapUsed: 52428800, heapTotal: 104857600, rss: 157286400 },
          },
          error: null,
          status: 200,
        });
      }
      return Promise.resolve({ data: null, error: "Not found", status: 404 });
    });
  });

  it("renders page heading", async () => {
    render(<SettingsPage />);
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("renders server info after loading", async () => {
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("ok")).toBeTruthy();
      expect(screen.getByText("42888")).toBeTruthy();
      expect(screen.getByText("1.0.0")).toBeTruthy();
    });
  });

  it("renders config section with log level", async () => {
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("debug")).toBeTruthy();
    });
  });

  it("renders marketplace list", async () => {
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("Official")).toBeTruthy();
      expect(screen.getByText("https://mp.test")).toBeTruthy();
    });
  });

  it("shows error when both API calls fail", async () => {
    mockApiGet.mockResolvedValue({ data: null, error: "Connection refused", status: 500 });
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("Connection refused")).toBeTruthy();
      expect(screen.getByText("Retry")).toBeTruthy();
    });
  });

  it("formats uptime correctly", async () => {
    render(<SettingsPage />);
    await waitFor(() => {
      expect(screen.getByText("1h 1m")).toBeTruthy();
    });
  });
});
