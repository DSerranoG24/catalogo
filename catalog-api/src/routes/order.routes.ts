import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { orderPrivacyController } from "../controllers/order-privacy.controller";
import { makeOrderCustomerController } from "../controllers/order-customer.controller";
import {
  getCatalogOrdersController,
  updateOrderController,
  convertOrderToSaleController,
} from "../controllers/order.controller";

const router = Router();
router.use(authenticate);
const customer = makeOrderCustomerController();
router.post("/:orderId/customer-preview", customer.preview);
router.post("/:orderId/customer-confirm", customer.confirm);
router.get("/:orderId/customer-matches", customer.matches);
router.get("/catalog/:catalogId", getCatalogOrdersController);
router.patch("/:orderId", updateOrderController);
router.post("/:orderId/convert-to-sale", convertOrderToSaleController);
router.post("/:orderId/anonymize", orderPrivacyController);
router.delete("/:orderId", orderPrivacyController);

export default router;
