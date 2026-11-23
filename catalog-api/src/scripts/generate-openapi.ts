import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { registerSchema, loginSchema } from "../schemas/auth.schema";
import { createCatalogSchema, updateCatalogSchema } from "../schemas/catalog.schema";
import { createCategorySchema, updateCategorySchema } from "../schemas/category.schema";
import { createProductSchema, updateProductSchema } from "../schemas/product.schema";
import { createPublicOrderSchema, updateOrderSchema } from "../schemas/order.schema";
import { createProductReviewSchema, moderateProductReviewSchema } from "../schemas/product-review.schema";
import { createCustomerSchema, updateCustomerSchema, customerListSchema } from "../schemas/customer.schema";
import { createSaleSchema, updateDraftSaleSchema } from "../schemas/sales.schema";

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
  CreateCustomer: createCustomerSchema,
  UpdateCustomer: updateCustomerSchema,
  CustomerListQuery: customerListSchema,
  CreateSale: createSaleSchema,
  UpdateDraftSale: updateDraftSaleSchema,
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
  "/api/sales": {
    get: operation("Listar las últimas 50 ventas propias con snapshots y ficha actual del cliente", { security: secured }),
    post: operation("Crear borrador, opcionalmente asociado a un cliente activo propio", {
      security: secured, requestBody: jsonBody("CreateSale"),
      description: "Responde {result: Sale}; customerNameSnapshot, customerPhoneSnapshot y customerEmailSnapshot son históricos. customer contiene la ficha actual. Sin customerId los nuevos campos son null. Importe BigInt como string decimal. No se admiten snapshots desde el cliente.",
      responses: { "200": response, "400": { description: "INVALID_SALE_INPUT" }, "401": { description: "Sesión requerida" }, "404": { description: "CUSTOMER_NOT_FOUND" }, "409": { description: "CUSTOMER_ARCHIVED o IDEMPOTENCY_CONFLICT" }, "500": { description: "SALE_OPERATION_FAILED" } },
    }),
  },
  "/api/sales/{id}": {
    get: operation("Consultar venta propia con snapshots y relación actual, sin sustituir los datos históricos", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }] }),
    patch: operation("Editar borrador; customerId omitido conserva asociación, null desvincula y UUID asigna cliente activo propio", {
      security: secured, parameters: [{ $ref: "#/components/parameters/id" }], requestBody: jsonBody("UpdateDraftSale"),
      responses: { "200": response, "400": { description: "INVALID_SALE_INPUT o datos de líneas inválidos" }, "401": { description: "Sesión requerida" }, "404": { description: "NOT_FOUND o CUSTOMER_NOT_FOUND" }, "409": { description: "INVALID_TRANSITION, VERSION_CONFLICT, CUSTOMER_ARCHIVED o IDEMPOTENCY_CONFLICT" }, "500": { description: "SALE_OPERATION_FAILED" } },
    }),
  },
  "/api/customers": {
    get: operation("Listar clientes del propietario autenticado", {
      security: secured,
      parameters: [
        { name: "q", in: "query", schema: { type: "string", maxLength: 160 }, description: "Nombre o teléfono; búsqueda literal, sin distinguir mayúsculas en nombres" },
        { name: "status", in: "query", schema: { type: "string", enum: ["active", "archived", "all"], default: "active" } },
        { name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 } },
      ],
      responses: { "200": response, "400": { description: "Consulta inválida" }, "401": { description: "Sesión requerida" }, "500": { description: "Operación no disponible" } },
    }),
    post: operation("Crear cliente; coincidencias de teléfono generan advertencia, no rechazo", {
      security: secured, requestBody: jsonBody("CreateCustomer"),
      responses: { "201": { description: "Cliente creado y warnings (CUSTOMER_PHONE_MATCH si hay coincidencia)" }, "400": { description: "Datos inválidos" }, "401": { description: "Sesión requerida" }, "500": { description: "Operación no disponible" } },
    }),
  },
  "/api/customers/{id}": {
    get: operation("Consultar cliente propio, activo o archivado", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }], responses: { "200": response, "400": { description: "ID inválido" }, "401": { description: "Sesión requerida" }, "404": { description: "Cliente no encontrado" }, "500": { description: "Operación no disponible" } } }),
    patch: operation("Actualizar parcialmente cliente propio", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }], requestBody: jsonBody("UpdateCustomer"), responses: { "200": { description: "Cliente actualizado y warnings" }, "400": { description: "Datos inválidos o actualización vacía" }, "401": { description: "Sesión requerida" }, "404": { description: "Cliente no encontrado" }, "500": { description: "Operación no disponible" } } }),
    delete: operation("Eliminación física no permitida; usar archivado", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }], responses: { "400": { description: "ID inválido" }, "401": { description: "Sesión requerida" }, "405": { description: "CUSTOMER_DELETION_NOT_ALLOWED" } } }),
  },
  "/api/customers/{id}/archive": {
    post: operation("Archivar cliente propio sin eliminarlo", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }], responses: { "200": response, "400": { description: "ID inválido" }, "401": { description: "Sesión requerida" }, "404": { description: "Cliente no encontrado" }, "500": { description: "Operación no disponible" } } }),
  },
  "/api/customers/{id}/reactivate": {
    post: operation("Reactivar cliente propio archivado", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }], responses: { "200": response, "400": { description: "ID inválido" }, "401": { description: "Sesión requerida" }, "404": { description: "Cliente no encontrado" }, "500": { description: "Operación no disponible" } } }),
  },
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
