import express from "express";
import cors from "cors";
import helmet from "helmet";
import healthRoutes from "./routes/health.routes";
import authRoutes from "./routes/auth.routes";
import meRoutes from "./routes/me.routes";
import catalogRoutes from "./routes/catalog.routes";
import categoryRoutes from "./routes/category.routes";
import productRoutes from "./routes/product.routes";
import productImageRoutes from "./routes/product-image.routes";
import publicCatalogRoutes from "./routes/public-catalog.routes";
import orderRoutes from "./routes/order.routes";
import productReviewRoutes from "./routes/product-review.routes";
import { apiErrorHandler, routeNotFound } from "./middlewares/error.middleware";
import { rateLimit } from "express-rate-limit";

const app = express();
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { success: false, error: "RATE_LIMITED", message: "Demasiadas solicitudes. Intenta más tarde." },
});

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS ?? "http://localhost:3000,http://localhost:3001")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean)
);

app.use(helmet());

app.use(
  cors({
    origin(origin, callback) {
      callback(null, !origin || allowedOrigins.has(origin));
    },
    credentials: false,
  })
);

app.use("/api", apiLimiter);
app.use(express.json({ limit: "32kb" }));
app.use(express.urlencoded({ extended: true, limit: "32kb" }));

app.get("/", (_req, res) => {
  res.send("CATALOG API");
});

app.use("/api/health", healthRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/me", meRoutes);
app.use("/api/catalogs", catalogRoutes);
app.use("/api/categories", categoryRoutes);
app.use("/api/products", productRoutes);
app.use("/api/product-images", productImageRoutes);
app.use("/api/public/catalogs", publicCatalogRoutes);
app.use("/api/orders", orderRoutes);
app.use("/api/reviews", productReviewRoutes);

app.use(routeNotFound);
app.use(apiErrorHandler);

export default app;