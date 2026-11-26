import express, { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { makeExpenseController } from "../controllers/expense.controller";

/** Gastos F1a. Mounted before the global 32 KiB parser so its own 16 KiB limit applies. */
export function makeExpenseRouter(controller = makeExpenseController(), authentication = authenticate) {
  const router = Router();
  const json = express.json({ limit: "16kb" });
  router.get("/expense-categories", authentication, controller.listCategories);
  router.post("/expense-categories/seed", authentication, json, controller.seedCategories);
  router.post("/expense-categories", authentication, json, controller.createCategory);
  router.patch("/expense-categories/:id", authentication, json, controller.updateCategory);
  router.post("/expense-categories/:id/archive", authentication, json, controller.archiveCategory);
  router.post("/expense-categories/:id/reactivate", authentication, json, controller.reactivateCategory);
  router.get("/expenses", authentication, controller.listExpenses);
  router.get("/expenses/summary", authentication, controller.summary);
  router.get("/expenses/overview", authentication, controller.overview);
  router.get("/expenses/:id", authentication, controller.detail);
  router.post("/expenses", authentication, json, controller.createExpense);
  router.patch("/expenses/:id", authentication, json, controller.reclassifyExpense);
  router.post("/expenses/:id/void", authentication, json, controller.voidExpense);
  return router;
}
