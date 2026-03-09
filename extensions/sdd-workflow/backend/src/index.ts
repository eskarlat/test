import { Router } from "express";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import type { ExtensionRouterFactory, ExtensionContext } from "@renre-kit/extension-sdk";

interface TaskInfo {
  name: string;
  phases: PhaseInfo[];
  adrs: string[];
  diagrams: string[];
  lastModified: string;
  createdAt: string;
}

interface PhaseInfo {
  file: string;
  title: string;
  number: string;
  status: string;
}

interface FileInfo {
  path: string;
  name: string;
  type: "file" | "directory";
  children?: FileInfo[];
  mtime?: string;
}

function tasksDir(projectDir: string): string {
  return join(projectDir, ".renre-kit", "tasks");
}

function readDirRecursive(dir: string, base: string): FileInfo[] {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  return entries
    .filter((e) => !e.name.startsWith("."))
    .map((entry) => {
      const fullPath = join(dir, entry.name);
      const relPath = relative(base, fullPath);
      if (entry.isDirectory()) {
        return {
          path: relPath,
          name: entry.name,
          type: "directory" as const,
          children: readDirRecursive(fullPath, base),
        };
      }
      const stat = statSync(fullPath);
      return {
        path: relPath,
        name: entry.name,
        type: "file" as const,
        mtime: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => {
      if (a.type !== b.type) return a.type === "directory" ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
}

function parsePhaseStatus(planReadme: string, phaseNum: string): string {
  const lines = planReadme.split("\n");
  for (const line of lines) {
    if (line.includes(`| ${parseInt(phaseNum, 10)}`) || line.includes(`| ${phaseNum}`)) {
      if (/completed/i.test(line)) return "Completed";
      if (/in.?progress/i.test(line)) return "In Progress";
    }
  }
  return "Pending";
}

function getTaskInfo(projectDir: string, taskName: string): TaskInfo | null {
  const taskDir = join(tasksDir(projectDir), taskName);
  if (!existsSync(taskDir)) return null;

  const planDir = join(taskDir, "plan");
  const adrDir = join(taskDir, "adr");
  const diagramsDir = join(taskDir, "diagrams");

  let planReadme = "";
  const planReadmePath = join(planDir, "README.md");
  if (existsSync(planReadmePath)) {
    planReadme = readFileSync(planReadmePath, "utf8");
  }

  const phases: PhaseInfo[] = [];
  if (existsSync(planDir)) {
    const files = readdirSync(planDir).filter((f) => /^phase-\d+/.test(f));
    for (const f of files) {
      const match = f.match(/^phase-(\d+)-(.+)\.md$/);
      if (!match) continue;
      const content = readFileSync(join(planDir, f), "utf8");
      const titleMatch = content.match(/^#\s+(.+)/m);
      phases.push({
        file: `plan/${f}`,
        title: titleMatch ? titleMatch[1] : f,
        number: match[1],
        status: parsePhaseStatus(planReadme, match[1]),
      });
    }
    phases.sort((a, b) => a.number.localeCompare(b.number));
  }

  const adrs = existsSync(adrDir)
    ? readdirSync(adrDir).filter((f) => f.endsWith(".md")).map((f) => `adr/${f}`)
    : [];

  const diagrams = existsSync(diagramsDir)
    ? readdirSync(diagramsDir).filter((f) => f.endsWith(".md")).map((f) => `diagrams/${f}`)
    : [];

  const stat = statSync(taskDir);
  let lastModified = stat.mtime.toISOString();

  // Find most recent file modification
  const allFiles = [...phases.map((p) => p.file), ...adrs, ...diagrams];
  for (const f of allFiles) {
    const fp = join(taskDir, f);
    if (existsSync(fp)) {
      const fstat = statSync(fp);
      if (fstat.mtime.toISOString() > lastModified) {
        lastModified = fstat.mtime.toISOString();
      }
    }
  }

  return {
    name: taskName,
    phases,
    adrs,
    diagrams,
    lastModified,
    createdAt: stat.birthtime.toISOString(),
  };
}

const factory: ExtensionRouterFactory = (ctx: ExtensionContext) => {
  const router = Router();
  const { projectDir, logger, llm } = ctx;

  // --- List all tasks ---
  router.get("/tasks", (_req, res) => {
    try {
      const dir = tasksDir(projectDir);
      if (!existsSync(dir)) {
        res.json({ tasks: [] });
        return;
      }
      const entries = readdirSync(dir, { withFileTypes: true });
      const tasks: TaskInfo[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
        const info = getTaskInfo(projectDir, entry.name);
        if (info) tasks.push(info);
      }
      tasks.sort((a, b) => b.lastModified.localeCompare(a.lastModified));
      res.json({ tasks });
    } catch (err) {
      logger.error("Failed to list tasks", { error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // --- Get single task ---
  router.get("/tasks/:name", (req, res) => {
    try {
      const info = getTaskInfo(projectDir, req.params.name);
      if (!info) {
        res.status(404).json({ error: "Task not found" });
        return;
      }
      const taskDir = join(tasksDir(projectDir), req.params.name);
      const files = readDirRecursive(taskDir, taskDir);
      res.json({ task: info, files });
    } catch (err) {
      logger.error("Failed to get task", { error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // --- Read a file ---
  router.get("/tasks/:name/file", (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath) {
        res.status(400).json({ error: "path query parameter required" });
        return;
      }
      // Prevent path traversal
      if (filePath.includes("..")) {
        res.status(400).json({ error: "Invalid path" });
        return;
      }
      const fullPath = join(tasksDir(projectDir), req.params.name, filePath);
      if (!existsSync(fullPath)) {
        res.status(404).json({ error: "File not found" });
        return;
      }
      const content = readFileSync(fullPath, "utf8");
      const stat = statSync(fullPath);
      res.json({
        content,
        mtime: stat.mtime.toISOString(),
        lineCount: content.split("\n").length,
      });
    } catch (err) {
      logger.error("Failed to read file", { error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // --- LLM review with inline comments ---
  router.post("/tasks/:name/review", async (req, res) => {
    if (!llm) {
      res.status(503).json({ error: "LLM not available" });
      return;
    }
    try {
      const { filePath, comments, customPrompt } = req.body as {
        filePath: string;
        comments: Array<{ lineNumber: number; content: string }>;
        customPrompt?: string;
      };

      if (!filePath || filePath.includes("..")) {
        res.status(400).json({ error: "Invalid filePath" });
        return;
      }

      const fullPath = join(tasksDir(projectDir), req.params.name, filePath);
      if (!existsSync(fullPath)) {
        res.status(404).json({ error: "File not found" });
        return;
      }

      const fileContent = readFileSync(fullPath, "utf8");

      // Build the review prompt
      let prompt = `Review phase #file: ${filePath}\n\n`;
      prompt += `## File Content\n\`\`\`\n${fileContent}\n\`\`\`\n\n`;

      if (comments.length > 0) {
        prompt += "## User Comments\n";
        for (const c of comments) {
          prompt += `line ${c.lineNumber}: comment: {${c.content}}\n`;
        }
        prompt += "\n";
      }

      prompt += customPrompt
        ? `## Additional Instructions\n${customPrompt}\n`
        : "Review the file and address all user comments. Suggest improvements, flag issues, and provide actionable feedback.\n";

      const response = await llm.complete({
        prompt,
        systemPrompt:
          "You are an expert software architect reviewing an SDD (Structured Design-Driven) plan phase. " +
          "Address each user comment specifically by line number. Be constructive, specific, and actionable.",
        maxTokens: 4000,
      });

      res.json({
        review: response.content,
        model: response.model,
        usage: response.usage,
      });
    } catch (err) {
      logger.error("Failed to generate review", { error: String(err) });
      res.status(500).json({ error: String(err) });
    }
  });

  // --- Check file mtime (for change detection) ---
  router.get("/tasks/:name/mtime", (req, res) => {
    try {
      const filePath = req.query.path as string;
      if (!filePath || filePath.includes("..")) {
        res.status(400).json({ error: "Invalid path" });
        return;
      }
      const fullPath = join(tasksDir(projectDir), req.params.name, filePath);
      if (!existsSync(fullPath)) {
        res.status(404).json({ error: "File not found" });
        return;
      }
      const stat = statSync(fullPath);
      res.json({ mtime: stat.mtime.toISOString() });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  return router;
};

export default factory;
