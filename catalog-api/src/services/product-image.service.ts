import {
  createProductImage,
  findImagesByProduct,
  findProductImageById,
  deleteProductImage,
} from "../repositories/product-image.repository";

import {
  uploadProductImage,
  createProductImageSignedUrl,
  deleteProductImageFile,
} from "./storage.service";

import { findProductById } from "../repositories/product.repository";

export async function uploadProductImageService(
  productId: string,
  userId: string,
  file: {
    buffer: Buffer;
    mimetype: string;
  },
  position = 0,
  alt?: string
) {
  const product = await findProductById(productId, userId);

  if (!product) {
    throw new Error("PRODUCT_NOT_FOUND");
  }

  const extension = file.mimetype.split("/")[1];

  const filePath = `${product.catalogId}/${productId}/${crypto.randomUUID()}.${extension}`;

  const uploadedFile = await uploadProductImage(
    file.buffer,
    filePath,
    file.mimetype
  );

  const image = await createProductImage({
    productId,
    url: uploadedFile.path,
    position,
    alt,
  });

  return image;
}

export async function getProductImagesService(
  productId: string,
  userId: string
) {
  const product = await findProductById(productId, userId);

  if (!product) {
    throw new Error("PRODUCT_NOT_FOUND");
  }

  const images = await findImagesByProduct(productId);

  return Promise.all(
    images.map(async (image) => ({
      ...image,
      url: await createProductImageSignedUrl(image.url),
    }))
  );
}

export async function getProductImageService(
  id: string,
  userId: string
) {
  return findProductImageById(id, userId);
}

export async function deleteProductImageService(
  id: string,
  userId: string
) {
  const image = await findProductImageById(id, userId);

  if (!image) {
    return { count: 0 };
  }

  await deleteProductImageFile(image.url);

  return deleteProductImage(id, userId);
}