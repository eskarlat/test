import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const LEARN_SKILL_CONTENT = `---
name: learn
description: Use after significant debugging, workarounds, or multi-step workflows worth standardizing for future sessions
---

# /learn - Online Learning System

**Extract reusable knowledge from this session into skills.** Evaluates what was learned, checks for existing skills, creates new ones when valuable.

---

## Phase 0: Reference

### Triggers

| Trigger | Example |
|---------|---------|
| **Non-obvious debugging** | Spent 10+ minutes; solution wasn't in docs |
| **Misleading errors** | Error message pointed wrong direction; found real cause |
| **Workarounds** | Found limitation and creative solution |
| **Tool integration** | Undocumented API/tool usage |
| **Trial-and-error** | Tried multiple approaches before finding what worked |
| **Repeatable workflow** | Multi-step task that will recur |
| **External service queries** | Fetched from Jira, GitHub, Confluence |
| **User-facing automation** | Reports, status checks user will ask for again |

### Quality Criteria

- **Reusable**: Will help future tasks, not just this instance
- **Non-trivial**: Required discovery or is a valuable workflow pattern
- **Verified**: Solution actually worked

**Do NOT extract:** Single-step tasks, one-off fixes, knowledge in official docs.

### Project Slug

Prefix ALL created skills with the project slug to avoid name collisions across repos.

\`\`\`bash
SLUG=$(basename "$(git remote get-url origin 2>/dev/null | sed 's/\\.git$//')" 2>/dev/null || basename "$PWD")
\`\`\`

Skill directory: \`.github/skills/{slug}-{name}/SKILL.md\`

**Keep names short.** The slug provides context; the name should be 1-3 words max.
Examples: \`pilot-shell-lsp-cleaner\`, \`my-api-auth-flow\`, \`acme-deploy\`.

### Skill Structure

**Location:** \`.github/skills/{slug}-{skill-name}/SKILL.md\`

\`\`\`markdown
---
name: {slug}-descriptive-kebab-case-name
description: |
  [CRITICAL: Describe WHEN to use, not HOW it works.
   Include trigger conditions, scenarios, exact error messages.]
author: Claude Code
version: 1.0.0
---

# Skill Name

## Problem
## Context / Trigger Conditions
## Solution
## Verification
## Example
## References
\`\`\`

**The Description Trap:** If description summarizes the workflow, the agent follows the
short description as a shortcut instead of reading SKILL.md. Always describe trigger
conditions, not process.

**Guidelines:** Concise. Under 1000 lines. Examples over explanations.

---

## Phase 1: Evaluate

Ask yourself:

1. "What did I learn that wasn't obvious before starting?"
2. "Would future-me benefit from having this documented?"
3. "Was the solution non-obvious from docs alone?"
4. "Is this a multi-step workflow I'd repeat?"
5. "Did I query an external service the user will ask about again?"

**If NO to all → Skip, nothing to learn.**

---

## Phase 2: Check Existing

\`\`\`bash
ls .github/skills/ 2>/dev/null
rg -i "keyword" .github/skills/ 2>/dev/null
\`\`\`

| Found | Action |
|-------|--------|
| Nothing related | Create new |
| Same trigger/fix | Update existing (bump version) |
| Partial overlap | Update with new variant |

---

## Phase 3: Create Skill

Write to \`.github/skills/{slug}-{skill-name}/SKILL.md\` using the template from Phase 0.
Ensure description contains specific trigger conditions and the name is prefixed with
the project slug.

---

## Phase 4: Quality Gates

- [ ] Description contains specific trigger conditions
- [ ] Solution verified to work
- [ ] Specific enough to be actionable
- [ ] General enough to be reusable
- [ ] No sensitive information
`;

const LEARN_SKILL_CHECKSUM = createHash("sha256").update(LEARN_SKILL_CONTENT).digest("hex");

export function installLearnSkill(projectDir: string): void {
  const skillDir = join(projectDir, ".github", "skills", "learn");
  const skillFile = join(skillDir, "SKILL.md");
  mkdirSync(skillDir, { recursive: true });

  if (existsSync(skillFile)) {
    const existing = readFileSync(skillFile, "utf8");
    const existingChecksum = createHash("sha256").update(existing).digest("hex");
    if (existingChecksum !== LEARN_SKILL_CHECKSUM) return;
  }

  writeFileSync(skillFile, LEARN_SKILL_CONTENT, "utf8");
}

export function removeExtensionSkills(projectDir: string, skillNames: string[]): void {
  for (const name of skillNames) {
    const skillDir = join(projectDir, ".github", "skills", name);
    if (existsSync(skillDir)) {
      rmSync(skillDir, { recursive: true, force: true });
    }
  }
}

export function copyExtensionSkill(
  extensionDir: string,
  projectDir: string,
  skillDef: { name: string; file: string },
): void {
  const srcFile = join(extensionDir, skillDef.file);
  if (!existsSync(srcFile)) return;
  const destDir = join(projectDir, ".github", "skills", skillDef.name);
  mkdirSync(destDir, { recursive: true });
  writeFileSync(join(destDir, "SKILL.md"), readFileSync(srcFile, "utf8"), "utf8");
}
