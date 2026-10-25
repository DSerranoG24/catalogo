import { Router, type RequestHandler } from "express";
import { rateLimit } from "express-rate-limit";
import type { AuthenticatedRequest } from "../types/auth.types";
import { confirmEmailSchema, forgotPasswordSchema, resetPasswordSchema, verificationRequestSchema } from "../schemas/account-action.schema";
import type { AccountActionService } from "../services/account-action.service";

export const recoveryAccepted = { success: true, message: "Si corresponde, recibirás instrucciones para recuperar el acceso." };
export const invalidAction = { success: false, message: "El enlace no es válido, ha vencido o ya se utilizó. Solicita uno nuevo." };
export function makeAccountActionRouter(authenticate: RequestHandler, service: AccountActionService) {
  const router = Router();
  const limiter = () => rateLimit({ windowMs: 15 * 60_000, limit: 10, standardHeaders: "draft-8", legacyHeaders: false, message: { success: false, message: "Demasiados intentos. Intenta más tarde." } });
  router.use((_req, res, next) => { res.setHeader("Cache-Control", "no-store"); next(); });
  router.post("/verification/request", limiter(), authenticate, (req: AuthenticatedRequest, res) => {
    if (!req.user) return res.status(401).json({ success: false });
    if (!verificationRequestSchema.safeParse(req.body ?? {}).success) return res.status(400).json({ success: false, message: "No envíes una dirección de correo en esta solicitud." });
    if (!service.requestVerification(req.user.id)) return res.status(503).json({ success: false, message: "No se pudo solicitar el correo. Intenta más tarde." });
    return res.status(202).json({ success: true, retryAfterSeconds: 60, message: "Solicitud registrada. Si corresponde, recibirás el enlace; revisa también spam." });
  });
  router.post("/password/forgot", limiter(), (req, res) => {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ success: false, message: "Revisa el correo electrónico." });
    service.requestRecovery(parsed.data.email);
    return res.status(202).json(recoveryAccepted);
  });
  for (const kind of ["verification/confirm", "password/reset"] as const) router.post(`/${kind}`, limiter(), async (req, res) => {
    try {
      if (kind === "verification/confirm") {
        const parsed = confirmEmailSchema.safeParse(req.body);
        if (!parsed.success || !await service.confirmVerification(parsed.data.token)) return res.status(400).json(invalidAction);
      } else {
        if (!confirmEmailSchema.safeParse({ token: req.body?.token }).success) return res.status(400).json(invalidAction);
        const parsed = resetPasswordSchema.safeParse(req.body);
        if (!parsed.success) return res.status(400).json({ success: false, message: "Revisa el enlace y las contraseñas: deben coincidir, tener al menos 8 caracteres y como máximo 72 bytes." });
        if (!await service.resetPassword(parsed.data.token, parsed.data.password)) return res.status(400).json(invalidAction);
      }
      return res.json({ success: true, message: kind === "verification/confirm" ? "Correo verificado." : "Contraseña actualizada. Inicia sesión de nuevo en tus dispositivos." });
    } catch { return res.status(503).json({ success: false, message: "No se pudo completar la operación. Intenta más tarde." }); }
  });
  return router;
}
