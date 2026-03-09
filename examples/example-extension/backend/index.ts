import type { ExtensionRouterFactory } from "@renre-kit/extension-sdk";
import { Router } from "express";

const factory: ExtensionRouterFactory = (ctx) => {
  const router = Router();

  // GET /items — list all items for this project
  router.get("/items", (_req, res) => {
    try {
      const items = ctx.db!.prepare("SELECT * FROM ext_example_extension_items ORDER BY created_at DESC").all();
      res.json({ items });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.error(`Failed to list items: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  // POST /items — create a new item
  router.post("/items", (req, res) => {
    const { title, description } = req.body as { title?: string; description?: string };
    if (!title) {
      res.status(400).json({ error: "Missing title" });
      return;
    }
    try {
      const result = ctx.db!.prepare(
        "INSERT INTO ext_example_extension_items (project_id, title, description, created_at) VALUES (?, ?, ?, ?)"
      ).run(ctx.projectId, title, description ?? "", new Date().toISOString());
      ctx.logger.info(`Created item: ${title}`);
      res.json({ ok: true, id: result.lastInsertRowid });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.error(`Failed to create item: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  // DELETE /items/:id — delete an item
  router.delete("/items/:id", (req, res) => {
    const { id } = req.params;
    try {
      const result = ctx.db!.prepare("DELETE FROM ext_example_extension_items WHERE id = ?").run(id);
      if (result.changes === 0) {
        res.status(404).json({ error: "Item not found" });
        return;
      }
      res.json({ ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.error(`Failed to delete item ${id}: ${msg}`);
      res.status(500).json({ error: msg });
    }
  });

  // GET /__actions — action discovery
  router.get("/__actions", (_req, res) => {
    res.json({
      actions: [
        { name: "list", description: "List all items", method: "GET", path: "/items" },
        { name: "create", description: "Create a new item", method: "POST", path: "/items" },
        { name: "delete", description: "Delete an item by ID", method: "DELETE", path: "/items/:id" },
      ],
    });
  });

  return router;
};

export default factory;
