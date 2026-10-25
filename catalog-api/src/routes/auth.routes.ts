import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import { authenticate } from "../middlewares/auth.middleware";
import { makeAccountActionRouter } from "./account-action.routes";
import { accountActionService } from "../services/account-action.service";
import { linkGoogleAccount } from "../services/auth.service";
import { linkGoogleSchema } from "../schemas/account-action.schema";
import type { AuthenticatedRequest } from "../types/auth.types";
import {
  registerController,
  loginController,
  googleAuthController,
} from "../controllers/auth.controller";

const router = Router();
const createAuthLimiter = () => rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, error: "RATE_LIMITED", message: "Demasiados intentos. Intenta más tarde." },
});

router.post("/register", createAuthLimiter(), registerController);
router.post("/login", createAuthLimiter(), loginController);
router.post("/google", createAuthLimiter(), googleAuthController);
router.use(makeAccountActionRouter(authenticate, accountActionService));
router.post("/google/link", createAuthLimiter(), authenticate, async (req: AuthenticatedRequest, res) => {
  const parsed = linkGoogleSchema.safeParse(req.body);
  if (!parsed.success || !req.user) return res.status(400).json({ success: false, message: "Revisa los datos de vinculación." });
  try {
    await linkGoogleAccount(req.user.id, parsed.data.idToken, parsed.data.password);
    return res.json({ success: true });
  } catch { return res.status(400).json({ success: false, message: "No se pudo vincular Google. Comprueba tu contraseña y que ambas cuentas usen el mismo correo." }); }
});

export default router;
