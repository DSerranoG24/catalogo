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
import { createSaleSchema, updateDraftSaleSchema, convertOrderToSaleSchema } from "../schemas/sales.schema";
import { orderCustomerPreviewSchema, confirmOrderCustomerSchema, orderCustomerMatchesSchema } from "../schemas/order-customer.schema";
import { customerSalesQuerySchema } from "../schemas/customer-sales.schema";
import { dashboardQuerySchema } from "../services/dashboard-summary";
import { createDeviceBrandSchema, createDeviceModelSchema, addBrandAliasSchema, addDeviceAliasSchema,
  addCompatibilitySchema, updateCompatibilitySchema, deviceListSchema, modelListSchema, compatibilityPageSchema } from "../schemas/compatibility.schema";

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
  CustomerSalesQuery: customerSalesQuerySchema,
  CreateDeviceBrand: createDeviceBrandSchema,
  CreateDeviceModel: createDeviceModelSchema,
  AddBrandAlias: addBrandAliasSchema,
  AddModelAlias: addDeviceAliasSchema,
  AddItemCompatibility: addCompatibilitySchema,
  UpdateItemCompatibility: updateCompatibilitySchema,
  DeviceBrandQuery: deviceListSchema,
  DeviceModelQuery: modelListSchema,
  ItemCompatibilityQuery: compatibilityPageSchema,
  CreateSale: createSaleSchema,
  UpdateDraftSale: updateDraftSaleSchema,
  ConvertOrderToSale: convertOrderToSaleSchema,
  OrderCustomerPreview: orderCustomerPreviewSchema,
  ConfirmOrderCustomer: confirmOrderCustomerSchema,
  OrderCustomerMatches: orderCustomerMatchesSchema,
  DashboardSummaryQuery: dashboardQuerySchema,
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
  "/api/device-brands": {
    get: operation("Buscar marcas propias por nombre canónico o alias", { security: secured, description: "q literal (160), page 1..100000, status active/retired/all. {success,items,page,pageSize:25,hasMore}; solo lectura, private/no-store." }),
    post: operation("Crear marca propia y canónico atómicamente", { security: secured, requestBody: jsonBody("CreateDeviceBrand"), responses: { "201": response, "200": { description: "Replay idempotente" }, "400": response, "401": response, "409": { description: "NAME_CONFLICT o IDEMPOTENCY_CONFLICT" }, "503": { description: "COMPATIBILITY_RETRY_SAME_OPERATION" } } }),
  },
  "/api/device-brands/{id}": { get: operation("Consultar marca propia", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }] }) },
  "/api/device-brands/{id}/names": {
    get: operation("Listar canónico y alias propios, 25 por página", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }] }),
    post: operation("Añadir alias básico sin colisiones con canónicos", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }], requestBody: jsonBody("AddBrandAlias") }),
  },
  "/api/device-models": {
    get: operation("Buscar modelos propios en una marca explícita", { security: secured, description: "brandId UUID obligatorio; q, page, status como marcas. No infiere compatibilidades." }),
    post: operation("Crear modelo y canónico en marca propia", { security: secured, requestBody: jsonBody("CreateDeviceModel") }),
  },
  "/api/device-models/{id}": { get: operation("Consultar modelo propio", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }] }) },
  "/api/device-models/{id}/names": {
    get: operation("Listar canónico y alias de un modelo propio", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }] }),
    post: operation("Añadir alias de modelo dentro del namespace de su marca", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }], requestBody: jsonBody("AddModelAlias") }),
  },
  "/api/inventory/items/{id}/compatibilities": {
    get: operation("Consultar compatibilidades privadas del artículo propio", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }], description: "{success,source:{kind:INVENTORY_ITEM,id},set:{id,version}|null,compatibilities,page,pageSize:25,hasMore}. GET no crea conjuntos. page y status all/PENDING/VERIFIED/REJECTED/WITHDRAWN." }),
    post: operation("Añadir una compatibilidad PENDING por acción explícita", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }], requestBody: jsonBody("AddItemCompatibility"), description: "expectedSetVersion=0 cuando no hay conjunto. Verificar requiere otro PATCH con evidencia. {success,result:{compatibility,setVersion,idempotent}}. 201 nueva / 200 replay. No modifica inventario, precios, ventas ni catálogo público." }),
  },
  "/api/inventory/items/{id}/compatibilities/{compatibilityId}": {
    patch: operation("Editar, verificar, rechazar, retirar o reabrir una compatibilidad propia", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }, { name: "compatibilityId", in: "path", required: true, schema: { type: "string", format: "uuid" } }], requestBody: jsonBody("UpdateItemCompatibility"), description: "Versiones esperadas de fila y conjunto. VERIFIED exige evidencia confirmada, rechazar/retirar motivo >=3. REJECTED/WITHDRAWN solo vuelven a PENDING; evidencia modificada de VERIFIED vuelve a PENDING. Actor/fechas en servidor; recibo y auditoría transaccionales." }),
  },
  "/api/inventory/items/{id}/compatibility-events": {
    get: operation("Consultar auditoría privada del artículo propio", { security: secured, parameters: [{ $ref: "#/components/parameters/id" }], description: "{success,items:[{id,actorId,eventType,entityKind,entityId,before,after,occurredAt}],page,pageSize:25,hasMore}. Todas las lecturas filtran propietario. Errores: 400 INVALID_COMPATIBILITY_INPUT, 401 sesión/cuenta, 404 COMPATIBILITY_RESOURCE_NOT_FOUND, 409 conflicto/versión/estado/idempotencia, 413 cuota y 503 COMPATIBILITY_RETRY_SAME_OPERATION. No DELETE." }),
  },
  "/api/orders/{orderId}/customer-matches": {
    get: operation("Paginar coincidencias activas exactas de teléfono tras autorizar el pedido propio", {
      security: secured, parameters: [{ $ref: "#/components/parameters/orderId" }, { name: "phone", in: "query", required: true, schema: { type: "string", maxLength: 40 } }, { name: "page", in: "query", schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 } }],
      responses: { "200": { description: "{success,result:{matches,hasMore,page}}; 25 por página" }, "400": { description: "INVALID_CUSTOMER_INPUT" }, "401": { description: "Sesión requerida" }, "404": { description: "ORDER_NOT_FOUND" }, "409": { description: "Pedido cancelado o anonimizado" } },
    }),
  },
  "/api/orders/{orderId}/customer-preview": {
    post: operation("Revisar los datos del comprador de un pedido propio sin crear un cliente", {
      security: secured, parameters: [{ $ref: "#/components/parameters/orderId" }], requestBody: jsonBody("OrderCustomerPreview"),
      responses: { "200": { description: "{success,result:{fields,invalidFields,matches,hasMore,customerId,existingCustomer,sale}}" }, "400": { description: "INVALID_CUSTOMER_INPUT" }, "401": { description: "Sesión requerida" }, "404": { description: "ORDER_NOT_FOUND" }, "409": { description: "ORDER_CANCELLED u ORDER_ANONYMIZED" }, "500": { description: "ORDER_CUSTOMER_FAILED" } },
    }),
  },
  "/api/orders/{orderId}/customer-confirm": {
    post: operation("Confirmar explícitamente CREATE o USE_EXISTING con idempotencia y asociación opcional de venta", {
      security: secured, parameters: [{ $ref: "#/components/parameters/orderId" }], requestBody: jsonBody("ConfirmOrderCustomer"),
      description: "CREATE usa el contrato Customer. USE_EXISTING solo admite un cliente activo propio con el teléfono seleccionado. associateSale requiere una venta del pedido y conserva sus snapshots, precios, stock y estado. Un teléfono activo coincidente devuelve CUSTOMER_PHONE_MATCH sin crear ni asociar automáticamente.",
      responses: { "200": { description: "{success,result:{customer,orderId,associatedSaleId,idempotent}}" }, "400": { description: "INVALID_CUSTOMER_INPUT" }, "401": { description: "Sesión requerida" }, "404": { description: "ORDER_NOT_FOUND o CUSTOMER_NOT_FOUND" }, "409": { description: "CUSTOMER_PHONE_MATCH (matches/hasMore), pedido cancelado/anonimizado, cliente archivado, vínculo incompatible o IDEMPOTENCY_CONFLICT" }, "500": { description: "ORDER_CUSTOMER_FAILED; reintentar la misma confirmación" } },
    }),
  },
  "/api/orders/{orderId}/convert-to-sale": {
    post: operation("Convertir pedido propio conservando snapshots del comprador del pedido", {
      security: secured, parameters: [{ $ref: "#/components/parameters/orderId" }], requestBody: jsonBody("ConvertOrderToSale"),
      description: "Los snapshots proceden exclusivamente del pedido. customerId opcional enlaza un cliente activo propio sin sustituir los snapshots ni crear clientes. Conserva precios, stock e idempotencia del flujo anterior.",
      responses: { "200": { description: "{success, sale, idempotent}" }, "400": { description: "Conversión inválida o producto no vinculado" }, "401": { description: "Sesión requerida" }, "404": { description: "ORDER_NOT_FOUND o CUSTOMER_NOT_FOUND" }, "409": { description: "CUSTOMER_ARCHIVED, ORDER_BUYER_PHONE_TOO_LONG o conflictos existentes de stock, estado, precio o idempotencia" }, "500": { description: "CONVERSION_FAILED" } },
    }),
  },
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
  "/api/dashboard/summary": {
    get: operation("Cifras de Inicio calculadas en el servidor para el propietario autenticado", {
      security: secured,
      description: "Solo lectura; el propietario sale de la sesión. Días en America/Bogota. Importes BigInt como strings decimales (pueden ser negativos). Ventas: CONFIRMED, DELIVERED o RETURNED por día de confirmedAt con el total histórico; CANCELLED y DRAFT no cuentan; cada devolución resta (unitPrice − unitDiscount) × receivedQuantity el día en que se registra. costOfSales: unitCost × quantity de las líneas vendidas menos unitCost × resellableQuantity devuelto; las líneas sin costo no suman y su venta cuenta en salesWithoutCostCount. expensesTotal es null mientras el módulo de gastos no exista (modules.expenses=false). estimatedProfit = salesTotal − costOfSales − (expensesTotal ?? 0). Definiciones completas en docs/dashboard-summary.md. Cache-Control private,no-store.",
      parameters: [{ name: "days", in: "query", required: false, schema: { type: "string", enum: ["7", "30", "90"], default: "7" }, description: "Puntos de salesSeries (un día por punto, incluidos días en cero)" }],
      responses: {
        "200": { description: "{success:true,generatedAt,today:{date,salesTotal,salesCount,yesterdaySalesTotal},month:{salesTotal,costOfSales,salesWithoutCostCount,expensesTotal|null,estimatedProfit,previousMonth:{salesTotal,expensesTotal|null,estimatedProfit}},attention:{lowStockCount,outOfStockCount,pendingOrdersCount},salesSeries:[{date,total}],recent:[{kind:'SALE',id,status,total,at,customerName|null}],setup:{hasInventoryItems,hasPublishedCatalog,hasSales},modules:{expenses}}" },
        "400": { description: "INVALID_DASHBOARD_QUERY: days distinto de 7, 30 o 90, o parámetros desconocidos o repetidos" },
        "401": { description: "Sesión requerida o expirada" },
        "500": { description: "DASHBOARD_UNAVAILABLE: error genérico reintentable" },
      },
    }),
  },
  "/api/customers/{id}/sales": {
    get: operation("Consultar ventas vinculadas explícitamente a un cliente propio", {
      security: secured,
      description: "Solo lectura. Admite clientes archivados. Orden createdAt DESC, id DESC; 25 ventas por página. No infiere vínculos ni recalcula importes históricos. El cursor debe pertenecer al mismo propietario, cliente y estado. Usa GET /api/sales/{id} para consultar líneas históricas.",
      parameters: [
        { $ref: "#/components/parameters/id" },
        { name: "cursor", in: "query", schema: { type: "string", format: "uuid" } },
        { name: "status", in: "query", schema: { type: "string", enum: ["all", "DRAFT", "CONFIRMED", "DELIVERED", "CANCELLED", "RETURNED"], default: "all" } },
      ],
      responses: {
        "200": { description: "{success:true,customer:{id,fullName,archivedAt},sales:[{id,status,version,currency,total:string,createdAt,sourceOrderId,customerNameSnapshot,customerName}],nextCursor:UUID|null}. Importes decimales enteros; Cache-Control private,no-store." },
        "400": { description: "INVALID_CUSTOMER_SALES_QUERY: ID, cursor, estado o parámetros desconocidos/repetidos inválidos" },
        "401": { description: "Sesión requerida o expirada" },
        "404": { description: "CUSTOMER_SALES_NOT_FOUND: cliente o cursor inexistente/ajeno al conjunto" },
        "500": { description: "CUSTOMER_SALES_FAILED: error genérico reintentable" },
      },
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
