# Inventario independiente

Primera versión: productos propios por cuenta, una bodega implícita, SKU único por propietario, existencia mínima y movimientos con motivo e historial paginado. Los productos nacen con saldo cero; el saldo inicial se carga mediante una entrada. Las cantidades son unidades enteras entre 0 y 2147483647. Una salida no puede dejar saldo negativo. El ajuste establece la cantidad final contada, incluso cero.

## Arquitectura y futura integración

`InventoryItem` pertenece al usuario y existe sin catálogo. No reutiliza `Product.stock`: ese campo sigue siendo informativo y los pedidos conservan su política actual, sin reservas ni descuentos automáticos. No hay sincronización entre ambos módulos.

La futura integración debe vincular productos comerciales a un artículo de inventario mediante una relación explícita y una migración aditiva. Varios catálogos podrían publicar el mismo artículo; no se debe duplicar su saldo. Ventas deberá registrar movimientos utilizando un identificador estable del evento y definir cuándo descontar, cancelar o devolver antes de habilitar automatismos. No se añade una relación provisional que presuponga esas decisiones.

## Contrato privado

Todas las rutas exigen la sesión existente. El frontend usa el proxy same-origin con protección de origen y cookie HttpOnly. El propietario se obtiene del JWT verificado, nunca del cuerpo. Las respuestas no se cachean.

- `GET /api/inventory/items?page=1&q=texto`: 24 artículos por página, búsqueda por nombre o SKU y total filtrado.
- `POST /api/inventory/items`: `{ id, name, sku, minimumStock }`; UUID generado por el cliente para recuperar reintentos. El SKU se normaliza a mayúsculas.
- `GET /api/inventory/items/:id/movements?page=1`: historial de 24 movimientos por página.
- `POST /api/inventory/items/:id/movements`: `{ key, type, quantity, reason }`; `type` es `IN`, `OUT` o `ADJUSTMENT`, `key` es un UUID por operación.

Los movimientos bloquean la fila del artículo del propietario dentro de la transacción. La actualización del saldo y el historial se confirman juntos. La misma clave y contenido recuperan el movimiento anterior; cambiar el contenido con la misma clave produce conflicto. Los reintentos desde la pantalla conservan la clave mientras los datos no cambien. Ante un resultado de red incierto, reintentar sin cambiar los campos; después de recargar la página, consultar primero el historial antes de registrar otra operación. Una clave nueva representa una operación nueva.

No se ofrece borrado ni edición del historial. Los movimientos no guardan datos de clientes. Los motivos deben describir la operación, sin información personal.

## Migración y despliegue

Migración nueva `20261117000000_inventory`: crea dos tablas y sus restricciones; no copia ni modifica existencias actuales. No requiere variables ni dependencias nuevas. No se ejecutó contra ninguna base de datos.

Con autorización para publicar: respaldar y verificar el destino, aplicar las migraciones pendientes mediante el procedimiento del proyecto, generar Prisma y desplegar la API antes del frontend. Probar aislamiento entre dos cuentas, reintentos simultáneos, salidas concurrentes y rollback en PostgreSQL de desarrollo antes de publicar.

Para revertir la aplicación, retirar la versión nueva y conservar las tablas y datos. No borrar tablas con movimientos registrados. No se automatiza una migración destructiva de reversión.

## Límites y verificación

Las pruebas `src/services/inventory.test.ts` cubren validación, cálculo, aislamiento por propietario, paginación, reintentos, conflicto de clave y rollback mediante un doble transaccional. No acreditan bloqueos ni concurrencia real de PostgreSQL. La primera versión no incluye varias bodegas, costos, valorización, importación ni integración con ventas o catálogos.

### Verificación local del 17 de noviembre de 2026

- `npm run prisma:generate`: correcto tras permitir la descarga del motor; no ejecuta migraciones.
- `npm run lint` en frontend: sin errores; cuatro advertencias existentes sobre imágenes en componentes públicos.
- `npm test` en frontend: 17 comprobaciones aprobadas del importador y proxy existentes; no son pruebas de navegador del inventario.
- Pruebas específicas de inventario: siete aprobadas, incluyendo HTTP local con Express. Se ejecutaron mediante un preload temporal de `typescript.transpileModule`, usando TypeScript ya instalado en frontend; el runner `tsx` habitual no arranca por ausencia del binario de esbuild. No se instalaron dependencias.
- Comprobación de tipos de ambos proyectos mediante `typescript.createProgram` y `getPreEmitDiagnostics`, con sus `tsconfig.json` y `noEmit`: sin diagnósticos. No existen scripts independientes `typecheck`; la API tampoco tiene script `lint`.
- `npm test` en API: bloqueado antes de ejecutar las pruebas por el binario faltante de esbuild. Un intento general con preload alternativo tampoco acredita la suite: no reproduce la resolución de imports `.js` a TypeScript ni los subprocesos `tsx` usados por pruebas existentes.
- `npm run build` en API: bloqueado por el ejecutable faltante `@typescript/typescript-win32-x64/lib/tsc.exe`.
- `npm run build` en frontend: bloqueado por el SWC nativo faltante que requiere Turbopack. `npm run build -- --webpack` también falla por el archivo faltante `typescript/lib/_tsc.js`.
- No se ejecutaron migraciones, conexiones a PostgreSQL, pruebas de concurrencia real ni pruebas de navegador del inventario. Los builds completos quedan pendientes de reparar la instalación local de herramientas, sin cambiar versiones de dependencias.

Archivos del cambio: esquema Prisma y migración nueva, `src/schemas/inventory.schema.ts`, `src/services/inventory-calculation.ts`, `src/repositories/inventory.repository.ts`, `src/routes/inventory.routes.ts`, `src/services/inventory.test.ts`, registro en `src/app.ts` y `scripts/test.cjs`, página `app/dashboard/inventario/page.tsx`, enlace en `app/dashboard/layout.tsx` y este documento. Se conservó la entrada de pruebas preexistente para el reporte de imágenes huérfanas en `scripts/test.cjs`.
