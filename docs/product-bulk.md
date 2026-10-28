# Acciones de productos en lote

Implementación local del 28 de octubre de 2026. Sin cambio de esquema ni migración.

## Selección y alcance

El panel conserva hasta 96 productos seleccionados entre páginas de 24/48/96,
filtros, ordenación, recargas del listado y pestañas. Cada entrada conserva id, nombre y
updatedAt del momento de seleccionarla. El aviso sticky y «Salir de la selección»
permanecen visibles; las acciones y confirmaciones indican el TOTAL seleccionado,
incluidos productos ocultos por la vista actual. Seleccionar página agrega solo
esa página; quitar una página conserva los seleccionados de otras páginas.
No se admite exceder 96 ni se selecciona una parte de la página silenciosamente.

Solo se vacía todo el conjunto al salir explícitamente, cambiar de catálogo o
confirmarse una ejecución correcta. Una validación fallida conserva la selección.
Un producto cambiado o desaparecido debe revisarse y volver a seleccionarse;
no se actualiza su versión de forma silenciosa. Para no perder borradores ni
sobrescribir un lote desde un editor obsoleto, antes de ejecutar hay que guardar
o cancelar el borrador del editor individual. Esto conserva la selección.

## Contrato

Dos rutas privadas, bajo el parser global de Express de 32 KiB y el límite
ordinario de 64 KiB del proxy, sin excepciones nuevas:

- `POST /api/products/catalog/:catalogId/bulk/preview`
- `POST /api/products/catalog/:catalogId/bulk/confirm`

Preview recibe `items: [{ id, updatedAt }]` (1..96, únicos) y una operación:

| action | Parámetros y comportamiento |
| --- | --- |
| delete | Elimina todos los seleccionados. Se permiten productos con pedidos. |
| discard | Elimina solo los seleccionados con needsCompletion=true y active=false; los demás se muestran como omitidos ANTES de confirmar. |
| price | `price`: entero 0..2147483647, aplicado a todos; conserva la oferta existente y rechaza una combinación inválida. |
| promotion | `promotion: { salePrice, saleStartsAt, saleEndsAt }` o **null** para quitar la oferta y ambas fechas. Precio entero y periodo obligatorio y válido al establecerla. |
| category | `categoryId`: UUID del MISMO catálogo o **null** para quitar la asignación. No significa omisión. |

Preview informa total, afectados, omitidos, motivos de bloqueo y antes/después.
Si hay bloqueos no emite token. Si discard no encuentra provisionales inactivos,
responde sin error, afectados=0 y token=null; no elimina nada.

El token HMAC tiene dominio propio PRODUCT_BULK_V1, propietario, catálogo,
operación, versiones de TODOS los seleccionados y de la categoría, y caducidad
de diez minutos. No incluye imágenes, datos de clientes ni credenciales.
El secreto existente de firma no cambia. El token nunca autoriza por sí solo:
confirm también exige sesión válida y comprueba nuevamente el propietario.

Confirm recibe token y, para delete/discard, `confirmation` exactamente igual a
`ELIMINAR N` / `DESCARTAR N`, con N=TOTAL seleccionado, no el visible ni el subconjunto
descartable. Precio y oferta requieren revisión y un botón de confirmación.
Categoría tiene un solo botón explícito que hace preview y confirm sin diálogo
adicional. Una selección o unos parámetros distintos invalidan la vista previa.

## Atomicidad y concurrencia

Cada confirm usa una sola transacción interactiva Prisma. Bloquea el catálogo
por propietario, después los productos por id ordenado, vuelve a leer las filas,
valida updatedAt, categoría y precio/oferta combinados DENTRO de la transacción.
También condiciona cada escritura por propietario, catálogo e updatedAt.
No llama a servicios individuales que abran transacciones separadas.

Un ID ajeno/inexistente, versión cambiada, categoría de otro catálogo (aunque
sea del mismo propietario), promoción inválida o fallo de escritura revierte
todo el lote. Los omitidos de discard no son fallos: están anunciados antes y
también se revalida su versión para no cambiar el alcance entre revisión y ejecución.

