import { Router } from "express";
import multer from "multer";
import { rateLimit } from "express-rate-limit";
import { z } from "zod";
import type { AuthenticatedRequest } from "../types/auth.types";
import { completePhotoInput, photoItemInput } from "../schemas/product-photo.schema";
import type { PhotoService } from "../services/product-photo.service";

export function makePhotoRouter(service: PhotoService) {
  const router = Router({ mergeParams: true });
  const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 2, fieldSize: 4096, parts: 3 } }).single("image");
  const busy = new Set<string>(); let active = 0;
  const work = new WeakMap<import("express").Response, (working: boolean) => void>();
  router.use((req: AuthenticatedRequest, res, next) => {
    res.set("Cache-Control", "private, no-store");
    if (!req.user) return res.sendStatus(401);
    if (!z.string().uuid().safeParse(req.params.catalogId).success) return res.sendStatus(400);
    return next();
  });
  router.use(rateLimit({ windowMs: 15 * 60_000, limit: 90, standardHeaders: "draft-8", legacyHeaders: false,
    keyGenerator: (req: AuthenticatedRequest) => req.user?.id ?? "anonymous", message: { success: false, message: "Demasiadas cargas. Intenta más tarde." } }));
  router.use((req: AuthenticatedRequest, res, next) => {
    const userId = req.user?.id;
    if (!userId || busy.has(userId) || active >= 4) return res.status(429).set("Retry-After", "2").json({ success: false, message: "Hay una carga en curso. Espera antes de continuar." });
    busy.add(userId); active++;
    let released = false; let working = false;
    const release = () => { if (!released && !working) { released = true; busy.delete(userId); active--; } };
    work.set(res, (value: boolean) => { working = value; if (!value && (res.destroyed || res.writableEnded)) release(); });
    res.once("finish", release); res.once("close", release); next();
  });
  router.get("/pending", async (req: AuthenticatedRequest, res) => {
    if (!req.user) return res.sendStatus(401);
    try {
      const { page } = z.object({ page: z.string().regex(/^[1-9]\d*$/).transform(Number).pipe(z.number().int().max(1000000)).default(1) }).strict().parse(req.query);
      return res.json({ success: true, ...await service.pending(String(req.params.catalogId), req.user.id, page) });
    } catch (error) { return fail(error, res); }
  });
  function fail(error: unknown, res: import("express").Response) {
    const code = error instanceof Error ? error.message : "PHOTO_FAILED";
    const status = code === "CATALOG_NOT_FOUND" || code === "PRODUCT_NOT_FOUND" ? 404 : error instanceof z.ZodError || code.startsWith("INVALID_") ? 400 : code === "CATALOG_ARCHIVED" ? 409 : 503;
    return res.status(status).json({ success: false, message: status === 404 ? "Recurso no encontrado." : status === 400 ? "Revisa la imagen, el plan y los datos enviados." : status === 409 ? "El catálogo está archivado." : "No se pudo guardar la foto. Actualiza el listado antes de volver a intentarlo." });
  }
  router.post("/plan", async (req: AuthenticatedRequest, res) => {
    if (!req.user) return res.sendStatus(401);
    try { return res.json({ success: true, ...await service.plan(String(req.params.catalogId), req.user.id, req.body) }); }
    catch (error) { return fail(error, res); }
  });
  router.post("/item", upload, async (req: AuthenticatedRequest, res) => {
    if (!req.user || !req.file) return res.status(400).json({ message: "Selecciona una imagen." });
    try {
      const { token, index } = photoItemInput.parse(req.body);
      work.get(res)?.(true);
      return res.status(201).json({ success: true, product: await service.upload(String(req.params.catalogId), req.user.id, token, index, req.file) });
    } catch (error) { return fail(error, res); }
    finally { work.get(res)?.(false); }
  });
  return router;
}

export function makeCompletePhotoHandler(service: PhotoService): import("express").RequestHandler {
  return async (req: AuthenticatedRequest, res) => {
    res.set("Cache-Control", "private, no-store");
    if (!req.user) return res.sendStatus(401);
    try {
      const id = z.string().uuid().parse(req.params.id);
      const input = completePhotoInput.parse(req.body);
      return res.json({ success: true, product: await service.complete(id, req.user.id, input) });
    } catch (error) {
      const missing = error instanceof Error && error.message === "PRODUCT_NOT_FOUND";
      return res.status(missing ? 404 : 400).json({ success: false, message: missing ? "Producto no encontrado." : "Revisa los datos. El producto debe seguir pendiente y pertenecer a un catálogo disponible." });
    }
  };
}
