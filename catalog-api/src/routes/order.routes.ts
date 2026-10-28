import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { orderPrivacyController } from "../controllers/order-privacy.controller";
import {
  getCatalogOrdersController,
  updateOrderController,
} from "../controllers/order.controller";

const router = Router();
router.use(authenticate);
router.get("/catalog/:catalogId", getCatalogOrdersController);
router.patch("/:orderId", updateOrderController);
router.post("/:orderId/anonymize", orderPrivacyController);
router.delete("/:orderId", orderPrivacyController);

export default router;
