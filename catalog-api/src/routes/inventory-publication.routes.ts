import express, { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import type { AuthenticatedRequest } from "../types/auth.types";
import { makeInventoryPublicationService } from "../services/inventory-publication.service";
import { createInventoryPublicationSchema, updateInventoryPublicationSchema } from "../schemas/inventory-publication.schema";
import { upload, validateImageContent } from "../middlewares/upload.middleware";

export function makeInventoryPublicationRouter() {
  const router = Router(); const service = makeInventoryPublicationService();
  const wrap = (fn: (userId: string, request: AuthenticatedRequest) => Promise<unknown>) => async (req: AuthenticatedRequest, res: any) => {
    if (!req.user) return res.sendStatus(401);
    try { return res.json({ result: await fn(req.user.id, req) }); }
    catch (error) { const code = error instanceof Error ? error.message : "UNKNOWN"; return res.status(code === "NOT_FOUND" ? 404 : code === "VERSION_CONFLICT" || code === "IMAGE_IN_USE" ? 409 : 400).json({ message: code }); }
  };
  router.get("/publications", authenticate, wrap((userId, req) => service.publications(userId, { inventoryItemId: typeof req.query.inventoryItemId === "string" ? req.query.inventoryItemId : undefined, catalogId: typeof req.query.catalogId === "string" ? req.query.catalogId : undefined })));
  router.get("/items/:id/images", authenticate, wrap((userId, req) => service.images(userId, String(req.params.id))));
  router.post("/items/:id/images", authenticate, upload.single("image"), validateImageContent, wrap((userId, req) => { if (!req.file) throw new Error("IMAGE_REQUIRED"); return service.uploadImage(userId, String(req.params.id), req.file, { alt: typeof req.body?.alt === "string" ? req.body.alt : null, position: Number.isInteger(Number(req.body?.position)) ? Number(req.body.position) : 0, isPrimary: req.body?.isPrimary === "true" }); }));
  router.patch("/images/:id/primary", authenticate, wrap((userId, req) => service.setPrimaryImage(userId, String(req.params.id))));
  router.delete("/images/:id", authenticate, wrap((userId, req) => service.deleteImage(userId, String(req.params.id))));
  router.post("/publications", authenticate, express.json({ limit: "32kb" }), wrap((userId, req) => service.publish(userId, createInventoryPublicationSchema.parse(req.body))));
  router.patch("/publications/:id", authenticate, express.json({ limit: "32kb" }), wrap((userId, req) => service.update(userId, String(req.params.id), updateInventoryPublicationSchema.parse(req.body))));
  return router;
}
