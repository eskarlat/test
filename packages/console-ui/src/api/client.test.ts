import { describe, it, expect, vi, beforeEach } from "vitest";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { apiGet, apiPost, apiPut, apiDelete, BASE_URL } from "./client";

describe("api/client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("BASE_URL", () => {
    it("is a string", () => {
      expect(typeof BASE_URL).toBe("string");
    });
  });

  describe("apiGet", () => {
    it("returns data on success", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [1, 2, 3] }),
      });

      const result = await apiGet<{ items: number[] }>("/api/test");
      expect(result.data).toEqual({ items: [1, 2, 3] });
      expect(result.error).toBeNull();
      expect(result.status).toBe(200);
    });

    it("returns error on non-OK response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 404,
        text: () => Promise.resolve("Not Found"),
      });

      const result = await apiGet("/api/missing");
      expect(result.data).toBeNull();
      expect(result.error).toBe("Not Found");
      expect(result.status).toBe(404);
    });

    it("returns error on 503", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 503,
        text: () => Promise.resolve("Service unavailable"),
      });

      const result = await apiGet("/api/test");
      expect(result.error).toBe("Server unavailable");
      expect(result.status).toBe(503);
    });

    it("returns error on fetch failure", async () => {
      mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await apiGet("/api/test");
      expect(result.data).toBeNull();
      expect(result.error).toBe("ECONNREFUSED");
      expect(result.status).toBe(0);
    });

    it("returns error on invalid JSON", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("Invalid JSON")),
      });

      const result = await apiGet("/api/test");
      expect(result.error).toBe("Invalid JSON response");
    });
  });

  describe("apiPost", () => {
    it("sends POST with JSON body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ ok: true }),
      });

      const result = await apiPost<{ ok: boolean }>("/api/create", { name: "test" });
      expect(result.data).toEqual({ ok: true });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/create"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ name: "test" }),
        }),
      );
    });
  });

  describe("apiPut", () => {
    it("sends PUT with JSON body", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ updated: true }),
      });

      const result = await apiPut<{ updated: boolean }>("/api/update", { value: 42 });
      expect(result.data).toEqual({ updated: true });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/update"),
        expect.objectContaining({ method: "PUT" }),
      );
    });
  });

  describe("apiDelete", () => {
    it("sends DELETE request", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ deleted: true }),
      });

      const result = await apiDelete<{ deleted: boolean }>("/api/remove");
      expect(result.data).toEqual({ deleted: true });
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/api/remove"),
        expect.objectContaining({ method: "DELETE" }),
      );
    });
  });
});
