import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import { authenticate } from "../middlewares/auth.middleware";
import type { AuthenticatedRequest } from "../types/auth.types";
import { requestAccountClosure } from "../services/account-closure.service";

const schema = z.object({ confirmation: z.literal("CERRAR CUENTA"), password: z.string().max(128).optional(), idToken: z.string().max(10000).optional() }).strict();
const router = Router();
router.post("/close", rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, legacyHeaders: false, standardHeaders: "draft-8" }), authenticate, async (req: AuthenticatedRequest, res) => {
  res.setHeader("Cache-Control", "no-store");
  const input = schema.safeParse(req.body);
  if (!input.success || !req.user) return res.status(400).json({ success: false, message: "Confirma CERRAR CUENTA y verifica tu identidad." });
  try {
    const job = await requestAccountClosure(req.user.id, input.data);
    return res.status(202).json({ success: true, job, message: "Cuenta cerrada al acceso. Limpieza pendiente; se conserva historial técnico y comercial." });
  } catch (error) {
    if (error instanceof Error && error.message === "ACCOUNT_ORDERS_REQUIRE_REVIEW") return res.status(409).json({ success: false, message: "Resuelve los pedidos pendientes o confirmados y revisa la anonimización de todos los completados y cancelados antes de cerrar." });
    return res.status(403).json({ success: false, message: "No se pudo cerrar la cuenta. Verifica de nuevo tu identidad e inténtalo otra vez." });
  }
});
export default router;
