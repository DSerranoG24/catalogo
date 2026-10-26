import {
  createCatalog,
  findCatalogsByUser,
  findCatalogById,
  updateCatalog,
  archiveCatalog,
  reactivateCatalog,
  countCatalogOrders,
  deleteCatalog,
} from "../repositories/catalog.repository";
import { randomUUID } from "node:crypto";
import { createProductImageSignedUrl, deleteProductImageFile, uploadProductImage } from "./storage.service";

type CatalogTemplate = string;

function toPersistedTemplate(template?: CatalogTemplate): string | undefined {
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
  nit?: string | null;
  quotationTerms?: string | null;
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
  template?: CatalogTemplate;
  themePreset?: string | null;
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
    nit?: string | null;
    quotationTerms?: string | null;
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
    template?: CatalogTemplate;
    themePreset?: string | null;
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

export async function archiveCatalogService(id: string, userId: string) {
  return archiveCatalog(id, userId);
}

export async function reactivateCatalogService(id: string, userId: string) {
  return reactivateCatalog(id, userId);
}

export async function getCatalogOrderCountService(id: string, userId: string) {
  const catalog = await findCatalogById(id, userId);
  if (!catalog) throw new Error("CATALOG_NOT_FOUND");
  return countCatalogOrders(id);
}

export async function deleteCatalogService(id: string, userId: string) {
  const catalog = await findCatalogById(id, userId);
  if (!catalog) throw new Error("CATALOG_NOT_FOUND");
  const orders = await countCatalogOrders(id);
  if (orders > 0) {
    throw new Error("CATALOG_HAS_ORDERS");
  }
  return deleteCatalog(id, userId);
}


