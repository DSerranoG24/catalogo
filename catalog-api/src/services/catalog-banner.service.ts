import { randomUUID } from "node:crypto";
import { listBanners, saveBanner, removeBanner, reorderBanners, featuredStatus } from "../repositories/catalog-banner.repository";
import { findCatalogById } from "../repositories/catalog.repository";
import { uploadProductImage, deleteProductImageFile, createProductImageSignedUrl } from "./storage.service";
import type { BannerInput } from "../schemas/catalog-banner.schema";

type BannerDependencies = {
  list: typeof listBanners; save: typeof saveBanner; remove: typeof removeBanner; reorder: typeof reorderBanners; featured: typeof featuredStatus;
  owner: (catalogId: string, userId: string) => Promise<{ id: string } | null>;
  upload: (buffer: Buffer, path: string, mime: string) => Promise<unknown>;
  deleteImage: (path: string) => Promise<unknown>;
  sign: (path: string) => Promise<string>;
};
export function makeBannerService(deps: BannerDependencies = {
  list: listBanners, save: saveBanner, remove: removeBanner, reorder: reorderBanners, featured: featuredStatus,
  owner: findCatalogById, upload: uploadProductImage, deleteImage: deleteProductImageFile, sign: createProductImageSignedUrl,
}) {
  // Storage cleanup failures cannot turn a committed write into an apparent failure.
  async function cleanup(path: string) {
    try { await deps.deleteImage(path); }
    catch { console.error(JSON.stringify({ event: "banner_cleanup_failed", reason: "STORAGE_REMOVE_FAILED" })); }
  }
  return {
    async list(catalogId: string, userId: string) {
      const banners = await deps.list(catalogId, userId);
      return Promise.all(banners.map(async banner => ({ ...banner, imageUrl: await deps.sign(banner.imagePath) })));
    },
    async save(catalogId: string, userId: string, id: string | undefined, input: Partial<BannerInput>, file?: { buffer: Buffer; mimetype: string }) {
      if (!await deps.owner(catalogId, userId)) throw new Error("CATALOG_NOT_FOUND");
      let path: string | undefined;
      if (file) {
        const extension = file.mimetype === "image/jpeg" ? "jpg" : file.mimetype === "image/png" ? "png" : "webp";
        path = `${catalogId}/banners/${randomUUID()}.${extension}`;
        await deps.upload(file.buffer, path, file.mimetype);
      }
      let result: Awaited<ReturnType<typeof saveBanner>>;
      try { result = await deps.save(catalogId, userId, id, input, path); }
      catch (error) { if (path) await cleanup(path); throw error; }
      if (path && result.previousPath && path !== result.previousPath) await cleanup(result.previousPath);
      return result.banner;
    },
    async remove(catalogId: string, userId: string, id: string) {
      await cleanup(await deps.remove(catalogId, userId, id));
    },
    reorder: deps.reorder,
    featured: deps.featured,
  };
}
export type BannerService = ReturnType<typeof makeBannerService>;
