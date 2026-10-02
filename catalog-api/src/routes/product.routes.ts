import { Router } from "express";
import { authenticate } from "../middlewares/auth.middleware";
import {
  createProductController,
  getProductsController,
  getProductController,
  updateProductController,
  deleteProductController,
} from "../controllers/product.controller";

const router = Router();

router.use(authenticate);

router.post("/catalog/:catalogId", createProductController);
router.get("/catalog/:catalogId", getProductsController);

router.get("/:id", getProductController);
router.put("/:id", updateProductController);
router.delete("/:id", deleteProductController);

export default router;