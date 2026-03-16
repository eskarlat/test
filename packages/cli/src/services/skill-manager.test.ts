import { describe, it, expect, vi, beforeEach } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const memfs = await import("memfs");
  return { ...memfs.fs };
});

import {
  installLearnSkill,
  removeExtensionSkills,
  copyExtensionSkill,
} from "./skill-manager.js";
import { existsSync, readFileSync } from "node:fs";

describe("skill-manager", () => {
  beforeEach(() => {
    vol.reset();
  });

  describe("installLearnSkill", () => {
    it("creates learn skill SKILL.md", () => {
      vol.mkdirSync("/project", { recursive: true });
      installLearnSkill("/project");
      expect(existsSync("/project/.github/skills/learn/SKILL.md")).toBe(true);
      const content = readFileSync("/project/.github/skills/learn/SKILL.md", "utf8");
      expect(content).toContain("# /learn - Online Learning System");
    });

    it("does not overwrite user-modified skill", () => {
      vol.mkdirSync("/project/.github/skills/learn", { recursive: true });
      vol.writeFileSync("/project/.github/skills/learn/SKILL.md", "# Custom content\n");
      installLearnSkill("/project");
      const content = readFileSync("/project/.github/skills/learn/SKILL.md", "utf8");
      expect(content).toBe("# Custom content\n");
    });

    it("overwrites unmodified skill (same checksum)", () => {
      vol.mkdirSync("/project", { recursive: true });
      // Install first
      installLearnSkill("/project");
      const first = readFileSync("/project/.github/skills/learn/SKILL.md", "utf8");
      // Install again — same content, should succeed
      installLearnSkill("/project");
      const second = readFileSync("/project/.github/skills/learn/SKILL.md", "utf8");
      expect(second).toBe(first);
    });
  });

  describe("removeExtensionSkills", () => {
    it("removes skill directories", () => {
      vol.mkdirSync("/project/.github/skills/my-skill", { recursive: true });
      vol.writeFileSync("/project/.github/skills/my-skill/SKILL.md", "# Test");
      removeExtensionSkills("/project", ["my-skill"]);
      expect(existsSync("/project/.github/skills/my-skill")).toBe(false);
    });

    it("ignores non-existent skill directories", () => {
      vol.mkdirSync("/project/.github/skills", { recursive: true });
      expect(() => removeExtensionSkills("/project", ["missing-skill"])).not.toThrow();
    });
  });

  describe("copyExtensionSkill", () => {
    it("copies skill file from extension to project", () => {
      vol.mkdirSync("/ext/skills", { recursive: true });
      vol.writeFileSync("/ext/skills/my-skill.md", "# My Skill\nContent here");
      vol.mkdirSync("/project", { recursive: true });

      copyExtensionSkill("/ext", "/project", {
        name: "my-skill",
        file: "skills/my-skill.md",
      });

      const content = readFileSync("/project/.github/skills/my-skill/SKILL.md", "utf8");
      expect(content).toBe("# My Skill\nContent here");
    });

    it("does nothing when source file missing", () => {
      vol.mkdirSync("/ext", { recursive: true });
      vol.mkdirSync("/project", { recursive: true });

      copyExtensionSkill("/ext", "/project", {
        name: "missing",
        file: "skills/missing.md",
      });

      expect(existsSync("/project/.github/skills/missing")).toBe(false);
    });
  });
});
