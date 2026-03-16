import { describe, it, expect } from "vitest";
import {
  DEFAULT_MARKETPLACE_URL,
  SCHEMA_BASE_URL,
  GITHUB_HOSTNAMES,
  isGitHubUrl,
  buildMarketplaceFetchUrl,
  isLocalPath,
} from "./urls.js";

describe("urls", () => {
  describe("constants", () => {
    it("has marketplace URL", () => {
      expect(DEFAULT_MARKETPLACE_URL).toContain("renre-kit");
    });

    it("has schema base URL", () => {
      expect(SCHEMA_BASE_URL).toContain("schemas");
    });

    it("has github.com in hostnames", () => {
      expect(GITHUB_HOSTNAMES).toContain("github.com");
    });
  });

  describe("isGitHubUrl", () => {
    it("returns true for github.com URLs", () => {
      expect(isGitHubUrl("https://github.com/user/repo")).toBe(true);
    });

    it("returns true for github.com with path", () => {
      expect(isGitHubUrl("https://github.com/org/repo/tree/main")).toBe(true);
    });

    it("returns false for non-GitHub URLs", () => {
      expect(isGitHubUrl("https://gitlab.com/user/repo")).toBe(false);
    });

    it("returns false for invalid URLs", () => {
      expect(isGitHubUrl("not-a-url")).toBe(false);
    });

    it("returns false for empty string", () => {
      expect(isGitHubUrl("")).toBe(false);
    });
  });

  describe("buildMarketplaceFetchUrl", () => {
    it("builds GitHub raw URL for github.com repos", () => {
      const url = buildMarketplaceFetchUrl("https://github.com/user/repo");
      expect(url).toBe("https://github.com/user/repo/raw/main/.renre-kit/marketplace.json");
    });

    it("strips trailing slashes", () => {
      const url = buildMarketplaceFetchUrl("https://github.com/user/repo///");
      expect(url).toBe("https://github.com/user/repo/raw/main/.renre-kit/marketplace.json");
    });

    it("builds plain URL for non-GitHub hosts", () => {
      const url = buildMarketplaceFetchUrl("https://marketplace.example.com");
      expect(url).toBe("https://marketplace.example.com/marketplace.json");
    });

    it("strips trailing slashes for non-GitHub hosts", () => {
      const url = buildMarketplaceFetchUrl("https://example.com/api/");
      expect(url).toBe("https://example.com/api/marketplace.json");
    });
  });

  describe("isLocalPath", () => {
    it("returns true for absolute paths", () => {
      expect(isLocalPath("/home/user/ext")).toBe(true);
    });

    it("returns true for home-relative paths", () => {
      expect(isLocalPath("~/my-extensions")).toBe(true);
    });

    it("returns true for file:// URIs", () => {
      expect(isLocalPath("file:///home/user/ext")).toBe(true);
    });

    it("returns true for Windows paths", () => {
      expect(isLocalPath("C:\\Users\\ext")).toBe(true);
      expect(isLocalPath("D:/extensions")).toBe(true);
    });

    it("returns false for URLs", () => {
      expect(isLocalPath("https://github.com/user/repo")).toBe(false);
    });

    it("returns false for relative paths", () => {
      expect(isLocalPath("relative/path")).toBe(false);
    });
  });
});
