import { useSyncExternalStore } from "react";

export type Session = {
  user: {
    id: string;
    email: string;
    name: string | null;
  };
};

export type Catalog = {
  id: string;
  publicId: string;
  name: string;
  slug: string;
  description: string | null;
  whatsappPhone: string | null;
  phone: string | null;
  address: string | null;
  businessHours: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  tiktokUrl: string | null;
  email: string | null;
  mapUrl: string | null;
  template: "EDITORIAL" | "GRID" | "BOUTIQUE";
  active: boolean;
};

export type OrderStatus = "PENDING" | "CONFIRMED" | "COMPLETED" | "CANCELLED";

export type Category = {
  id: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  position: number;
};

export type ProductReview = {
  id: string;
  displayName: string | null;
  rating: number;
  comment: string;
  status: "PENDING" | "APPROVED" | "REJECTED";
  createdAt: string;
  product: { id: string; name: string };
};

export type PublicProductReview = Pick<ProductReview, "id" | "displayName" | "rating" | "comment" | "createdAt">;

export type ProductImage = {
  id: string;
  url: string;
  alt: string | null;
};

export type Product = {
  id: string;
  catalogId: string;
  categoryId: string | null;
  name: string;
  slug: string;
  description: string | null;
  sku: string | null;
  price: number;
  salePrice: number | null;
  saleStartsAt: string | null;
  saleEndsAt: string | null;
  stock: number;
  active: boolean;
  category: Category | null;
  images: ProductImage[];
};

export type PublicProduct = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  brand: string | null;
  model: string | null;
  categoryId: string | null;
  category: Pick<Category, "id" | "name"> | null;
  price: number;
  regularPrice: number | null;
  discountPercent: number | null;
  saleEndsAt: string | null;
  images: ProductImage[];
};

export type PublicCatalog = Pick<
  Catalog,
  | "publicId"
  | "name"
  | "slug"
  | "description"
  | "whatsappPhone"
  | "phone"
  | "address"
  | "businessHours"
  | "instagramUrl"
  | "facebookUrl"
  | "tiktokUrl"
  | "email"
  | "mapUrl"
  | "template"
> & {
  categories: Category[];
  products: PublicProduct[];
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function slugify(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

export function getSession(): Session | null {
  if (typeof window === "undefined") return null;

  const storedSession = window.localStorage.getItem("catalogo-session");
  if (!storedSession) return null;
  const session = parseSession(storedSession);
  if (!session) {
    window.localStorage.removeItem("catalogo-session");
  }
  return session;
}

function parseSession(value: string): Session | null {
  try {
    const parsed: unknown = JSON.parse(value);
    if (typeof parsed !== "object" || parsed === null || "token" in parsed) return null;
    const user = "user" in parsed ? parsed.user : null;
    if (typeof user !== "object" || user === null) return null;
    if (
      !("id" in user) || typeof user.id !== "string" ||
      !("email" in user) || typeof user.email !== "string" ||
      !("name" in user) || (typeof user.name !== "string" && user.name !== null)
    ) return null;
    return { user: { id: user.id, email: user.email, name: user.name } };
  } catch {
    return null;
  }
}

function subscribeToSession(onChange: () => void) {
  if (typeof window === "undefined") return () => undefined;
  window.addEventListener("storage", onChange);
  window.addEventListener("catalogo-session-change", onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener("catalogo-session-change", onChange);
  };
}

function getStoredSession() {
  return typeof window === "undefined"
    ? null
    : window.localStorage.getItem("catalogo-session");
}

export function useStoredSession(): Session | null {
  const storedSession = useSyncExternalStore(
    subscribeToSession,
    getStoredSession,
    () => null
  );
  return storedSession ? parseSession(storedSession) : null;
}

export function saveSession(session: Session) {
  window.localStorage.setItem("catalogo-session", JSON.stringify({ user: session.user }));
  window.dispatchEvent(new Event("catalogo-session-change"));
}

export function clearSession() {
  window.localStorage.removeItem("catalogo-session");
  void fetch("/api/backend/auth/logout", { method: "POST", credentials: "same-origin" });
  window.dispatchEvent(new Event("catalogo-session-change"));
}

export async function apiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const headers = new Headers(options.headers);

  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`/api/backend${path}`, {
      ...options,
      headers,
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new Error("No se pudo conectar con la API. Comprueba que esté iniciada.");
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(
      payload?.message ?? "La solicitud no pudo completarse.",
      response.status
    );
  }

  return payload as T;
}

export async function publicApiRequest<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const baseUrl = process.env.NEXT_PUBLIC_CATALOG_API_URL ?? "http://localhost:3000/api";
  const parsedBaseUrl = new URL(baseUrl);
  if (process.env.NODE_ENV === "production" && parsedBaseUrl.protocol !== "https:") {
    throw new Error("La API pública requiere una URL HTTPS.");
  }

  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData)) {
    headers.set("Content-Type", "application/json");
  }

  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}`, {
      ...options,
      headers,
      credentials: "omit",
      cache: "no-store",
    });
  } catch {
    throw new Error("No se pudo conectar con el servicio del catálogo.");
  }

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new ApiError(payload?.message ?? "La solicitud no pudo completarse.", response.status);
  }
  return payload as T;
}