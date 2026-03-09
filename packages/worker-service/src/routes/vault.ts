import { Router, type Request, type Response } from "express";
import { getSecret, setSecret, deleteSecret, listSecretKeys } from "../core/vault-resolver.js";
import { eventBus } from "../core/event-bus.js";
import { logger } from "../core/logger.js";

const router = Router();

// List all secret key names (no values)
router.get("/api/vault/keys", (_req: Request, res: Response) => {
  try {
    const keys = listSecretKeys();
    res.json(keys);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("vault", `Failed to list keys: ${msg}`);
    res.status(500).json({ error: "Failed to list vault keys" });
  }
});

// Create or update a secret
router.post("/api/vault/secrets", (req: Request, res: Response) => {
  const { key, value } = req.body as { key?: string; value?: string };

  if (!key || typeof key !== "string" || key.trim() === "") {
    res.status(400).json({ error: "Missing or invalid key" });
    return;
  }
  if (value === undefined || value === null) {
    res.status(400).json({ error: "Missing value" });
    return;
  }

  try {
    setSecret(key, String(value));
    eventBus.publish("vault:updated", { key, action: "set" });
    // Never return or log the value
    res.json({ ok: true, key });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("vault", `Failed to set key "${key}": ${msg}`);
    res.status(500).json({ error: "Failed to store secret" });
  }
});

// Delete a secret
router.delete("/api/vault/secrets/:key", (req: Request, res: Response) => {
  const { key } = req.params;
  if (!key) {
    res.status(400).json({ error: "Missing key" });
    return;
  }

  try {
    const deleted = deleteSecret(key);
    if (!deleted) {
      res.status(404).json({ error: `Key "${key}" not found` });
      return;
    }
    eventBus.publish("vault:updated", { key, action: "delete" });
    res.json({ ok: true, key });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("vault", `Failed to delete key "${key}": ${msg}`);
    res.status(500).json({ error: "Failed to delete secret" });
  }
});

// Check if a secret key exists (without revealing the value)
router.get("/api/vault/secrets/:key/exists", (req: Request, res: Response) => {
  const { key } = req.params;
  if (!key) {
    res.status(400).json({ error: "Missing key" });
    return;
  }

  try {
    const secret = getSecret(key);
    res.json({ exists: secret !== null, key });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("vault", `Failed to check key "${key}": ${msg}`);
    res.status(500).json({ error: "Failed to check secret" });
  }
});

export default router;
