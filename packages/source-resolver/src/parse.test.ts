import { describe, it, expect } from "vitest";
import { parseSourceUri, toSourceUri } from "./parse.js";

describe("parseSourceUri", () => {
  describe("marketplace scheme", () => {
    it("parses marketplace:official/jira-plugin@1.0.0", () => {
      const result = parseSourceUri("marketplace:official/jira-plugin@1.0.0");
      expect(result).toEqual({
        scheme: "marketplace",
        marketplace: "official",
        name: "jira-plugin",
        ref: "1.0.0",
      });
    });

    it("parses marketplace:jira-plugin (no marketplace prefix, no ref)", () => {
      const result = parseSourceUri("marketplace:jira-plugin");
      expect(result).toEqual({
        scheme: "marketplace",
        marketplace: "*",
        name: "jira-plugin",
        ref: "latest",
      });
    });

    it("parses marketplace:official/jira-plugin (no ref)", () => {
      const result = parseSourceUri("marketplace:official/jira-plugin");
      expect(result).toEqual({
        scheme: "marketplace",
        marketplace: "official",
        name: "jira-plugin",
        ref: "latest",
      });
    });
  });

  describe("github scheme", () => {
    it("parses github:acme/repo@v1.0.0", () => {
      const result = parseSourceUri("github:acme/repo@v1.0.0");
      expect(result).toEqual({
        scheme: "github",
        owner: "acme",
        repo: "repo",
        name: "repo",
        ref: "v1.0.0",
      });
    });

    it("parses github:acme/repo/packages/ext@v1.0.0 (subpath)", () => {
      const result = parseSourceUri("github:acme/repo/packages/ext@v1.0.0");
      expect(result).toEqual({
        scheme: "github",
        owner: "acme",
        repo: "repo",
        subpath: "packages/ext",
        name: "ext",
        ref: "v1.0.0",
      });
    });

    it("parses github:acme/repo (no ref)", () => {
      const result = parseSourceUri("github:acme/repo");
      expect(result).toEqual({
        scheme: "github",
        owner: "acme",
        repo: "repo",
        name: "repo",
        ref: "latest",
      });
    });

    it("throws on github: with only owner", () => {
      expect(() => parseSourceUri("github:acme")).toThrow("expected at least owner/repo");
    });
  });

  describe("git scheme", () => {
    it("parses git:https://gitlab.com/org/repo@v1.0.0", () => {
      const result = parseSourceUri("git:https://gitlab.com/org/repo@v1.0.0");
      expect(result).toEqual({
        scheme: "git",
        gitUrl: "https://gitlab.com/org/repo",
        name: "repo",
        ref: "v1.0.0",
      });
    });

    it("parses git:git@gitlab.com:org/repo.git@v2.0.0", () => {
      const result = parseSourceUri("git:git@gitlab.com:org/repo.git@v2.0.0");
      expect(result).toEqual({
        scheme: "git",
        gitUrl: "git@gitlab.com:org/repo.git",
        name: "repo",
        ref: "v2.0.0",
      });
    });

    it("parses git URL without ref", () => {
      const result = parseSourceUri("git:https://gitlab.com/org/repo.git");
      expect(result).toEqual({
        scheme: "git",
        gitUrl: "https://gitlab.com/org/repo.git",
        name: "repo",
        ref: "latest",
      });
    });
  });

  describe("local scheme", () => {
    it("parses local:/absolute/path", () => {
      const result = parseSourceUri("local:/absolute/path");
      expect(result).toEqual({
        scheme: "local",
        localPath: "/absolute/path",
        name: "path",
        ref: "local",
      });
    });

    it("expands tilde in local:~/dev/ext", () => {
      const result = parseSourceUri("local:~/dev/ext");
      expect(result.scheme).toBe("local");
      expect(result.localPath).not.toContain("~");
      expect(result.localPath).toMatch(/\/dev\/ext$/);
      expect(result.name).toBe("ext");
    });
  });

  describe("local+link scheme", () => {
    it("parses local+link:/absolute/path", () => {
      const result = parseSourceUri("local+link:/absolute/path");
      expect(result).toEqual({
        scheme: "local+link",
        localPath: "/absolute/path",
        name: "path",
        ref: "local",
      });
    });
  });

  describe("shorthand expansion", () => {
    it("bare name → marketplace search all", () => {
      const result = parseSourceUri("jira-plugin");
      expect(result).toEqual({
        scheme: "marketplace",
        marketplace: "*",
        name: "jira-plugin",
        ref: "latest",
      });
    });

    it("bare name with version", () => {
      const result = parseSourceUri("jira-plugin@2.0.0");
      expect(result).toEqual({
        scheme: "marketplace",
        marketplace: "*",
        name: "jira-plugin",
        ref: "2.0.0",
      });
    });

    it("two-segment shorthand → marketplace", () => {
      const result = parseSourceUri("official/jira-plugin@1.0.0");
      expect(result).toEqual({
        scheme: "marketplace",
        marketplace: "official",
        name: "jira-plugin",
        ref: "1.0.0",
      });
    });

    it("three-segment shorthand → github", () => {
      const result = parseSourceUri("acme/repo/ext");
      expect(result).toEqual({
        scheme: "github",
        owner: "acme",
        repo: "repo",
        subpath: "ext",
        name: "ext",
        ref: "latest",
      });
    });

    it("local path shorthand with ./", () => {
      const result = parseSourceUri("./my-extension");
      expect(result.scheme).toBe("local");
      expect(result.localPath).toMatch(/my-extension$/);
    });

    it("local path shorthand with /", () => {
      const result = parseSourceUri("/opt/extensions/my-ext");
      expect(result).toEqual({
        scheme: "local",
        localPath: "/opt/extensions/my-ext",
        name: "my-ext",
        ref: "local",
      });
    });

    it("tilde shorthand expands home directory", () => {
      const result = parseSourceUri("~/dev/ext");
      expect(result.scheme).toBe("local");
      expect(result.localPath).not.toContain("~");
      expect(result.localPath).toMatch(/\/dev\/ext$/);
    });
  });

  describe("edge cases", () => {
    it("throws on empty input", () => {
      expect(() => parseSourceUri("")).toThrow("cannot be empty");
    });

    it("trims whitespace", () => {
      const result = parseSourceUri("  jira-plugin  ");
      expect(result.name).toBe("jira-plugin");
    });
  });
});

