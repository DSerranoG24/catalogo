import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import {
  deleteProductReviewController,
  getCatalogReviewsController,
  moderateProductReviewController,
} from "../controllers/product-review.controller";

const router = Router();
router.use(authenticate);

router.get("/catalog/:catalogId", getCatalogReviewsController);
router.patch("/:id", moderateProductReviewController);
router.delete("/:id", deleteProductReviewController);

export default router;