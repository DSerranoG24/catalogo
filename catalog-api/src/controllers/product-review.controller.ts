import { Request, Response } from "express";
import { ReviewStatus } from "@prisma/client";
import { z } from "zod";
import { AuthenticatedRequest } from "../types/auth.types";
import { createProductReviewSchema, moderateProductReviewSchema } from "../schemas/product-review.schema";
import {
  getPublicProductReviews,
  getReviewsForCatalog,
  removeProductReview,
  setProductReviewStatus,
  submitProductReview,
} from "../services/product-review.service";

export async function getPublicProductReviewsController(req: Request, res: Response) {
  try {
    const result = await getPublicProductReviews(req.params.publicId as string, req.params.productSlug as string);
    if (!result) return res.status(404).json({ success: false, message: "Producto no encontrado" });
    return res.json({ success: true, ...result });
  } catch {
    return res.status(500).json({ success: false, message: "No se pudieron cargar las reseñas" });
  }
}

export async function createPublicProductReviewController(req: Request, res: Response) {
  const parsed = createProductReviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Revisa la calificación y el comentario" });

  try {
    await submitProductReview({
      publicId: req.params.publicId as string,
      productSlug: req.params.productSlug as string,
      ...parsed.data,
    });
    return res.status(201).json({ success: true, message: "La reseña quedó pendiente de aprobación." });
  } catch (error) {
    if (error instanceof Error && error.message === "PRODUCT_NOT_FOUND") {
      return res.status(404).json({ success: false, message: "Producto no encontrado" });
    }
    return res.status(500).json({ success: false, message: "No se pudo enviar la reseña" });
  }
}

export async function getCatalogReviewsController(req: AuthenticatedRequest, res: Response) {
  const statusResult = req.query.status === undefined
    ? null
    : z.enum(["PENDING", "APPROVED", "REJECTED"]).safeParse(req.query.status);
  if (statusResult && !statusResult.success) {
    return res.status(400).json({ success: false, message: "Estado de reseña inválido" });
  }

  try {
    const reviews = await getReviewsForCatalog(
      req.params.catalogId as string,
      req.user!.id,
      (statusResult?.data as ReviewStatus | undefined) ?? undefined
    );
    return res.json({ success: true, reviews });
  } catch {
    return res.status(500).json({ success: false, message: "No se pudieron cargar las reseñas" });
  }
}

export async function moderateProductReviewController(req: AuthenticatedRequest, res: Response) {
  const parsed = moderateProductReviewSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ success: false, message: "Estado de moderación inválido" });
  const result = await setProductReviewStatus(req.params.id as string, req.user!.id, parsed.data.status as ReviewStatus);
  if (result.count === 0) return res.status(404).json({ success: false, message: "Reseña no encontrada" });
  return res.json({ success: true });
}

export async function deleteProductReviewController(req: AuthenticatedRequest, res: Response) {
  const result = await removeProductReview(req.params.id as string, req.user!.id);
  if (result.count === 0) return res.status(404).json({ success: false, message: "Reseña no encontrada" });
  return res.json({ success: true });
}