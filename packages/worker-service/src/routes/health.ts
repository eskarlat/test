import { Router, type Request, type Response } from "express";
import { SDK_VERSION } from "@renre-kit/extension-sdk";

const router = Router();

router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "ok",
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    port: parseInt(process.env["RENRE_KIT_PORT"] ?? "42888", 10),
    version: "0.1.0",
    sdkVersion: SDK_VERSION,
  });
});

export default router;
