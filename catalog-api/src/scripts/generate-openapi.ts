import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { registerSchema, loginSchema } from "../schemas/auth.schema";
import { createCatalogSchema, updateCatalogSchema } from "../schemas/catalog.schema";
import { createCategorySchema, updateCategorySchema } from "../schemas/category.schema";
import { createProductSchema, updateProductSchema } from "../schemas/product.schema";
import { createPublicOrderSchema, updateOrderSchema } from "../schemas/order.schema";
import { createProductReviewSchema, moderateProductReviewSchema } from "../schemas/product-review.schema";

const schemas = {
  Register: registerSchema,
  Login: loginSchema,
  GoogleLogin: z.object({ idToken: z.string().min(1).max(10_000) }),
  CreateCatalog: createCatalogSchema,
  UpdateCatalog: updateCatalogSchema,
  CreateCategory: createCategorySchema,
  UpdateCategory: updateCategorySchema,
  CreateProduct: createProductSchema,
  UpdateProduct: updateProductSchema,
  CreatePublicOrder: createPublicOrderSchema,
  UpdateOrder: updateOrderSchema,
  CreateProductReview: createProductReviewSchema,
  ModerateProductReview: moderateProductReviewSchema,
} satisfies Record<string, z.ZodType>;

const ref = (name: keyof typeof schemas) => ({ $ref: `#/components/schemas/${name}` });
const jsonBody = (name: keyof typeof schemas) => ({
  required: true,
  content: { "application/json": { schema: ref(name) } },
});
const response = { description: "Respuesta de la API" };
const secured = [{ bearerAuth: [] }];
const operation = (summary: string, options: Record<string, unknown> = {}) => ({
  summary,
  responses: { "200": response, "400": { description: "Solicitud inválida" } },
  ...options,
});

