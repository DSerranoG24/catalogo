import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import {
  getCatalogOrdersController,
  updateOrderController,
} from "../controllers/order.controller";

const router = Router();
router.use(authenticate);
router.get("/catalog/:catalogId", getCatalogOrdersController);
router.patch("/:orderId", updateOrderController);

export default router;
