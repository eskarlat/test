import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";

vi.mock("node:fs", () => ({
  appendFileSync: vi.fn(),
  mkdirSync: vi.fn(),
  existsSync: vi.fn().mockReturnValue(true),
}));

vi.mock("./paths.js", () => ({
  globalPaths: () => ({
    logsDir: "/mock/.renre-kit/logs",
  }),
}));

import { appendFileSync, existsSync, mkdirSync } from "node:fs";
import { logger, setLogLevel, getLogLevel } from "./logger.js";

describe("logger", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setLogLevel("info");
    (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
  });

  afterEach(() => {
    setLogLevel("info");
  });

  describe("setLogLevel / getLogLevel", () => {
    it("defaults to info", () => {
      expect(getLogLevel()).toBe("info");
    });

    it("changes the log level", () => {
      setLogLevel("debug");
      expect(getLogLevel()).toBe("debug");
    });
  });

  describe("log level filtering", () => {
    it("logs error at info level", () => {
      logger.error("test", "err message");
      expect(appendFileSync).toHaveBeenCalled();
    });

    it("logs warn at info level", () => {
      logger.warn("test", "warn message");
      expect(appendFileSync).toHaveBeenCalled();
    });

    it("logs info at info level", () => {
      logger.info("test", "info message");
      expect(appendFileSync).toHaveBeenCalled();
    });

    it("does NOT log debug at info level", () => {
      logger.debug("test", "debug message");
      expect(appendFileSync).not.toHaveBeenCalled();
    });

    it("logs debug at debug level", () => {
      setLogLevel("debug");
      logger.debug("test", "debug message");
      expect(appendFileSync).toHaveBeenCalled();
    });

    it("only logs error at error level", () => {
      setLogLevel("error");
      logger.warn("test", "warn");
      expect(appendFileSync).not.toHaveBeenCalled();
      logger.error("test", "error");
      expect(appendFileSync).toHaveBeenCalled();
    });
  });

  describe("log formatting", () => {
    it("writes line in expected format", () => {
      logger.info("my-source", "hello world");
      const call = (appendFileSync as ReturnType<typeof vi.fn>).mock.calls[0];
      const line = call[1] as string;
      expect(line).toMatch(/^\[.*\] \[INFO\] \[my-source\] hello world\n$/);
    });

    it("writes WARN level in uppercase", () => {
      logger.warn("src", "warning");
      const call = (appendFileSync as ReturnType<typeof vi.fn>).mock.calls[0];
      const line = call[1] as string;
      expect(line).toContain("[WARN]");
    });

    it("writes ERROR level in uppercase", () => {
      logger.error("src", "err");
      const calls = (appendFileSync as ReturnType<typeof vi.fn>).mock.calls;
      const line = calls[0][1] as string;
      expect(line).toContain("[ERROR]");
    });

    it("writes to date-stamped file", () => {
      logger.info("src", "msg");
      const call = (appendFileSync as ReturnType<typeof vi.fn>).mock.calls[0];
      const filePath = call[0] as string;
      // Should contain YYYY-MM-DD.txt
      expect(filePath).toMatch(/\/\d{4}-\d{2}-\d{2}\.txt$/);
    });
  });

  describe("error logging", () => {
    it("writes to both regular and error log files", () => {
      logger.error("src", "an error");
      // Two appendFileSync calls: one for .txt, one for error-.json
      expect(appendFileSync).toHaveBeenCalledTimes(2);
    });

    it("error log is valid JSONL", () => {
      logger.error("src", "an error", { detail: "extra" });
      const calls = (appendFileSync as ReturnType<typeof vi.fn>).mock.calls;
      const errorCall = calls[1];
      const filePath = errorCall[0] as string;
      const content = errorCall[1] as string;
      expect(filePath).toMatch(/error-\d{4}-\d{2}-\d{2}\.json$/);
      const parsed = JSON.parse(content.trim());
      expect(parsed.level).toBe("error");
      expect(parsed.source).toBe("src");
      expect(parsed.message).toBe("an error");
      expect(parsed.meta.detail).toBe("extra");
    });

    it("error log omits meta when not provided", () => {
      logger.error("src", "no meta");
      const calls = (appendFileSync as ReturnType<typeof vi.fn>).mock.calls;
      const content = calls[1][1] as string;
      const parsed = JSON.parse(content.trim());
      expect(parsed.meta).toBeUndefined();
    });
  });

  describe("logs directory", () => {
    it("creates logs dir if it does not exist", () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);
      logger.info("src", "msg");
      expect(mkdirSync).toHaveBeenCalledWith("/mock/.renre-kit/logs", { recursive: true });
    });

    it("does not create logs dir if it exists", () => {
      (existsSync as ReturnType<typeof vi.fn>).mockReturnValue(true);
      logger.info("src", "msg");
      expect(mkdirSync).not.toHaveBeenCalled();
    });
  });
});
