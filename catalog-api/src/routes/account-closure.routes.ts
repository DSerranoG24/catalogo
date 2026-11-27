import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { authenticate } from "../middlewares/auth.middleware";
import type { AuthenticatedRequest } from "../types/auth.types";
import { accountClosureSchema } from "../schemas/account-closure.schema";
import { ClosureConfirmationRequired, closurePreview, requestAccountClosure } from "../services/account-closure.service";

const bigintJson = (value: unknown) => JSON.parse(JSON.stringify(value, (_k, v) => typeof v === "bigint" ? v.toString() : v));

// confirmOpenBalances: the owner saw GET /close/preview and accepts closing with money or deliveries open (correction C).
const schema = accountClosureSchema;
const router = Router();
router.get("/close/preview", authenticate, async (req: AuthenticatedRequest, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (!req.user) return res.sendStatus(401);
  try { return res.json({ success: true, preview: bigintJson(await closurePreview(req.user.id)) }); }
  catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_CLOSED") return res.status(401).json({ success: false, error: "AUTH_REQUIRED", message: "Tu sesión ya no está disponible." });
    return res.status(500).json({ success: false, error: "CLOSURE_PREVIEW_UNAVAILABLE", message: "No se pudo preparar el resumen del cierre." });
  }
});
router.post("/close", rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, legacyHeaders: false, standardHeaders: "draft-8" }), authenticate, async (req: AuthenticatedRequest, res) => {
  res.setHeader("Cache-Control", "no-store");
  const input = schema.safeParse(req.body);
  if (!input.success || !req.user) return res.status(400).json({ success: false, message: "Confirma CERRAR CUENTA y verifica tu identidad." });
  try {
    const job = await requestAccountClosure(req.user.id, input.data);
    return res.status(202).json({ success: true, job, message: "Cuenta cerrada al acceso. Limpieza pendiente; se conserva historial técnico y comercial." });
  } catch (error) {
    if (error instanceof ClosureConfirmationRequired) return res.status(409).json({ success: false, error: error.message, preview: bigintJson(error.preview),
      message: "Antes de cerrar, revisa lo que te deben, los saldos a favor, el dinero por devolver y las ventas sin entregar, y confirma." });
    if (error instanceof Error && error.message === "ACCOUNT_ORDERS_REQUIRE_REVIEW") return res.status(409).json({ success: false, message: "Resuelve los pedidos pendientes o confirmados y revisa la anonimización de todos los completados y cancelados antes de cerrar." });
    return res.status(403).json({ success: false, message: "No se pudo cerrar la cuenta. Verifica de nuevo tu identidad e inténtalo otra vez." });
  }
});
export default router;
