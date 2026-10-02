import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import {
  registerController,
  loginController,
  googleAuthController,
} from "../controllers/auth.controller";

const router = Router();
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Demasiados intentos. Intenta más tarde." },
});

router.post("/register", authLimiter, registerController);
router.post("/login", authLimiter, loginController);
router.post("/google", authLimiter, googleAuthController);

export default router;