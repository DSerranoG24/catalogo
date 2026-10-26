import { Router, type RequestHandler } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { requireAdmin } from "../middlewares/admin.middleware";

export function makeAdminRouter(auth: RequestHandler = authenticate, authorize: RequestHandler = requireAdmin) {
  const router = Router();
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.use(auth, authorize);
  router.get("/access", (_req, res) => res.json({ success: true }));
  router.use((_req, res) => res.status(404).json({ success: false, error: "ROUTE_NOT_FOUND" }));
  return router;
}
export default makeAdminRouter();
