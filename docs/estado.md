# Estado del proyecto Catalogo

Fecha de corte: **24 de noviembre de 2026**, commit `2c896bb` en `main`. Este documento describe lo que existe en el código del repositorio y lo que se ejecutó localmente en esa fecha. No acredita el estado de producción. Para desplegar, consulta [despliegue](despliegue.md); para probar, [pruebas](testing.md). La versión anterior está en [historial/2026-10-25-estado.md](historial/2026-10-25-estado.md).

## Módulos implementados

Rutas de la API bajo `/api`. Las tablas usan el nombre SQL real: los modelos de Prisma sin `@@map` conservan su nombre con mayúsculas (`"Sale"`, `"InventoryPublication"`, etc.).

| Módulo | Tablas principales | API | Interfaz |
|---|---|---|---|
| Cuentas y sesión: registro, Google, verificación de correo, recuperación, rol | `users`, `account_action_tokens`, `email_delivery_budgets` | `/auth`, `/me` | `/login`, `/verificar-correo`, `/recuperar-contrasena`, `/restablecer-contrasena` |
| Cierre de cuenta | `account_closure_jobs` | `POST /auth/close` | `/dashboard/cuenta`, `/cuenta-cerrada` |
| Administración y métricas de plataforma | `users.role` (agregados, sin tabla propia) | `/admin` | `/admin` |
| Catálogos, categorías y banners | `catalogs`, `categories`, `catalog_banners` | `/catalogs`, `/categories` | `/dashboard/catalogos/...` |
| Productos de catálogo: fotos, edición masiva, importación Excel, reseñas | `products`, `product_images`, `product_reviews`, `product_image_cleanup_tasks` | `/products`, `/product-images`, `/reviews` | Editor de catálogo |
| Catálogo público y carrito | Lectura de `catalogs`/`products` | `/public/catalogs` | `/c/[publicId]` |
| Pedidos, idempotencia y privacidad | `orders`, `order_items`, `order_deletion_markers` | `/orders` (incluye `anonymize`) | Panel de pedidos del catálogo |
| Cotizaciones PDF | Columnas `quotation*` de `orders` y `catalogs` | Dentro de `/orders` | Panel de pedidos |
| Inventario: artículos y movimientos | `inventory_items`, `inventory_movements` | `/inventory/items`, `/inventory/items/:id/movements` | `/dashboard/inventario` |
| Ficha comercial (precio y costo de referencia) | `item_commercial_terms` | `/inventory/items/:id/commercial-terms` | Detalle de inventario |
| Imágenes de inventario | `"InventoryItemImage"` | `/inventory/items/:id/images` | Detalle de inventario |
| Hoja de inventario | `inventory_workbooks`, `inventory_workbook_saves` | `/inventory/workbook` | `/dashboard/inventario/hoja` |
| Lotes de inventario (CSV/XLSX con vista previa) | `inventory_batches`, `inventory_batch_rows`, `inventory_batch_chunk_receipts` | `/inventory/batches` | `/dashboard/inventario/lotes` |
| Publicación de inventario en catálogos | `"InventoryPublication"`, `products.inventoryItemId` | `/inventory/publications` | Panel de publicación en inventario |
| Ventas presenciales: borrador, confirmación, entrega, cancelación, devolución total | `"Sale"`, `"SaleLine"`, `"SaleOperation"`, `"SaleReturn"`, `"SaleReturnLine"` y referencias en `inventory_movements` | `/sales` | `/dashboard/ventas` |
| Clientes e historial de ventas por cliente | `customers`, `"Sale".customerId` y columnas `customer*Snapshot` | `/customers` (incluye `archive`, `reactivate`, `/:id/sales`) | Dentro de `/dashboard/ventas` |
| Conversión de pedido a venta y revisión del cliente del pedido | `"Sale".sourceOrderId`, `orders.customerId`, `order_customer_operations` | `/orders/:id/convert-to-sale`, `customer-preview`, `customer-confirm`, `customer-matches` | Panel de pedidos |
| Compatibilidades privadas por artículo (incremento 1) | `device_brands`, `device_brand_names`, `device_models`, `device_model_names`, `compatibility_sets`, `item_compatibilities`, `compatibility_operations`, `compatibility_events` | `/device-brands`, `/device-models`, `/inventory/items/:id/compatibilities`, `compatibility-events` | Bloque «Compatibilidades» en `/dashboard/inventario` |

Contratos por módulo: [inventario](inventory.md), [hoja](inventory-sheet-contract.md), [ventas](sales-contract.md), [historial de clientes](customer-sales-history.md), [compatibilidades](inventory-compatibilities-design.md), [cotizaciones](quotations.md), [importación](product-import.md) y [cuentas](accounts.md).

Reglas vigentes sin cambio: los pedidos del catálogo no reservan ni descuentan stock; solo confirmar una venta descuenta existencias. Los precios se calculan en el servidor. Las ventas y los pedidos conservan instantáneas.

No existe ningún modelo, ruta ni pantalla de **gastos**, **pagos/cartera** ni **servicio técnico**.

## Migraciones

