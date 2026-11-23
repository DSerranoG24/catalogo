import type { Response } from "express";
import { z } from "zod";
import type { AuthenticatedRequest } from "../types/auth.types";
import { makeCustomerService } from "../services/customer.service";
import { createCustomerSchema, updateCustomerSchema, customerIdSchema, customerListSchema } from "../schemas/customer.schema";

export function makeCustomerController(service = makeCustomerService()) {
  function handler(operation: "create" | "list" | "detail" | "update" | "archive" | "reactivate" | "remove") {
    return async (req: AuthenticatedRequest, res: Response) => {
      if (!req.user) return res.status(401).json({ success: false, error: "AUTH_REQUIRED", message: "Sesión requerida" });
      const ownerId = req.user.id;
      try {
        if (operation === "create") return res.status(201).json({ success: true, ...await service.create(ownerId, createCustomerSchema.parse(req.body)) });
        if (operation === "list") return res.json({ success: true, ...await service.list(ownerId, customerListSchema.parse(req.query)) });
        const id = customerIdSchema.parse(req.params.id);
        if (operation === "remove") return res.status(405).set("Allow", "GET, PATCH").json({ success: false, error: "CUSTOMER_DELETION_NOT_ALLOWED", message: "Los clientes se archivan; no se eliminan físicamente." });
        if (operation === "update") return res.json({ success: true, ...await service.update(ownerId, id, updateCustomerSchema.parse(req.body)) });
        const customer = await service[operation](ownerId, id);
        return res.json({ success: true, customer });
      } catch (error) {
        if (error instanceof z.ZodError) return res.status(400).json({ success: false, error: "INVALID_CUSTOMER_INPUT", message: "Revisa el nombre, teléfono, correo y los demás campos ingresados." });
        if (error instanceof Error && error.message === "CUSTOMER_NOT_FOUND") return res.status(404).json({ success: false, error: "CUSTOMER_NOT_FOUND", message: "Cliente no encontrado" });
        if (error instanceof Error && error.message === "ACCOUNT_CLOSED") return res.status(401).json({ success: false, error: "AUTH_REQUIRED", message: "Tu sesión ya no está disponible." });
        return res.status(500).json({ success: false, error: "CUSTOMER_OPERATION_FAILED", message: "No se pudo completar la operación de clientes. Puedes reintentar." });
      }
    };
  }
  return { create: handler("create"), list: handler("list"), detail: handler("detail"), update: handler("update"), archive: handler("archive"), reactivate: handler("reactivate"), remove: handler("remove") };
}
