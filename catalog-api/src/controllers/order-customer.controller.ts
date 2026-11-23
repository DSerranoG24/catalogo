import { z } from "zod";
import type { Response } from "express";
import type { AuthenticatedRequest } from "../types/auth.types";
import { makeOrderCustomerService } from "../services/order-customer.service";
import { OrderCustomerConflict } from "../repositories/order-customer.repository";
import { orderCustomerPreviewSchema } from "../schemas/order-customer.schema";

const messages: Record<string, string> = {
  CUSTOMER_PHONE_MATCH: "Ya hay clientes activos con este teléfono. Elige uno expresamente o cancela; no se creó otro cliente.",
  ORDER_CANCELLED: "No se puede guardar el cliente de un pedido cancelado.", ORDER_ANONYMIZED: "Este pedido fue anonimizado y no puede usarse para crear clientes.",
  CUSTOMER_ARCHIVED: "El cliente seleccionado está archivado.", CUSTOMER_MATCH_CHANGED: "El teléfono del cliente cambió. Revisa la coincidencia otra vez.",
  ORDER_CUSTOMER_ALREADY_SAVED: "Este pedido ya tiene un cliente guardado. Actualiza la revisión y usa el cliente existente.",
  ORDER_CUSTOMER_CONFLICT: "El pedido ya está asociado a otro cliente.", SALE_CUSTOMER_CONFLICT: "La venta ya está asociada a otro cliente; no se reemplazó.",
  ORDER_SALE_NOT_FOUND: "El pedido aún no tiene una venta para asociar.", IDEMPOTENCY_CONFLICT: "Esta confirmación ya se usó con otros datos. Actualiza la revisión.",
};
export function makeOrderCustomerController(service = makeOrderCustomerService()) {
  const handler = (operation: "preview" | "confirm" | "matches") => async (req: AuthenticatedRequest, res: Response) => {
    res.set("Cache-Control", "private, no-store");
    if (!req.user) return res.status(401).json({ success: false, error: "AUTH_REQUIRED", message: "Sesión requerida" });
    try {
      const orderId = z.uuid().parse(req.params.orderId);
      if (operation === "preview") orderCustomerPreviewSchema.parse(req.body ?? {});
      const result = operation === "matches" ? await service.matchingPage(req.user.id, orderId, req.query) : operation === "preview" ? await service.preview(req.user.id, orderId) : await service.confirm(req.user.id, orderId, req.body);
      return res.json({ success: true, result });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, error: "INVALID_CUSTOMER_INPUT", message: "Revisa los datos del cliente antes de confirmar." });
      if (error instanceof OrderCustomerConflict) return res.status(409).json({ success: false, error: error.code, message: messages[error.code] ?? "Revisa la operación antes de continuar.", matches: error.matches, hasMore: error.hasMore });
      if (error instanceof Error && ["ORDER_NOT_FOUND", "CUSTOMER_NOT_FOUND"].includes(error.message)) return res.status(404).json({ success: false, error: error.message, message: "Pedido o cliente no encontrado." });
      if (error instanceof Error && error.message === "ACCOUNT_CLOSED") return res.status(401).json({ success: false, error: "AUTH_REQUIRED", message: "Sesión no disponible" });
      return res.status(500).json({ success: false, error: "ORDER_CUSTOMER_FAILED", message: "No se pudo completar la operación. Puedes reintentar la misma confirmación." });
    }
  };
  return { preview: handler("preview"), confirm: handler("confirm"), matches: handler("matches") };
}
