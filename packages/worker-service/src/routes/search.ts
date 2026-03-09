import { Router, type Request, type Response } from "express";
import { searchAll, type SearchTable } from "../core/fts-search-service.js";

const VALID_TABLES = new Set<SearchTable>(["prompts", "observations", "errors", "sessions"]);

function parseTableFilter(raw: unknown): SearchTable[] {
  if (typeof raw !== "string") return [];
  const items = raw.split(",").map((s) => s.trim());
  return items.filter((t): t is SearchTable => VALID_TABLES.has(t as SearchTable));
}

const router = Router();

router.get("/api/:projectId/search", (req: Request, res: Response) => {
  const { projectId } = req.params;
  const q = typeof req.query["q"] === "string" ? req.query["q"].trim() : "";

  if (!q) {
    res.status(400).json({ error: "q is required" });
    return;
  }

  const tableFilter = parseTableFilter(req.query["tables"]);
  const limit = typeof req.query["limit"] === "string" ? parseInt(req.query["limit"], 10) : 20;

  const results = searchAll(projectId!, q, limit);
  const filtered = tableFilter.length > 0
    ? results.filter((r) => tableFilter.includes(r.table))
    : results;

  res.json({ results: filtered, query: q });
});

export default router;
