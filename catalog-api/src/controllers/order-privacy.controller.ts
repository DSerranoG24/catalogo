import type { Response } from "express";
import type { AuthenticatedRequest } from "../types/auth.types";
import { anonymizeOrderSchema, deleteOrderSchema } from "../schemas/order-privacy.schema";
import { anonymizeOrder, deletePendingOrder } from "../repositories/order-privacy.repository";

export async function orderPrivacyController(req: AuthenticatedRequest, res: Response) {
  if (!req.user || typeof req.params.orderId !== "string") return res.status(401).json({ success: false });
  try {
    if (req.method === "DELETE") {
      const input = deleteOrderSchema.safeParse(req.body);
      if (!input.success) return res.status(400).json({ success: false, message: "Escribe ELIMINAR y el nombre exacto del cliente." });
      await deletePendingOrder(req.params.orderId, req.user.id, input.data.customerName);
      return res.json({ success: true });
    }
    const input = anonymizeOrderSchema.safeParse(req.body);
    if (!input.success) return res.status(400).json({ success: false, message: "Revisa los textos y confirma la anonimización." });
    const result = await anonymizeOrder(req.params.orderId, req.user.id, input.data);
    return res.json({ success: true, ...result });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    if (code === "ORDER_NOT_FOUND") return res.status(404).json({ success: false, message: "Pedido no encontrado." });
    const messages: Record<string, string> = {
      ORDER_NOT_TERMINAL: "Solo puedes anonimizar pedidos completados o cancelados.",
      ORDER_NOT_PENDING: "Solo puedes eliminar pedidos pendientes.",
      ORDER_CONFIRMATION_MISMATCH: "El nombre no coincide. Revisa el pedido.",
    };
    return res.status(messages[code] ? 409 : 500).json({ success: false, message: messages[code] ?? "No se pudo completar la operación. Actualiza e inténtalo de nuevo." });
  }
}
