# Estado del proyecto Catalogo

Fecha de corte: **24 de noviembre de 2026**, rama `f1-expenses` sobre `main` (`b177f12`). Este documento describe lo que existe en el código del repositorio y lo que se ejecutó localmente en esa fecha. No acredita el estado de producción. Para desplegar, consulta [despliegue](despliegue.md); para probar, [pruebas](testing.md). La versión anterior está en [historial/2026-10-25-estado.md](historial/2026-10-25-estado.md).

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
| Ventas presenciales: borrador, confirmación, entrega, cancelación, devoluciones parciales | `"Sale"`, `"SaleLine"`, `"SaleOperation"`, `"SaleReturn"`, `"SaleReturnLine"` y referencias en `inventory_movements` | `/sales` | `/dashboard/ventas` |
| Clientes e historial de ventas por cliente | `customers`, `"Sale".customerId` y columnas `customer*Snapshot` | `/customers` (incluye `archive`, `reactivate`, `/:id/sales`) | Dentro de `/dashboard/ventas` |
| Conversión de pedido a venta y revisión del cliente del pedido | `"Sale".sourceOrderId`, `orders.customerId`, `order_customer_operations` | `/orders/:id/convert-to-sale`, `customer-preview`, `customer-confirm`, `customer-matches` | Panel de pedidos |
| Gastos operativos F1a: categorías y gastos puntuales (en `main`; migración aplicada según el responsable) | `expense_categories`, `expenses`, `expense_operations`, `expense_events` y `recurring_expense_templates` | `/expense-categories` (incluye `seed`, `archive`, `reactivate`), `/expenses` (incluye `summary`, `overview`, `:id/void`) | `/dashboard/gastos` (menú «Dinero») y tarjeta en Inicio |
| Gastos F1b: gastos fijos y pagos programados (en `main` desde `1450a71`; migración aplicada según el responsable). Cierre del 26/11/2026 sin confirmar: meses futuros con proyección, fijos terminados y cabecera | `scheduled_expense_payments`, `expenses."scheduledPaymentId"` y uso de `recurring_expense_templates` | `/expenses/scheduled` (incluye `sync`, `:id/pay`, `:id/cancel`), `/expenses/recurring` (incluye `pause`, `resume`, `end`) | Tarjetas, chip «Fijos» y tarjeta «Gastos fijos» en `/dashboard/gastos`; filas de pagos en «Requiere tu atención» de Inicio |
| Compatibilidades privadas por artículo (incremento 1) | `device_brands`, `device_brand_names`, `device_models`, `device_model_names`, `compatibility_sets`, `item_compatibilities`, `compatibility_operations`, `compatibility_events` | `/device-brands`, `/device-models`, `/inventory/items/:id/compatibilities`, `compatibility-events` | Bloque «Compatibilidades» en `/dashboard/inventario` |

Contratos por módulo: [inventario](inventory.md), [hoja](inventory-sheet-contract.md), [ventas](sales-contract.md), [historial de clientes](customer-sales-history.md), [compatibilidades](inventory-compatibilities-design.md), [gastos](expenses-contract.md), [cotizaciones](quotations.md), [importación](product-import.md) y [cuentas](accounts.md).

Reglas vigentes sin cambio: los pedidos del catálogo no reservan ni descuentan stock; solo confirmar una venta descuenta existencias. Los precios se calculan en el servidor. Las ventas y los pedidos conservan instantáneas.

No existe ningún modelo, ruta ni pantalla de **pagos/cartera** ni **servicio técnico**. De **gastos** existen F1a y F1b (gastos fijos y pagos programados) en `main`. No hay soportes (fotos, F1c), proveedores como entidad, exportación, informes ni avisos por WhatsApp (F3).

## Migraciones

- Hay **40 migraciones** versionadas en `catalog-api/prisma/migrations` en la rama `f1-expenses` (desde `20261001144330_init` hasta `20261125000000_operating_expenses`); `main` tiene 39. No es un conteo del ledger remoto.
- Hay al menos 36 CHECK con nombre en SQL, además de triggers en `privacy_lifecycle`, `inventory_batches`, `private_item_compatibilities` y `sale_partial_returns_and_movement_roles`.
- **Aplicadas en producción según el responsable (24/11/2026)**, con `main` publicado en `648b1dc`:
  - `20261124100000_sale_integrity_checks`: 11 CHECK de Ventas.
  - `20261124200000_inventory_movements_allow_sale_origin`: admite `origin = 'SALE'`.

  No se verificó desde esta sesión.
