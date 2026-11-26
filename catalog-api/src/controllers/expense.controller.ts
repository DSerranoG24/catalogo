import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AuthenticatedRequest } from "../types/auth.types";
import { ExpenseError } from "../repositories/expense.repository";
import { makeExpenseService } from "../services/expense.service";

// Spanish messages only; never expense texts, references or internal details.
const errors: Record<string, [number, string]> = {
  ACCOUNT_CLOSED: [401, "Tu sesión ya no está disponible. Inicia sesión de nuevo."],
  INVALID_EXPENSE_INPUT: [400, "Revisa los datos: monto entre $ 1 y $ 1.000.000.000.000, fecha de hoy o de los últimos cinco años, y nota solo con «Otro»."],
  EXPENSE_CATEGORY_ARCHIVED: [400, "La categoría está archivada. Elige una categoría activa."],
  EXPENSE_NOT_FOUND: [404, "No se encontró el gasto en tu cuenta."],
  EXPENSE_CATEGORY_NOT_FOUND: [404, "No se encontró la categoría en tu cuenta."],
  VERSION_CONFLICT: [409, "El dato cambió. Recarga y revisa antes de confirmar otra vez."],
  INVALID_EXPENSE_TRANSITION: [409, "Esa acción ya no está disponible para este gasto. Recarga para ver su estado."],
  IDEMPOTENCY_CONFLICT: [409, "Esta operación ya se registró con otros datos. Recarga antes de repetirla."],
  EXPENSE_CATEGORY_NAME_CONFLICT: [409, "Ya existe una categoría con ese nombre. Si está archivada, puedes reactivarla."],
  EXPENSE_CATEGORY_QUOTA: [409, "Alcanzaste el máximo de 100 categorías. Archiva o reutiliza una existente."],
};

export function makeExpenseController(service = makeExpenseService()) {
  const handle = (work: (owner: string, req: AuthenticatedRequest) => Promise<unknown>, created = false) => async (req: AuthenticatedRequest, res: Response) => {
    res.set("Cache-Control", "private, no-store");
    if (!req.user) return res.status(401).json({ success: false, error: "AUTH_REQUIRED", message: "Sesión requerida." });
    try {
      const result = await work(req.user.id, req);
      const status = created && typeof result === "object" && result !== null && "idempotent" in result && result.idempotent === false ? 201 : 200;
      return res.status(status).json({ success: true, result });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, error: "INVALID_EXPENSE_INPUT", message: errors.INVALID_EXPENSE_INPUT[1] });
      const code = error instanceof ExpenseError || (error instanceof Error && error.message === "ACCOUNT_CLOSED") ? (error as Error).message : undefined;
      if (code && errors[code]) return res.status(errors[code][0]).json({ success: false, error: code, message: errors[code][1], ...(error instanceof ExpenseError && error.details ? { details: error.details } : {}) });
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const target = String(error.meta?.target ?? "");
        const known = target.includes("requestId") ? "IDEMPOTENCY_CONFLICT" : target.includes("normalizedKey") ? "EXPENSE_CATEGORY_NAME_CONFLICT" : null;
        if (known) return res.status(409).json({ success: false, error: known, message: errors[known][1] });
      }
      return res.status(503).json({ success: false, error: "EXPENSE_RETRY_SAME_OPERATION", message: "No se pudo completar la operación. Puedes reintentar con los mismos datos." });
    }
  };
  return {
    listCategories: handle((o, r) => service.listCategories(o, r.query)),
    seedCategories: handle((o, r) => service.seedCategories(o, r.body)),
    createCategory: handle((o, r) => service.createCategory(o, r.body), true),
    updateCategory: handle((o, r) => service.updateCategory(o, r.params.id, r.body)),
    archiveCategory: handle((o, r) => service.archiveCategory(o, r.params.id, r.body)),
    reactivateCategory: handle((o, r) => service.reactivateCategory(o, r.params.id, r.body)),
    listExpenses: handle((o, r) => service.listExpenses(o, r.query)),
    summary: handle((o, r) => service.summary(o, r.query)),
    overview: handle((o, r) => service.overview(o, r.query)),
    detail: handle((o, r) => service.detail(o, r.params.id)),
    createExpense: handle((o, r) => service.createExpense(o, r.body), true),
    reclassifyExpense: handle((o, r) => service.reclassifyExpense(o, r.params.id, r.body)),
    voidExpense: handle((o, r) => service.voidExpense(o, r.params.id, r.body)),
  };
}
