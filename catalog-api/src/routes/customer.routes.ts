import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { makeCustomerController } from "../controllers/customer.controller";
import { makeCustomerSalesController } from "../controllers/customer-sales.controller";

export function makeCustomerRouter(controller = makeCustomerController(), authentication = authenticate, sales = makeCustomerSalesController()) {
  const router = Router();
  router.use((_req, res, next) => { res.set("Cache-Control", "private, no-store"); next(); });
  router.use(authentication);
  router.post("/", controller.create);
  router.get("/", controller.list);
  router.get("/:id/sales", sales);
  router.get("/:id", controller.detail);
  router.patch("/:id", controller.update);
  router.post("/:id/archive", controller.archive);
  router.post("/:id/reactivate", controller.reactivate);
  router.delete("/:id", controller.remove);
  return router;
}