describe("toSourceUri", () => {
  it("serializes marketplace with explicit marketplace", () => {
    expect(
      toSourceUri({ scheme: "marketplace", marketplace: "official", name: "jira-plugin", ref: "1.0.0" }),
    ).toBe("marketplace:official/jira-plugin@1.0.0");
  });

  it("serializes marketplace wildcard (no marketplace prefix)", () => {
    expect(
      toSourceUri({ scheme: "marketplace", marketplace: "*", name: "jira-plugin", ref: "latest" }),
    ).toBe("marketplace:jira-plugin");
  });

  it("serializes github without subpath", () => {
    expect(
      toSourceUri({ scheme: "github", owner: "acme", repo: "repo", name: "repo", ref: "v1.0.0" }),
    ).toBe("github:acme/repo@v1.0.0");
  });

  it("serializes github with subpath", () => {
    expect(
      toSourceUri({ scheme: "github", owner: "acme", repo: "repo", subpath: "packages/ext", name: "ext", ref: "latest" }),
    ).toBe("github:acme/repo/packages/ext");
  });

  it("serializes git with ref", () => {
    expect(
      toSourceUri({ scheme: "git", gitUrl: "https://gitlab.com/org/repo", name: "repo", ref: "v1.0.0" }),
    ).toBe("git:https://gitlab.com/org/repo@v1.0.0");
  });

  it("serializes local", () => {
    expect(
      toSourceUri({ scheme: "local", localPath: "/home/user/ext", name: "ext", ref: "local" }),
    ).toBe("local:/home/user/ext");
  });

  it("serializes local+link", () => {
    expect(
      toSourceUri({ scheme: "local+link", localPath: "/home/user/ext", name: "ext", ref: "local" }),
    ).toBe("local+link:/home/user/ext");
  });
});

describe("parseSourceUri → toSourceUri roundtrip", () => {
  const uris = [
    "marketplace:official/jira-plugin@1.0.0",
    "marketplace:jira-plugin",
    "github:acme/repo@v1.0.0",
    "github:acme/repo/packages/ext@v1.0.0",
    "github:acme/repo",
    "git:https://gitlab.com/org/repo@v1.0.0",
    "local:/home/user/dev/ext",
    "local+link:/home/user/dev/ext",
  ];

  for (const uri of uris) {
    it(`roundtrips "${uri}"`, () => {
      expect(toSourceUri(parseSourceUri(uri))).toBe(uri);
    });
  }
});
