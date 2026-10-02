import { supabase } from "../config/supabase";

const BUCKET_NAME = "product-images";

export async function uploadProductImage(
  fileBuffer: Buffer,
  filePath: string,
  contentType: string
) {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(filePath, fileBuffer, {
      contentType,
      upsert: false,
    });

  if (error) {
    throw error;
  }

  return data;
}

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