- **Aplicada en producción según el responsable**, con `main` publicado en `b177f12`: `20261124210000_sale_partial_returns_and_movement_roles`. No se verificó desde esta sesión.
  Contiene el CHECK de rol frente a tipo, el índice y los triggers de devoluciones acumuladas y de transiciones. Se aplicó con el [anexo F0d del runbook](despliegue-2026-11-ventas.md#anexo-f0d-reglas-e-interfaz-de-ventas-20261124210000).
- **Aplicada en producción según el responsable (25/11/2026):** `20261125000000_operating_expenses` (Gastos F1a). No se verificó desde esta sesión.
- **Aplicada en producción según el responsable (26/11/2026):** `20261126000000_scheduled_expense_payments` (1 tabla, 1 enum, 1 columna en `expenses`, 3 CHECK, 2 índices únicos parciales, 2 funciones y 4 triggers; solo añade). No se verificó desde esta sesión. Hay 41 migraciones en `main`. Procedimiento: [runbook de F1b](despliegue-f1b.md), empezando por [la consulta de solo lectura](sql/verify-scheduled-preflight.sql).
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

Repetición tras la corrección del origen `SALE` (F0c, 24/11/2026, 16:18–16:23 UTC−5):
- API: `npm.cmd test` correcto, 352/352. `npm.cmd run build` y `prisma validate` correctos.
- Frontend: `npm.cmd test` correcto, 35 grupos. `npm.cmd run lint` sin errores, con las mismas 4 advertencias. `npm.cmd run build` correcto con Turbopack.
- Ensayo PostgreSQL `npm.cmd run test:sales-postgres`: **19/19 etapas sobre las 38 migraciones reales, sin cambios manuales en el esquema**. Clúster temporal local en el puerto 55492, eliminado al terminar.
- `docs/sql/verify-sale-integrity.sql` completo se ejecutó con `psql` sobre ese esquema: todas sus sentencias son válidas y termina en `ROLLBACK`.

Repetición tras las reglas de Ventas (F0d, 24/11/2026, 17:59–18:03 UTC−5):
- API: `npm.cmd test` correcto, 360/360. `npm.cmd run build` y `prisma validate` correctos.
- Frontend: `npm.cmd test` correcto, 35 grupos. `npm.cmd run lint` sin errores, con las mismas 4 advertencias. `npm.cmd run build` correcto con Turbopack.
- Ensayo PostgreSQL `npm.cmd run test:sales-postgres`: **24/24 etapas sobre las 39 migraciones reales, sin cambios manuales**. Clúster temporal local en el puerto 55493, eliminado al terminar. El archivo SQL de verificación completo es válido con `psql`.

Gastos F1a (rama `f1-expenses`, 24/11/2026, hasta las 20:40 UTC−5):
- API: `npm.cmd test` correcto, 370/370. `npm.cmd run build` y `prisma validate` correctos. No existe script `lint`.
- Ensayo PostgreSQL `npm.cmd run test:expenses-postgres`: **14/14 etapas sobre las 40 migraciones reales** (matriz de dos cuentas, idempotencia, triggers, concurrencia y `EXPLAIN` con 20 000 filas). Clúster temporal local, eliminado al terminar. `docs/sql/verify-expenses-preflight.sql` es válido con `psql`.
- Frontend: `npm.cmd test` correcto (incluye `verify-expenses-ui`). `npm.cmd run lint` sin errores, con las mismas 4 advertencias. `npm.cmd run build` correcto.
- Navegador: `test:expenses-browser` (17 comprobaciones), `test:sales-browser` (igual antes y después de extraer el hook común) y `test:inventory-browser` (11/11), correctos.

No existe un script `typecheck` independiente en ninguno de los dos paquetes; los builds hacen la comprobación de tipos. En este corte no se ejecutaron los scripts de navegador, E2E ni PostgreSQL. El 24 de noviembre, durante el cierre de compatibilidades, pasaron los navegadores de compatibilidades, inventario, ventas por cliente y clientes de pedidos. El de inventario solo pasa si se ejecuta desde una ruta con `C:\` en mayúscula; con `c:\` en minúscula, webpack duplica módulos de Next.

Gastos F1b (rama `f1b-scheduled`, 26/11/2026):
- API: `npm.cmd test` correcto (385/385) y `npm.cmd run build` correcto. No existe script `lint`.
- PostgreSQL en clúster local desechable: `test:scheduled-postgres` (esquema, API y cifras sobre 41 migraciones, sin deriva), `test:expenses-postgres` (15 etapas) y `test:dashboard-postgres`, correctos.
- Frontend: `npm.cmd test`, `npm.cmd run lint` (0 errores, las 4 advertencias de siempre), `tsc --noEmit` y `npm.cmd run build`, correctos.
- Navegador: `test:expenses-browser` (F1a y F1b), `test:dashboard-browser` y `test:panel-browser`, correctos.

Cierre de F1b (26/11/2026, sin commit): API 386/386 y build correctos (sin script `lint`); `test:scheduled-postgres` con las etapas `FUTURE_*` correcto; frontend `test`, `lint` y `build` correctos; `test:expenses-browser` con meses futuros, «Terminados» y la cabecera a 320–1440 px (incluidos 1132 y 1280), correcto.

## Pendientes vigentes

- **Ventas F0d (reglas e interfaz):** publicadas en `main` (`b177f12`) con su migración aplicada, según el responsable. No se verificó desde esta sesión.
- **Venta de prueba entregada y después cancelada (`29b2435…`)**, de la prueba en producción del 24/11/2026: no se corrige. La consulta previa la muestra como diagnóstico.
- **Gastos F1b:** en `main` (`1450a71`) con la migración aplicada según el responsable. Falta anotar el resultado de Render, Vercel y la prueba de humo del [runbook](despliegue-f1b.md). El cierre del 26/11/2026 (meses futuros hasta 12 meses con fechas «Proyectado» calculadas en la lectura, «Terminados» en «Administrar» y la cabecera en dos filas) está en el árbol de trabajo, sin commit; no cambia el esquema. Fuera de F1b: soportes (F1c), avisos por WhatsApp (F3) y la frecuencia «quincenal» (una quincena son dos fijos mensuales). `openapi.json` incluye las rutas de F1b y `GET /expenses/overview`, pero todavía no el resto de endpoints de F1a.
- **Integridad de ventas:** siguen sin respaldo en base de datos las sumas de líneas frente a totales y la inmutabilidad de líneas confirmadas.
- **Compatibilidades:** su migración se instala sin errores dentro de la cadena completa (ensayo de ventas del 24/11/2026), pero falta probar en PostgreSQL aislado sus restricciones, triggers diferidos y concurrencia. Los incrementos 2 a 5 del diseño no están aprobados. La API todavía no devuelve el ID de la relación existente cuando detecta un duplicado.
- **Ventas:** el listado devuelve como máximo 50 ventas, sin paginación ni filtros. No existe acción para descartar un borrador. Sigue sin retirarse la venta sintética `fb13793c` desplegada ([detalle](customer-sales-history.md)).
- **Cierre de cuenta:** bloquea si hay pedidos sin resolver, pero no si hay ventas `CONFIRMED` sin entregar. Esa regla estaba propuesta en el contrato de ventas y no se ha decidido.
- **Validación con PostgreSQL real** de ventas, clientes y compatibilidades, con volumen representativo y EXPLAIN.
- **OpenAPI:** `catalog-api/openapi.json` está desfasado respecto al generador en campos de cotización (`nit`, `quotationTerms`).
- **Sin cambios desde el corte anterior:** revisión jurídica de retención y anonimización, sitemap, auditoría WCAG, revocación de JWT, CSP, observabilidad, CI y staging.

Reglas de trabajo: [Agents.md](../Agents.md). Decisiones: [decisiones](decisiones.md).
