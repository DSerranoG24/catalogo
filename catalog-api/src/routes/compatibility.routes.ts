import express, { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { makeCompatibilityController } from "../controllers/compatibility.controller";

export function makeCompatibilityRouter(controller = makeCompatibilityController(), authentication = authenticate) {
  const router = Router();
  const json = express.json({ limit: "16kb" });
  // Authenticate only matched routes: this router is mounted before the global parser.
  router.get("/device-brands", authentication, controller.brands);
  router.post("/device-brands", authentication, json, controller.createBrand);
  router.get("/device-brands/:id", authentication, controller.brand);
  router.get("/device-brands/:id/names", authentication, controller.brandNames);
  router.post("/device-brands/:id/names", authentication, json, controller.addBrandAlias);
  router.get("/device-models", authentication, controller.models);
  router.post("/device-models", authentication, json, controller.createModel);
  router.get("/device-models/:id", authentication, controller.model);
  router.get("/device-models/:id/names", authentication, controller.modelNames);
  router.post("/device-models/:id/names", authentication, json, controller.addModelAlias);
  router.get("/inventory/items/:id/compatibilities", authentication, controller.list);
  router.post("/inventory/items/:id/compatibilities", authentication, json, controller.add);
  router.patch("/inventory/items/:id/compatibilities/:compatibilityId", authentication, json, controller.update);
  router.get("/inventory/items/:id/compatibility-events", authentication, controller.events);
  return router;
}
