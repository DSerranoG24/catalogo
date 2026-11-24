import type { Response } from "express";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import type { AuthenticatedRequest } from "../types/auth.types";
import { makeCompatibilityService } from "../services/compatibility.service";

const errors: Record<string, [number, string]> = {
  ACCOUNT_CLOSED: [401, "Tu sesión ya no está disponible. Inicia sesión de nuevo."],
  COMPATIBILITY_RESOURCE_NOT_FOUND: [404, "No se encontró el recurso en tu cuenta."],
  NAME_CONFLICT: [409, "Ese nombre o alias ya identifica otra entrada. Revisa el diccionario existente."],
  MODEL_CODE_CONFLICT: [409, "Ese código ya está registrado en esta marca."],
  VERSION_CONFLICT: [409, "La información cambió. Recarga y revisa antes de confirmar otra vez."],
  IDEMPOTENCY_CONFLICT: [409, "Esta operación ya se utilizó con otro contenido."],
  DEVICE_RETIRED: [409, "La marca, modelo o conjunto ya no está disponible para esta acción."],
  COMPATIBILITY_ALREADY_EXISTS: [409, "La compatibilidad ya existe. Revisa su estado; no se creó otra."],
  INVALID_COMPATIBILITY_TRANSITION: [409, "Cambio de estado no permitido. Reabre como pendiente antes de verificar; una evidencia modificada requiere nueva revisión."],
  COMPATIBILITY_REASON_REQUIRED: [400, "Escribe un motivo de al menos tres caracteres para rechazar o retirar."],
  COMPATIBILITY_EVIDENCE_REQUIRED: [400, "Verificar requiere tipo de evidencia y una referencia o nota nueva confirmada expresamente."],
};
export function makeCompatibilityController(service = makeCompatibilityService()) {
  const handle = (work: (owner: string, req: AuthenticatedRequest) => Promise<unknown>, envelope: "list" | "detail" | "mutation" = "list", create = false) => async (req: AuthenticatedRequest, res: Response) => {
    res.set("Cache-Control", "private, no-store");
    if (!req.user) return res.status(401).json({ success: false, error: "AUTH_REQUIRED", message: "Sesión requerida." });
    try {
      const result = await work(req.user.id, req);
      const status = create && result !== null && typeof result === "object" && "idempotent" in result && result.idempotent === false ? 201 : 200;
      return res.status(status).json(envelope === "list" ? { success: true, ...z.record(z.string(), z.unknown()).parse(result) } : { success: true, result });
    } catch (error) {
      if (error instanceof z.ZodError) return res.status(400).json({ success: false, error: "INVALID_COMPATIBILITY_INPUT", message: "Revisa los identificadores, nombres, versiones y campos ingresados." });
      const known = error instanceof Error ? errors[error.message] : undefined;
      if (known && error instanceof Error) return res.status(known[0]).json({ success: false, error: error.message, message: known[1] });
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return res.status(409).json({ success: false, error: "COMPATIBILITY_CONFLICT", message: "Otro cambio registró ese nombre, código o relación. Recarga y revisa." });
      return res.status(503).json({ success: false, error: "COMPATIBILITY_RETRY_SAME_OPERATION", message: "No se pudo completar la operación. Puedes reintentar con los mismos datos." });
    }
  };
  return {
    brands: handle((o,r) => service.brands(o,r.query)), models: handle((o,r) => service.models(o,r.query)),
    brand: handle((o,r) => service.detail(o,r.params.id,"brand"), "detail"), model: handle((o,r) => service.detail(o,r.params.id,"model"), "detail"),
    brandNames: handle((o,r) => service.aliases(o,r.params.id,"brand",r.query)), modelNames: handle((o,r) => service.aliases(o,r.params.id,"model",r.query)),
    createBrand: handle((o,r) => service.createBrand(o,r.body), "mutation", true), createModel: handle((o,r) => service.createModel(o,r.body), "mutation", true),
    addBrandAlias: handle((o,r) => service.addAlias(o,r.params.id,"brand",r.body), "mutation"), addModelAlias: handle((o,r) => service.addAlias(o,r.params.id,"model",r.body), "mutation"),
    list: handle((o,r) => service.list(o,r.params.id,r.query)), events: handle((o,r) => service.events(o,r.params.id,r.query)),
    add: handle((o,r) => service.add(o,r.params.id,r.body), "mutation", true), update: handle((o,r) => service.update(o,r.params.id,r.params.compatibilityId,r.body), "mutation"),
  };
}
