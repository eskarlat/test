import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @clack/prompts
vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  outro: vi.fn(),
  cancel: vi.fn(),
  spinner: vi.fn(() => ({ start: vi.fn(), stop: vi.fn(), message: vi.fn() })),
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mock picocolors
vi.mock("picocolors", () => ({
  default: { bold: (s: string) => s },
}));

import * as logger from "./logger.js";
import * as clack from "@clack/prompts";

describe("logger", () => {
  const originalIsTTY = process.stdout.isTTY;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, writable: true });
  });

  function setTTY(value: boolean) {
    Object.defineProperty(process.stdout, "isTTY", { value, writable: true, configurable: true });
  }

  describe("isInteractive", () => {
    it("returns true when TTY", () => {
      setTTY(true);
      expect(logger.isInteractive()).toBe(true);
    });

    it("returns false when not TTY", () => {
      setTTY(false);
      expect(logger.isInteractive()).toBe(false);
    });
  });

  describe("intro", () => {
    it("calls clack.intro when interactive", () => {
      setTTY(true);
      logger.intro("Hello");
      expect(clack.intro).toHaveBeenCalled();
    });

    it("calls console.log when not interactive", () => {
      setTTY(false);
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      logger.intro("Hello");
      expect(spy).toHaveBeenCalledWith("Hello");
      spy.mockRestore();
    });
  });

  describe("outro", () => {
    it("calls clack.outro when interactive", () => {
      setTTY(true);
      logger.outro("Done");
      expect(clack.outro).toHaveBeenCalled();
    });

    it("calls console.log when not interactive", () => {
      setTTY(false);
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      logger.outro("Done");
      expect(spy).toHaveBeenCalledWith("Done");
      spy.mockRestore();
    });
  });

  describe("info", () => {
    it("calls clack.log.info when interactive", () => {
      setTTY(true);
      logger.info("Info message");
      expect(clack.log.info).toHaveBeenCalledWith("Info message");
    });
  });

  describe("success", () => {
    it("calls clack.log.success when interactive", () => {
      setTTY(true);
      logger.success("Success!");
      expect(clack.log.success).toHaveBeenCalledWith("Success!");
    });
  });

  describe("warn", () => {
    it("calls clack.log.warn when interactive", () => {
      setTTY(true);
      logger.warn("Warning!");
      expect(clack.log.warn).toHaveBeenCalledWith("Warning!");
    });

    it("calls console.warn when not interactive", () => {
      setTTY(false);
      const spy = vi.spyOn(console, "warn").mockImplementation(() => {});
      logger.warn("Warning!");
      expect(spy).toHaveBeenCalledWith("Warning!");
      spy.mockRestore();
    });
  });

  describe("error", () => {
    it("calls clack.log.error when interactive", () => {
      setTTY(true);
      logger.error("Error!");
      expect(clack.log.error).toHaveBeenCalledWith("Error!");
    });

    it("calls console.error when not interactive", () => {
      setTTY(false);
      const spy = vi.spyOn(console, "error").mockImplementation(() => {});
      logger.error("Error!");
      expect(spy).toHaveBeenCalledWith("Error!");
      spy.mockRestore();
    });
  });

  describe("spinner", () => {
    it("returns spinner object when interactive", () => {
      setTTY(true);
      const s = logger.spinner("Loading...");
      expect(typeof s.stop).toBe("function");
      expect(typeof s.message).toBe("function");
    });

    it("returns console-based spinner when not interactive", () => {
      setTTY(false);
      const spy = vi.spyOn(console, "log").mockImplementation(() => {});
      const s = logger.spinner("Loading...");
      expect(typeof s.stop).toBe("function");
      expect(typeof s.message).toBe("function");
      s.stop("Done");
      s.message("Progress");
      spy.mockRestore();
    });
  });
});
