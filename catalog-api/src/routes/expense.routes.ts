import express, { Router } from "express";
import { rateLimit } from "express-rate-limit";
import type { AuthenticatedRequest } from "../types/auth.types";
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
  // F1b routes go before /expenses/:id so "scheduled" and "recurring" are never read as an expense id.
  // Gastos and Inicio call sync on every open: its own per-account limit, keyed after authentication.
  const syncLimit = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, keyGenerator: (req: AuthenticatedRequest) => req.user?.id ?? "unauthenticated",
    message: { success: false, error: "RATE_LIMITED", message: "Demasiadas actualizaciones de pagos programados. Espera un momento." } });
  router.post("/expenses/scheduled/sync", authentication, syncLimit, controller.syncScheduled);
  router.get("/expenses/scheduled", authentication, controller.listScheduled);
  router.post("/expenses/scheduled", authentication, json, controller.createScheduled);
  router.patch("/expenses/scheduled/:id", authentication, json, controller.updateScheduled);
  router.post("/expenses/scheduled/:id/pay", authentication, json, controller.payScheduled);
  router.post("/expenses/scheduled/:id/cancel", authentication, json, controller.cancelScheduled);
  router.get("/expenses/recurring", authentication, controller.listRecurring);
  router.post("/expenses/recurring", authentication, json, controller.createRecurring);
  router.patch("/expenses/recurring/:id", authentication, json, controller.updateRecurring);
  router.post("/expenses/recurring/:id/pause", authentication, json, controller.pauseRecurring);
  router.post("/expenses/recurring/:id/resume", authentication, json, controller.resumeRecurring);
  router.post("/expenses/recurring/:id/end", authentication, json, controller.endRecurring);
  router.get("/expenses", authentication, controller.listExpenses);
  router.get("/expenses/summary", authentication, controller.summary);
  router.get("/expenses/overview", authentication, controller.overview);
  router.get("/expenses/:id", authentication, controller.detail);
  router.post("/expenses", authentication, json, controller.createExpense);
  router.patch("/expenses/:id", authentication, json, controller.reclassifyExpense);
  router.post("/expenses/:id/void", authentication, json, controller.voidExpense);
  return router;
}
