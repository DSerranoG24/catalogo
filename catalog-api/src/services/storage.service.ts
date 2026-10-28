import { supabase } from "../config/supabase";
import { prisma } from "../config/prisma";
import type { ClosureStorage } from "./account-closure-worker";

const BUCKET_NAME = "product-images";

export async function uploadProductImage(
  fileBuffer: Buffer,
  filePath: string,
  contentType: string
) {
  // Closure waits for uploads already in flight before persisting its scan frontier.
  const catalogId = filePath.split("/")[0];
  let uploadedPath: string | undefined;
  try {
    return await prisma.$transaction(async tx => {
      const catalogs = await tx.$queryRaw<{ userId: string }[]>`SELECT "userId" FROM catalogs WHERE id = ${catalogId} FOR SHARE`;
      const catalog = catalogs[0];
      if (!catalog || await tx.accountClosureJob.findUnique({ where: { userId: catalog.userId }, select: { id: true } })) throw new Error("ACCOUNT_CLOSED");
      const { data, error } = await supabase.storage.from(BUCKET_NAME).upload(filePath, fileBuffer, { contentType, upsert: false });
      if (error) throw error;
      uploadedPath = data.path;
      return data;
    }, { timeout: 25000 });
  } catch (error) {
    if (uploadedPath) {
      // A failed lock/commit must not leak the object just uploaded by this attempt.
      try { await deleteProductImageFile(uploadedPath); } catch { /* Closure reconciliation also scans orphan objects. */ }
    }
    throw error;
  }
}

export const closureStorage: ClosureStorage = {
  async list(prefix, offset) {
    const { data, error } = await supabase.storage.from(BUCKET_NAME).list(prefix, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw new Error("STORAGE_LIST_FAILED");
    return data.map(entry => ({ name: entry.name, folder: entry.id === null }));
  },
  async remove(paths) {
    const { error } = await supabase.storage.from(BUCKET_NAME).remove(paths);
    if (error) throw new Error("STORAGE_REMOVE_FAILED");
  },
};

export async function createProductImageSignedUrl(
  filePath: string,
  expiresIn = 3600
) {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(filePath, expiresIn);

  if (error) {
    throw error;
  }

  return data.signedUrl;
}

export async function deleteProductImageFile(filePath: string) {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .remove([filePath]);

  if (error) {
    throw error;
  }

  return data;
}
