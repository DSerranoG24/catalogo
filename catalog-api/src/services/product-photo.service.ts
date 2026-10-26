import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { photoPlan, photoPlanInput, type CompletePhotoInput } from "../schemas/product-photo.schema";
import { detectImageMimeType } from "../utils/image-validation";

export type PhotoProduct = { id: string; name: string; needsCompletion: boolean; active: boolean };
export type PhotoDraft = PhotoProduct & { price: number; categoryId: string | null; description: string | null; images: { url: string }[] };
export type PhotoStore = {
  owner: (catalogId: string, userId: string) => Promise<{ archivedAt: Date | null } | null>;
  existing: (id: string, catalogId: string, userId: string) => Promise<(PhotoProduct & { imagePath?: string }) | null>;
  create: (data: { id: string; catalogId: string; userId: string; name: string; path: string }) => Promise<PhotoProduct>;
  complete: (id: string, userId: string, data: CompletePhotoInput) => Promise<PhotoProduct>;
  pending: (catalogId: string, userId: string, page: number) => Promise<{ products: PhotoDraft[]; count: number; page: number; pages: number }>;
};
export function photoName(filename: string) {
  const name = filename.split(/[\\/]/).pop()?.replace(/\.[^.]*$/, "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim() ?? "";
  const technical = /^(?:img|dsc|pxl|image|photo|foto|screenshot|whatsapp)\b/i.test(name)
    || /^[a-f0-9 ]{20,}$/i.test(name) || /\d{7,}/.test(name) || !/\p{L}/u.test(name);
  return !technical && name.length >= 3 ? name.slice(0, 150) : "Producto sin completar";
}
export function makePhotoService(deps: {
  store: PhotoStore; secret: () => string;
  upload: (buffer: Buffer, path: string, mime: string) => Promise<unknown>;
  remove: (path: string) => Promise<unknown>;
  cleanupFailed: () => void;
  sign: (path: string) => Promise<string>;
}) {
  const signature = (value: string) => createHmac("sha256", deps.secret()).update(value).digest();
  const receipt = ({ id, name, active, needsCompletion }: PhotoProduct): PhotoProduct => ({ id, name, active, needsCompletion });
  async function owned(catalogId: string, userId: string) {
    const catalog = await deps.store.owner(catalogId, userId);
    if (!catalog) throw new Error("CATALOG_NOT_FOUND");
    if (catalog.archivedAt) throw new Error("CATALOG_ARCHIVED");
  }
  return {
    async plan(catalogId: string, userId: string, input: unknown) {
      const { count } = photoPlanInput.parse(input);
      await owned(catalogId, userId);
      const body = Buffer.from(JSON.stringify({ purpose: "PRODUCT_PHOTOS", catalogId, userId,
        products: Array.from({ length: count }, () => randomUUID()), expiresAt: Date.now() + 30 * 60_000 })).toString("base64url");
      return { token: `${body}.${signature(body).toString("base64url")}`, count };
    },
    async upload(catalogId: string, userId: string, token: string, index: number, file: { buffer: Buffer; mimetype: string; originalname: string }) {
      const [body, encoded, extra] = token.split(".");
      if (!body || !encoded || extra) throw new Error("INVALID_PHOTO_PLAN");
      const supplied = Buffer.from(encoded, "base64url"); const expected = signature(body);
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new Error("INVALID_PHOTO_PLAN");
      let decoded: unknown;
      try { decoded = JSON.parse(Buffer.from(body, "base64url").toString()); } catch { throw new Error("INVALID_PHOTO_PLAN"); }
      const parsed = photoPlan.safeParse(decoded);
      if (!parsed.success || parsed.data.catalogId !== catalogId || parsed.data.userId !== userId || parsed.data.expiresAt < Date.now()) throw new Error("INVALID_PHOTO_PLAN");
      const id = Number.isInteger(index) && index >= 0 ? parsed.data.products[index] : undefined;
      if (!id) throw new Error("INVALID_PHOTO_PLAN");
      if (file.buffer.length > 2 * 1024 * 1024 || !file.buffer.length || !["image/jpeg", "image/png", "image/webp"].includes(file.mimetype)
        || detectImageMimeType(file.buffer) !== file.mimetype) throw new Error("INVALID_PHOTO_FILE");
      await owned(catalogId, userId);
      const existing = await deps.store.existing(id, catalogId, userId);
      if (existing) return receipt(existing);
      const path = `${catalogId}/${id}/${randomUUID()}.${file.mimetype === "image/jpeg" ? "jpg" : file.mimetype.split("/")[1]}`;
      await deps.upload(file.buffer, path, file.mimetype);
      try {
        return await deps.store.create({ id, catalogId, userId, name: photoName(file.originalname), path });
      } catch {
        // A commit response can be lost after the database accepted the image reference.
        // If this read fails too, retain the object for reconciliation rather than delete a possibly committed image.
        const winner = await deps.store.existing(id, catalogId, userId);
        if (winner?.imagePath === path) return receipt(winner);
        try { await deps.remove(path); } catch { deps.cleanupFailed(); }
        // A concurrent identical slot may have committed. Its object is a different path.
        if (winner) return receipt(winner);
        throw new Error("PHOTO_CREATE_FAILED");
      }
    },
    complete: deps.store.complete,
    async pending(catalogId: string, userId: string, page: number) {
      await owned(catalogId, userId);
      const result = await deps.store.pending(catalogId, userId, page);
      return { ...result, products: await Promise.all(result.products.map(async product => ({ ...product,
        images: await Promise.all(product.images.map(async image => ({ url: await deps.sign(image.url) }))) }))) };
    },
  };
}
export type PhotoService = ReturnType<typeof makePhotoService>;
