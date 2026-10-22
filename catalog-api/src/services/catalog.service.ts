import {
  createCatalog,
  findCatalogsByUser,
  findCatalogById,
  updateCatalog,
  deleteCatalog,
} from "../repositories/catalog.repository";
import { randomUUID } from "node:crypto";
import { createProductImageSignedUrl, deleteProductImageFile, uploadProductImage } from "./storage.service";

type CatalogTemplate = "EDITORIAL" | "GRID" | "BOUTIQUE" | "TECH" | "FASHION" | "BEAUTY";
type PersistedCatalogTemplate = "EDITORIAL" | "GRID" | "BOUTIQUE";

function toPersistedTemplate(template?: CatalogTemplate): PersistedCatalogTemplate | undefined {
  if (!template) return undefined;
  if (template === "TECH") return "GRID";
  if (template === "FASHION") return "EDITORIAL";
  if (template === "BEAUTY") return "BOUTIQUE";
  return template;
}

export async function createCatalogService(data: {
  userId: string;
  name: string;
  slug: string;
  description?: string | null;
  whatsappMessage?: string | null;
  whatsappPhone?: string;
  phone?: string;
  address?: string;
  businessHours?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  tiktokUrl?: string;
  email?: string;
  mapUrl?: string;
  template?: "EDITORIAL" | "GRID" | "BOUTIQUE" | "TECH" | "FASHION" | "BEAUTY";
}) {
  return createCatalog({ ...data, template: toPersistedTemplate(data.template) });
}

export async function getCatalogsService(userId: string) {
  return findCatalogsByUser(userId);
}

export async function getCatalogService(
  id: string,
  userId: string
) {
  return findCatalogById(id, userId);
}

export async function updateCatalogService(
  id: string,
  userId: string,
  data: {
    name?: string;
    slug?: string;
    description?: string | null;
    whatsappMessage?: string | null;
    logoUrl?: string | null;
    active?: boolean;
    whatsappPhone?: string | null;
    phone?: string | null;
    address?: string | null;
    businessHours?: string | null;
    instagramUrl?: string | null;
    facebookUrl?: string | null;
    tiktokUrl?: string | null;
    email?: string | null;
    mapUrl?: string | null;
    template?: "EDITORIAL" | "GRID" | "BOUTIQUE" | "TECH" | "FASHION" | "BEAUTY";
  }
) {
  return updateCatalog(id, userId, { ...data, template: toPersistedTemplate(data.template) });
}

export async function uploadCatalogLogoService(id: string, userId: string, file: { buffer: Buffer; mimetype: string }) {
  const catalog = await findCatalogById(id, userId);
  if (!catalog) throw new Error("CATALOG_NOT_FOUND");
  const extension = file.mimetype === "image/jpeg" ? "jpg" : file.mimetype.split("/")[1];
  const path = `${id}/branding/${randomUUID()}.${extension}`;
  const uploaded = await uploadProductImage(file.buffer, path, file.mimetype);
  let result: Awaited<ReturnType<typeof updateCatalog>>;
  try {
    result = await updateCatalog(id, userId, { logoUrl: uploaded.path });
  } catch (error) {
    await deleteProductImageFile(uploaded.path);
    throw error;
  }
  if (!result.count) {
    await deleteProductImageFile(uploaded.path);
    throw new Error("CATALOG_NOT_FOUND");
  }
  if (catalog.logoUrl) await deleteProductImageFile(catalog.logoUrl);
  return createProductImageSignedUrl(uploaded.path);
}

export async function deleteCatalogLogoService(id: string, userId: string) {
  const catalog = await findCatalogById(id, userId);
  if (!catalog) throw new Error("CATALOG_NOT_FOUND");
  if (!catalog.logoUrl) return;
  const result = await updateCatalog(id, userId, { logoUrl: null });
  if (!result.count) throw new Error("CATALOG_NOT_FOUND");
  await deleteProductImageFile(catalog.logoUrl);
}

export async function signCatalogLogo<T extends { logoUrl: string | null }>(catalog: T) {
  return { ...catalog, logoUrl: catalog.logoUrl ? await createProductImageSignedUrl(catalog.logoUrl) : null };
}

export async function deleteCatalogService(
  id: string,
  userId: string
) {
  return deleteCatalog(id, userId);
}