const paths = {
  "/api/auth/google": { post: operation("Google sign-in", { requestBody: jsonBody("GoogleLogin") }) },
  "/api/me": { get: operation("Get authenticated user", { security: secured }) },
  "/api/health": { get: operation("Check API health") },
  "/api/auth/register": { post: operation("Registrar usuario", { requestBody: jsonBody("Register"), responses: { "201": response, "400": { description: "Datos inválidos" }, "409": { description: "Correo ya registrado" } } }) },
  "/api/auth/login": { post: operation("Iniciar sesión", { requestBody: jsonBody("Login"), responses: { "200": response, "400": { description: "Datos inválidos" }, "401": { description: "Credenciales inválidas" } } }) },
  "/api/catalogs": {
    get: operation("Listar catálogos del usuario", { security: secured }),
    post: operation("Crear catálogo", { security: secured, requestBody: jsonBody("CreateCatalog"), responses: { "201": response, "400": { description: "Datos inválidos" } } }),
  },
  "/api/catalogs/{id}": {
    get: operation("Obtener catálogo", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }] }),
    put: operation("Actualizar catálogo", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }], requestBody: jsonBody("UpdateCatalog") }),
    delete: operation("Eliminar catálogo", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }] }),
  },
  "/api/catalogs/{id}/logo": {
    post: operation("Upload catalog logo", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }], requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["image"], properties: { image: { type: "string", format: "binary" } } } } } } }),
    delete: operation("Delete catalog logo", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }] }),
  },
  "/api/categories/catalog/{catalogId}": {
    get: operation("Listar categorías", { security: secured, parameters: [{ $ref: "#/components/parameters/catalogId" }] }),
    post: operation("Crear categoría", { security: secured, parameters: [{ $ref: "#/components/parameters/catalogId" }], requestBody: jsonBody("CreateCategory") }),
  },
  "/api/categories/{id}": {
    get: operation("Get category", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }] }),
    put: operation("Update category", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }], requestBody: jsonBody("UpdateCategory") }),
    delete: operation("Delete category", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }] }),
  },
  "/api/categories/{id}/image": {
    post: operation("Upload category image", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }], requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["image"], properties: { image: { type: "string", format: "binary" } } } } } } }),
    delete: operation("Delete category image", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }] }),
  },
  "/api/products/catalog/{catalogId}": {
    get: operation("Listar productos", { security: secured, parameters: [{ $ref: "#/components/parameters/catalogId" }] }),
    post: operation("Crear producto", { security: secured, parameters: [{ $ref: "#/components/parameters/catalogId" }], requestBody: jsonBody("CreateProduct") }),
  },
  "/api/products/{id}": {
    get: operation("Obtener producto", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }] }),
    put: operation("Actualizar producto", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }], requestBody: jsonBody("UpdateProduct") }),
    delete: operation("Eliminar producto", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }] }),
  },
  "/api/product-images/product/{id}": {
    get: operation("List product images", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }] }),
    post: operation("Upload product image", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }], requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", required: ["image"], properties: { image: { type: "string", format: "binary" } } } } } } }),
  },
  "/api/product-images/{imageId}": {
    get: operation("Get product image", { security: secured, parameters: [{ $ref: "#/components/parameters/imageId" }] }),
    delete: operation("Delete product image", { security: secured, parameters: [{ $ref: "#/components/parameters/imageId" }] }),
  },
  "/api/orders/catalog/{catalogId}": { get: operation("Listar pedidos del catálogo", { security: secured, parameters: [{ $ref: "#/components/parameters/catalogId" }] }) },
  "/api/orders/{orderId}": { patch: operation("Actualizar estado del pedido", { security: secured, parameters: [{ $ref: "#/components/parameters/orderId" }], requestBody: jsonBody("UpdateOrder") }) },
  "/api/public/catalogs/{publicId}/orders": { post: operation("Crear pedido público", { parameters: [{ $ref: "#/components/parameters/publicId" }], requestBody: jsonBody("CreatePublicOrder"), responses: { "201": response, "400": { description: "Datos inválidos" } } }) },
  "/api/public/catalogs/{publicId}": { get: operation("Get public catalog", { parameters: [{ $ref: "#/components/parameters/publicId" }] }) },
  "/api/reviews/{id}": {
    patch: operation("Moderar reseña", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }], requestBody: jsonBody("ModerateProductReview") }),
    delete: operation("Eliminar reseña", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }] }),
  },
  "/api/reviews/catalog/{catalogId}": { get: operation("List catalog reviews", { security: secured, parameters: [{ $ref: "#/components/parameters/catalogId" }] }) },
  "/api/public/catalogs/{publicId}/products/{productSlug}/reviews": {
    get: operation("Listar reseñas públicas", { parameters: [{ $ref: "#/components/parameters/publicId" }, { $ref: "#/components/parameters/productSlug" }] }),
    post: operation("Crear reseña", { parameters: [{ $ref: "#/components/parameters/publicId" }, { $ref: "#/components/parameters/productSlug" }], requestBody: jsonBody("CreateProductReview"), responses: { "201": response, "400": { description: "Datos inválidos" } } }),
  },
};

const components = {
  securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" } },
  parameters: Object.fromEntries(["id", "catalogId", "orderId", "publicId", "productSlug", "imageId"].map((name) => [name, {
    name,
    in: "path",
    required: true,
    schema: { type: "string" },
  }])),
  schemas: Object.fromEntries(Object.entries(schemas).map(([name, schema]) => {
    const jsonSchema = z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
    delete jsonSchema.$schema;
    return [name, jsonSchema];
  })),
};

const document = {
  openapi: "3.1.0",
  info: {
    title: "Catálogo API",
    version: "1.0.0",
    description: "Contrato generado desde los esquemas Zod que validan las solicitudes de la API.",
  },
  paths,
  components,
};

const outputPath = resolve(process.cwd(), "openapi.json");
async function main() {
  await mkdir(process.cwd(), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
  console.log(`OpenAPI generado en ${outputPath}`);
}

void main();
