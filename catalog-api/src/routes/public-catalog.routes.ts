import { Router } from "express";
import { rateLimit } from "express-rate-limit";
import {
  createPublicOrderController,
  getPublicCatalogController,
} from "../controllers/public-catalog.controller";
import {
  createPublicProductReviewController,
  getPublicProductReviewsController,
} from "../controllers/product-review.controller";

const router = Router();
const publicReadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 120,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Demasiadas solicitudes. Intenta más tarde." },
});
const orderLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 12,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Demasiadas órdenes. Intenta más tarde." },
});
const reviewLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, message: "Demasiados intentos. Intenta más tarde." },
});

router.get("/:publicId", publicReadLimiter, getPublicCatalogController);
router.get("/:publicId/products/:productSlug/reviews", publicReadLimiter, getPublicProductReviewsController);
router.post("/:publicId/products/:productSlug/reviews", reviewLimiter, createPublicProductReviewController);
router.post("/:publicId/orders", orderLimiter, createPublicOrderController);

export default router;
