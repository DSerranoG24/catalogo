import { Router, type Response, type NextFunction, type Request } from "express";
import { z, ZodError } from "zod";
import { MulterError } from "multer";
import type { AuthenticatedRequest } from "../types/auth.types";
import { upload, validateImageContent, validateBannerDimensions } from "../middlewares/upload.middleware";
import { createBannerSchema, updateBannerSchema, bannerOrderSchema } from "../schemas/catalog-banner.schema";
import type { BannerService } from "../services/catalog-banner.service";

function multipartBody(body: unknown, multipart: boolean) {
  if (!multipart || typeof body !== "object" || body === null) return body;
  const data = { ...body };
  if ("position" in data && typeof data.position === "string" && /^[0-2]$/.test(data.position)) data.position = Number(data.position);
  if ("active" in data && (data.active === "true" || data.active === "false")) data.active = data.active === "true";
  if ("subtitle" in data && data.subtitle === "") data.subtitle = null;
  return data;
}

export function makeBannerRouter(service: BannerService) {
  const router = Router({ mergeParams: true });
  router.use((req: AuthenticatedRequest, res, next) => {
    if (!req.user) return res.status(401).json({ success: false, message: "Inicia sesión." });
    if (!z.string().uuid().safeParse(req.params.id).success || (req.params.bannerId && !z.string().uuid().safeParse(req.params.bannerId).success)) return res.status(400).json({ success: false, message: "Identificador inválido." });
    next();
  });
  const handle = (work: (req: AuthenticatedRequest, res: Response, userId: string, catalogId: string) => Promise<unknown>) => async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) return next(new Error("UNAUTHORIZED"));
    try { await work(req, res, req.user.id, z.string().uuid().parse(req.params.id)); }
    catch (error) { next(error); }
  };
  router.get("/", handle(async (_req, res, userId, catalogId) => res.json({ success: true, banners: await service.list(catalogId, userId) })));
  router.put("/order", handle(async (req, res, userId, catalogId) => res.json({ success: true, result: await service.reorder(catalogId, userId, bannerOrderSchema.parse(req.body).ids) })));
  router.post("/", upload.single("image"), validateImageContent, validateBannerDimensions, handle(async (req, res, userId, catalogId) => {
    if (!req.file) throw new Error("BANNER_IMAGE_REQUIRED");
    const data = createBannerSchema.parse(multipartBody(req.body, Boolean(req.is("multipart/form-data"))));
    return res.status(201).json({ success: true, banner: await service.save(catalogId, userId, undefined, data, req.file) });
  }));
  router.put("/:bannerId", upload.single("image"), validateImageContent, validateBannerDimensions, handle(async (req, res, userId, catalogId) => {
    const id = z.string().uuid().parse(req.params.bannerId);
    const data = updateBannerSchema.parse(multipartBody(req.body, Boolean(req.is("multipart/form-data"))));
    return res.json({ success: true, banner: await service.save(catalogId, userId, id, data, req.file) });
  }));
  router.delete("/:bannerId", handle(async (req, res, userId, catalogId) => {
    await service.remove(catalogId, userId, z.string().uuid().parse(req.params.bannerId));
    return res.json({ success: true });
  }));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const code = error instanceof Error ? error.message : "";
    const messages: Record<string, string> = {
      CATALOG_NOT_FOUND: "Catálogo no encontrado.", BANNER_NOT_FOUND: "Banner no encontrado.",
      BANNER_LIMIT: "Solo puedes guardar tres banners.", BANNER_POSITION_OCCUPIED: "La posición ya está ocupada.",
      BANNER_TARGET_INVALID: "El destino no está disponible en este catálogo.", BANNER_IMAGE_REQUIRED: "Selecciona una imagen.",
      BANNER_ORDER_INVALID: "Incluye todos los banners del catálogo una sola vez.",
      CATALOG_ARCHIVED: "Reactiva el catálogo antes de gestionar sus anuncios.",
    };
    const invalidUpload = error instanceof MulterError || (typeof error === "object" && error !== null && "code" in error && error.code === "INVALID_IMAGE_TYPE");
    const status = code.endsWith("NOT_FOUND") ? 404 : code === "BANNER_LIMIT" || code === "BANNER_POSITION_OCCUPIED" || code === "CATALOG_ARCHIVED" ? 409 : error instanceof ZodError || code in messages || invalidUpload ? 400 : 500;
    res.status(status).json({ success: false, message: messages[code] ?? (status === 400 ? "Revisa los datos y la imagen del banner (máximo 5 MiB)." : "No se pudo guardar el banner.") });
  });
  return router;
}
