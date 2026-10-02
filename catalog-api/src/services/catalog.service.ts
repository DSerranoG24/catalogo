import {
  createCatalog,
  findCatalogsByUser,
  findCatalogById,
  updateCatalog,
  deleteCatalog,
} from "../repositories/catalog.repository";

export async function createCatalogService(data: {
  userId: string;
  name: string;
  slug: string;
  description?: string | null;
  whatsappPhone?: string;
  phone?: string;
  address?: string;
  businessHours?: string;
  instagramUrl?: string;
  facebookUrl?: string;
  tiktokUrl?: string;
  email?: string;
  mapUrl?: string;
  template?: "EDITORIAL" | "GRID" | "BOUTIQUE";
}) {
  return createCatalog(data);
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
    template?: "EDITORIAL" | "GRID" | "BOUTIQUE";
  }
) {
  return updateCatalog(id, userId, data);
}

export async function deleteCatalogService(
  id: string,
  userId: string
) {
  return deleteCatalog(id, userId);
}

