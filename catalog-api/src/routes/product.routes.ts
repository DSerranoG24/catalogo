import { Router } from "express";
import { makeProductBulkRouter } from "./product-bulk.routes";
import { authenticate } from "../middlewares/auth.middleware";
import { makeProductListingRouter } from "./product-list.routes";
import { makeProductListingService } from "../services/product-list.service";
import { createProductImageSignedUrl, uploadProductImage, deleteProductImageFile } from "../services/storage.service";
import { makePhotoService } from "../services/product-photo.service";
import { photoStore } from "../repositories/product-photo.repository";
import { makePhotoRouter, makeCompletePhotoHandler } from "./product-photo.routes";
import { getJwtSecret } from "../utils/jwt";
import {
  createProductController,
  getProductsController,
  getProductController,
  updateProductController,
  deleteProductController,
} from "../controllers/product.controller";

const router = Router();

router.use("/catalog/:catalogId/bulk", makeProductBulkRouter());
router.use(authenticate);
const photos = makePhotoService({ store: photoStore(), secret: getJwtSecret, upload: uploadProductImage, remove: deleteProductImageFile, sign: createProductImageSignedUrl,
  cleanupFailed: () => console.error(JSON.stringify({ event: "photo_cleanup_failed", reason: "STORAGE_REMOVE_FAILED" })) });
router.use("/catalog/:catalogId/photos", makePhotoRouter(photos));
router.use("/catalog/:catalogId", makeProductListingRouter(makeProductListingService(createProductImageSignedUrl)));

router.post("/catalog/:catalogId", createProductController);
router.get("/catalog/:catalogId", getProductsController);

router.get("/:id", getProductController);
router.put("/:id/complete", makeCompletePhotoHandler(photos));
router.put("/:id", updateProductController);
router.delete("/:id", deleteProductController);

export default router;
