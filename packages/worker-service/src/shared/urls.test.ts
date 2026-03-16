import { describe, it, expect } from "vitest";
import {
  DEFAULT_MARKETPLACE_URL,
  SCHEMA_BASE_URL,
  GITHUB_HOSTNAMES,
  isGitHubUrl,
  buildMarketplaceFetchUrl,
  isLocalPath,
} from "./urls.js";

describe("url utilities", () => {
  describe("constants", () => {
    it("DEFAULT_MARKETPLACE_URL is https", () => {
      expect(DEFAULT_MARKETPLACE_URL).toMatch(/^https:\/\//);
    });

    it("SCHEMA_BASE_URL is https", () => {
      expect(SCHEMA_BASE_URL).toMatch(/^https:\/\//);
    });

    it("GITHUB_HOSTNAMES includes github.com", () => {
      expect(GITHUB_HOSTNAMES).toContain("github.com");
    });
  });

  describe("isGitHubUrl", () => {
    it("returns true for github.com URLs", () => {
      expect(isGitHubUrl("https://github.com/user/repo")).toBe(true);
    });

    it("returns true for github.com with different paths", () => {
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

    it("returns false for subdomains of github.com", () => {
      // Exact match only, no wildcard subdomains
      expect(isGitHubUrl("https://api.github.com/repos")).toBe(false);
    });
  });

  describe("buildMarketplaceFetchUrl", () => {
    it("appends raw path for GitHub repos", () => {
      const result = buildMarketplaceFetchUrl("https://github.com/user/repo");
      expect(result).toBe("https://github.com/user/repo/raw/main/.renre-kit/marketplace.json");
    });

    it("appends /marketplace.json for non-GitHub repos", () => {
      const result = buildMarketplaceFetchUrl("https://example.com/repo");
      expect(result).toBe("https://example.com/repo/marketplace.json");
    });

    it("strips trailing slashes before appending", () => {
      const result = buildMarketplaceFetchUrl("https://example.com/repo///");
      expect(result).toBe("https://example.com/repo/marketplace.json");
    });

    it("strips trailing slashes for GitHub URLs too", () => {
      const result = buildMarketplaceFetchUrl("https://github.com/user/repo/");
      expect(result).toBe("https://github.com/user/repo/raw/main/.renre-kit/marketplace.json");
    });
  });

  describe("isLocalPath", () => {
    it("returns true for file:// URIs", () => {
      expect(isLocalPath("file:///home/user/ext")).toBe(true);
    });

    it("returns true for absolute Unix paths", () => {
      expect(isLocalPath("/home/user/extension")).toBe(true);
    });

    it("returns true for home-relative paths", () => {
      expect(isLocalPath("~/my-extension")).toBe(true);
    });

    it("returns true for Windows absolute paths", () => {
      expect(isLocalPath("C:\\Users\\ext")).toBe(true);
      expect(isLocalPath("D:/projects/ext")).toBe(true);
    });

    it("returns false for URLs", () => {
      expect(isLocalPath("https://example.com/ext")).toBe(false);
    });

    it("returns false for package names", () => {
      expect(isLocalPath("my-extension")).toBe(false);
    });

    it("returns false for scoped package names", () => {
      expect(isLocalPath("@scope/extension")).toBe(false);
    });
  });
});
