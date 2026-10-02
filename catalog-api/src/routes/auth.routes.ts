import { Router } from "express";
import { rateLimit } from "express-rate-limit";
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

export default router;