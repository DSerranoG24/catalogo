import { Router, type RequestHandler } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { requireAdmin } from "../middlewares/admin.middleware";
import { readAdminMetrics } from "../repositories/admin-metrics.repository";

export function makeAdminRouter(auth: RequestHandler = authenticate, authorize: RequestHandler = requireAdmin, metrics = readAdminMetrics) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.use(auth, authorize);
  router.get("/access", (_req, res) => res.json({ success: true }));
  router.get("/metrics", async (req, res) => {
    if (Object.keys(req.query).length) return res.status(400).json({ success: false, error: "INVALID_METRICS_QUERY" });
    try { return res.json({ success: true, metrics: await metrics() }); }
    catch { return res.status(503).json({ success: false, error: "METRICS_UNAVAILABLE", message: "No se pudieron actualizar las métricas. Intenta de nuevo." }); }
  });
  router.use((_req, res) => res.status(404).json({ success: false, error: "ROUTE_NOT_FOUND" }));
  return router;
}
export default makeAdminRouter();