Límites: lock_timeout 1500 ms, statement_timeout 5000 ms, maxWait 1500 ms y
timeout de transacción 10000 ms. No se reintentan escrituras automáticamente.
Una respuesta perdida tras el commit no prueba que se haya revertido: consultar
el listado antes de volver a actuar. Un reintento con versiones antiguas se rechaza.
No hay recibo persistente nuevo de operación ni promesa de exactamente una entrega.

## Borrado, pedidos y Storage

Se conserva la política actual: las líneas de pedidos mantienen nombre, precios,
cantidades y subtotal; productId pasa a null por la FK existente. No se cambia
inventario, no se borran pedidos ni se modifica su instantánea. Registros de
imágenes y reseñas desaparecen por cascada. Destacados y banners usan su resolución
pública existente para omitir productos que ya no existen.

**Deuda explícita:** este lote NO borra archivos de Storage. No crea una cola ni
reutiliza AccountClosureJob. La interfaz avisa antes del borrado y en su resultado.
La atomicidad es de PostgreSQL, no una transacción distribuida con Storage.

## Archivos y comprobaciones

- API: `schemas/product-bulk.schema.ts`, `services/product-bulk.service.ts`,
  `routes/product-bulk.routes.ts`, montaje en `routes/product.routes.ts`.
- Tests: `services/product-bulk.test.ts`, registrado en `scripts/test.cjs`.
- Panel: `lib/product-bulk-selection.ts`, `components/products/ProductBulkActions.tsx`,
  `CatalogProductList.tsx`, `components/catalogs/CatalogWorkspace.tsx` y el tipo
  privado Product.updatedAt de `lib/api.ts` (el listado ya devuelve ese campo).
- Navegador: `scripts/verify-product-bulk-browser.mjs` con el helper
  `scripts/private-panel-browser-fixture.mjs` y API HTTPS simulada en loopback.

Las pruebas ejecutan el servicio y rutas HTTP reales con dobles transaccionales
que revierten su estado si falla una escritura. También prueban el parser Express
real a 32 KiB con 96 entradas/token y un exceso rechazado por 413. No constituyen
un ensayo del motor PostgreSQL: no se ha conectado una base, ejecutado DDL ni
comprobado bloqueos reales, cascadas SQL o reinicio de procesos en este bloque.
El navegador prueba selección entre páginas/filtros/orden/tamaños, payload total,
confirmación reforzada, salida y aviso sticky en 320/390/1024/1440 px.

La compilación predeterminada de API está bloqueada localmente por faltar el
ejecutable nativo de TypeScript 7. La comprobación alternativa utiliza el
TypeScript ya instalado en el frontend, sin instalar dependencias. El build de
frontend usa Webpack por la deuda de SWC/Turbopack ya documentada. Ninguna de esas
alternativas acredita los compiladores nativos ausentes ni un despliegue remoto.

Resultados finales locales:

| Comprobación | Resultado |
| --- | --- |
| Frontend `npm.cmd run lint` | 0 errores, cuatro advertencias img previas. |
| Frontend `npm.cmd run build -- --webpack` | Correcto, incluido TypeScript. |
| Frontend `npm.cmd test` | 17/17. |
| `node scripts/verify-product-bulk-browser.mjs` | Cinco grupos de comprobaciones correctos, cinco solicitudes de lote a la API simulada; sin producción. |
| API `npm.cmd run build` | Falla por ausencia de `@typescript/typescript-win32-x64/lib/tsc.exe`. |
| API `node ../catalog-generator/node_modules/typescript/bin/tsc -p tsconfig.json` | Correcto con el compilador alternativo instalado. |
| API `npm.cmd test` | 189/189: las 181 anteriores y ocho pruebas nuevas. |
| JS inicial público | 474677 bytes, 143017 gzip, nueve archivos; coincide con la referencia Webpack guardada anteriormente (incremento 0). Medido con API simulada en loopback, no con Turbopack. |
| Esquema | SHA-256 de schema.prisma conserva `2F5571505D080100153255BD454E0A7CFFD577B2D7FD9F26CE16FCCA096668C0`; ninguna migración creada ni aplicada. |

La medición usa `node scripts/measure-account-navigation-public-js.mjs`, con
`NEXT_PUBLIC_CATALOG_API_URL=http://127.0.0.1:4347/api` en el build local de prueba.
Ese `.next` no se debe publicar como artefacto precompilado. El despliegue desde
Git en Vercel recompila con sus propias variables, como ya documenta decisiones.md.
