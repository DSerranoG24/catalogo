import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { AuthenticatedRequest } from "../types/auth.types";

const router = Router();

router.get(
  "/",
  authenticate,
  (req: AuthenticatedRequest, res) => {
    res.json({
      success: true,
      user: req.user,
    });
  }
);

export default router;