- Hay **37 migraciones** versionadas en `catalog-api/prisma/migrations` (desde `20261001144330_init` hasta `20261124100000_sale_integrity_checks`). No es un conteo del ledger remoto.
- Hay al menos 35 CHECK con nombre en SQL, además de triggers en `privacy_lifecycle`, `inventory_batches` y `private_item_compatibilities`.
- `20261124100000_sale_integrity_checks` (11 CHECK de Ventas) está **preparada, sin confirmar en Git y sin aplicar** en ningún entorno compartido. Antes de aplicarla hay que ejecutar [la consulta de solo lectura](sql/verify-sale-integrity.sql) y seguir [su procedimiento](migrations.md#check-de-ventas-20261124100000_sale_integrity_checks).
- `20261124000000_private_item_compatibilities` está confirmada en Git. **En este corte no se ha verificado si ya se aplicó en algún entorno.**
- Tres migraciones tienen nombres poco descriptivos generados con `prisma migrate dev`: `20261120194535_ultima` (crea ventas), `20261120204832_new` (imágenes y publicaciones de inventario) y `20261121004537_n` (`"Sale".sourceOrderId`). No deben renombrarse si ya están aplicadas.

## Comprobaciones del 24 de noviembre de 2026

Se ejecutaron en Windows con Node `v24.19.0` entre las 15:15 y las 15:17 (UTC−5), con dobles y sin acceso a producción ni a PostgreSQL real.

| Paquete | Comando | Resultado |
|---|---|---|
| API | `npm.cmd test` | Correcto: 344 pruebas, 344 aprobadas y 0 fallidas |
| API | `npm.cmd run build` (`tsc`, incluye typecheck) | Correcto |
| API | `npm.cmd run lint` | No existe el script |
| Frontend | `npm.cmd test` | Correcto: 35 grupos `PASS` |
| Frontend | `npm.cmd run lint` | Correcto: 0 errores; 4 advertencias `no-img-element` que ya existían en componentes públicos |
| Frontend | `npm.cmd run build` | Correcto, compilado con **Turbopack** (Next.js 16.3.8) |

Repetición tras el bloque de integridad de Ventas (24/11/2026, 15:58–15:59 UTC−5):
- API: `npm.cmd test` correcto, 352/352. `npm.cmd run build` y `prisma validate` correctos.
- Frontend: `npm.cmd test` correcto, 35 grupos. `npm.cmd run lint` sin errores, con las mismas 4 advertencias. `npm.cmd run build` correcto con Turbopack.
- Ensayo PostgreSQL `npm.cmd run test:sales-postgres`: 11/11 etapas sobre las 37 migraciones, en un clúster temporal local en el puerto 55491. El clúster se eliminó al terminar. El origen `SALE` se amplió solo en el esquema desechable para poder ejecutar las etapas de ventas.

No existe un script `typecheck` independiente en ninguno de los dos paquetes; los builds hacen la comprobación de tipos. En este corte no se ejecutaron los scripts de navegador, E2E ni PostgreSQL. El 24 de noviembre, durante el cierre de compatibilidades, pasaron los navegadores de compatibilidades, inventario, ventas por cliente y clientes de pedidos. El de inventario solo pasa si se ejecuta desde una ruta con `C:\` en mayúscula; con `c:\` en minúscula, webpack duplica módulos de Next.

## Pendientes vigentes

- **Bloqueante en Ventas: el esquema aplicado rechaza los movimientos de venta.** `inventory_movements_origin_check` e `inventory_movements_batch_check` solo admiten `MANUAL` e `INVENTORY_BATCH`, y ventas escribe `origin = 'SALE'`. Con la cadena de migraciones aplicada fallan con `500`:
  - confirmar una venta;
  - convertir un pedido en `CONFIRMED`/`DELIVERED`;
  - cancelar una venta confirmada;
  - devolver unidades revendibles.

  Lo detectó el ensayo PostgreSQL local del 24/11/2026. Corregirlo requiere una migración nueva aprobada ([detalle](sales-contract.md#13-limitaciones-y-riesgos-conocidos)).
- **Integridad de ventas:** los CHECK de importes y devoluciones están preparados en `20261124100000_sale_integrity_checks`, sin aplicar. Siguen sin respaldo en base de datos las reglas entre tablas (sumas de líneas, devolución completa) y la inmutabilidad.
- **Ventas, otros riesgos:**
  - La conversión de pedidos descuenta stock sin bloquear los artículos en orden fijo.
  - Una devolución no exige incluir todas las líneas.
  - Cancelar una venta `DELIVERED` reingresa todo el stock.
- **Compatibilidades:** falta ensayar la migración en PostgreSQL aislado (constraints, triggers diferidos y concurrencia). Los incrementos 2 a 5 del diseño no están aprobados. La API todavía no devuelve el ID de la relación existente cuando detecta un duplicado.
- **Ventas:** el listado devuelve como máximo 50 ventas, sin paginación ni filtros. No existe acción para descartar un borrador. Sigue sin retirarse la venta sintética `fb13793c` desplegada ([detalle](customer-sales-history.md)).
- **Cierre de cuenta:** bloquea si hay pedidos sin resolver, pero no si hay ventas `CONFIRMED` sin entregar. Esa regla estaba propuesta en el contrato de ventas y no se ha decidido.
- **Validación con PostgreSQL real** de ventas, clientes y compatibilidades, con volumen representativo y EXPLAIN.
- **OpenAPI:** `catalog-api/openapi.json` está desfasado respecto al generador en campos de cotización (`nit`, `quotationTerms`).
- **Sin cambios desde el corte anterior:** revisión jurídica de retención y anonimización, sitemap, auditoría WCAG, revocación de JWT, CSP, observabilidad, CI y staging.

Reglas de trabajo: [Agents.md](../Agents.md). Decisiones: [decisiones](decisiones.md).
