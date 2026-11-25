import { Router, type RequestHandler } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import type { AuthenticatedRequest } from "../types/auth.types";
import { readDashboardSummary } from "../repositories/dashboard-summary.repository";
import { DashboardQueryError, parseDashboardQuery, type DashboardDays, type DashboardSummary } from "../services/dashboard-summary";

type Reader = (ownerId: string, days: DashboardDays) => Promise<DashboardSummary>;

/** Private, read-only Inicio figures. The owner always comes from the session. */
export function makeDashboardRouter(authentication: RequestHandler = authenticate, read: Reader = (ownerId, days) => readDashboardSummary(ownerId, days)) {
  const router = Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
  router.use(authentication);
  router.get("/summary", async (req: AuthenticatedRequest, res) => {
    if (!req.user) return res.status(401).json({ success: false, error: "AUTH_REQUIRED", message: "Sesión requerida." });
    let days: DashboardDays;
    try { ({ days } = parseDashboardQuery(req.query)); }
    catch (error) {
      if (error instanceof DashboardQueryError) return res.status(400).json({ success: false, error: "INVALID_DASHBOARD_QUERY", message: "Usa days=7, 30 o 90, sin otros parámetros." });
      throw error;
    }
    try { return res.json(await read(req.user.id, days)); }
    catch {
      // No details: they could include query text or identifiers.
      console.error("DASHBOARD_SUMMARY_FAILED");
      return res.status(500).json({ success: false, error: "DASHBOARD_UNAVAILABLE", message: "No se pudo cargar el resumen. Intenta de nuevo." });
    }
  });
  return router;
}
