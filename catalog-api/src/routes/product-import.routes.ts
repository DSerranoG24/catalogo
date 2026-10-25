import express, { Router, RequestHandler, Response } from "express";
import { randomUUID } from "node:crypto";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { authenticate } from "../middlewares/auth.middleware";
import { AuthenticatedRequest } from "../types/auth.types";
import { getJwtSecret } from "../utils/jwt";
import { importBatchSchema } from "../schemas/product-import.schema";
import { importErrorCode, makeProductImportService } from "../services/product-import.service";

export function makeProductImportRouter(auth: RequestHandler = authenticate, service = makeProductImportService()) {
  const router = Router({ mergeParams: true });
  router.use(auth);
  router.use(rateLimit({ windowMs: 15 * 60_000, limit: 60, standardHeaders: "draft-8", legacyHeaders: false,
    keyGenerator: (req: AuthenticatedRequest) => `${req.user?.id}:${req.params.catalogId}`,
    message: { success: false, error: "IMPORT_RATE_LIMITED" } }));
  // Per-user admission and an instance-wide cap bound simultaneous parsing/work, not just IP counts.
  const users = new Set<string>();
  const leases = new WeakMap<Response, { busy: boolean; release: () => void }>();
  let active = 0;
  router.use((req: AuthenticatedRequest, res, next) => {
    const userId = req.user?.id;
    if (!userId) return res.status(401).json({ success: false, error: "AUTH_REQUIRED" });
    if (users.has(userId) || active >= 4) return res.set("Retry-After", "2").status(429).json({ success: false, error: "IMPORT_BUSY" });
    users.add(userId); active++;
    let released = false;
    const lease = { busy: false, release: () => { if (!released) { released = true; users.delete(userId); active--; } } };
    leases.set(res, lease);
    const releaseWhenIdle = () => { if (!lease.busy) lease.release(); };
    res.once("finish", releaseWhenIdle); res.once("close", releaseWhenIdle);
    next();
  });
  // This parser is mounted before the global 32 KB parser and only handles import routes.
  router.use((req, res, next) => {
    res.set("Cache-Control", "private, no-store");
    if (!req.is("application/json")) return res.status(415).json({ success: false, error: "JSON_REQUIRED" });
    next();
  });
  router.use(express.json({ limit: "2mb", strict: true }));
  const handler = (mode: "preview" | "confirm"): RequestHandler => async (req: AuthenticatedRequest, res) => {
    const requestId = randomUUID();
    res.set("X-Request-ID", requestId);
    const catalog = z.string().uuid().safeParse(req.params.catalogId);
    const batch = importBatchSchema.safeParse(req.body);
    if (!req.user || !catalog.success || !batch.success) return res.status(400).json({ success: false, error: "INVALID_IMPORT_BATCH", requestId });
    const lease = leases.get(res);
    if (lease) lease.busy = true;
    try {
      const result = await service[mode](catalog.data, req.user.id, batch.data, getJwtSecret());
      return res.json({ success: true, requestId, ...result });
    } catch (error) {
      const code = importErrorCode(error);
      const status = code === "CATALOG_NOT_FOUND" ? 404 : code === "CATALOG_ARCHIVED" ? 409 : code === "INVALID_IMPORT_PREVIEW" ? 409 : 503;
      if (status === 503) console.error(JSON.stringify({ event: "product_import_failed", requestId, errorCode: code }));
      return res.status(status).json({ success: false, error: code, requestId });
    } finally { if (lease) { lease.busy = false; lease.release(); } }
  };
  router.post("/preview", handler("preview"));
  router.post("/confirm", handler("confirm"));
  // Do not fall through to the global JSON parser for unsupported import methods/paths.
  router.use((_req, res) => { res.status(404).json({ success: false, error: "IMPORT_ROUTE_NOT_FOUND" }); });
  return router;
}
