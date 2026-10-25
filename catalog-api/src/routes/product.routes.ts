import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import { makeProductListingRouter } from "./product-list.routes";
import { makeProductListingService } from "../services/product-list.service";
import { createProductImageSignedUrl } from "../services/storage.service";
import {
  createProductController,
  getProductsController,
  getProductController,
  updateProductController,
  deleteProductController,
} from "../controllers/product.controller";

const router = Router();

router.use(authenticate);
router.use("/catalog/:catalogId", makeProductListingRouter(makeProductListingService(createProductImageSignedUrl)));

router.post("/catalog/:catalogId", createProductController);
router.get("/catalog/:catalogId", getProductsController);

router.get("/:id", getProductController);
router.put("/:id", updateProductController);
router.delete("/:id", deleteProductController);

export default router;
