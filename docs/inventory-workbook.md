# Hoja de cálculo libre — implementación y verificación

18 de noviembre de 2026. La petición actual sustituye la prioridad de una tabla con columnas de inventario por un editor de hoja de cálculo libre. Interpretar las columnas que escriba el vendedor queda para una fase posterior. No se ha implementado ese reconocimiento ni se han cambiado las reglas de stock.

## Experiencia y librería

`/dashboard/inventario/hoja` integra **Univer 1.5.2**, con núcleo, filtros, ordenación y búsqueda/reemplazo. Los módulos tienen licencia Apache-2.0 y admiten el React 19 existente. Se añadieron esas dependencias necesarias, RxJS 7.8.2 y el lockfile; no se actualizaron las dependencias anteriores. Licencias disponibles en `catalog-generator/public/licenses/univer.txt` y `rxjs.txt`.

La decisión evita programar otro motor de celdas/selección/arrastre. Documentación oficial consultada: [integración con Next.js](https://docs.univer.ai/guides/sheets/getting-started/integrations/nextjs), [React y ciclo de vida](https://docs.univer.ai/guides/sheets/getting-started/integrations/react), [filas y columnas](https://docs.univer.ai/guides/sheets/features/core/row-col) y [modelo de documento](https://docs.univer.ai/guides/sheets/model/workbook-data).

- Sin cabeceras comerciales impuestas: los títulos y posiciones los decide el vendedor.
- Celdas, barra de fórmulas, selección de rangos, arrastre y relleno, formato, tamaños, combinar celdas, insertar/eliminar/mover filas y columnas, deshacer/rehacer y pestañas, mediante los controles del SDK.
- Módulos de filtros, ordenación y búsqueda/reemplazo instalados y registrados con textos en español.
- `Guardar hoja` conserva el documento completo en la cuenta; no exige convertirlo en productos ni previsualizar un ajuste de stock.
- Escribir, cambiar formato o arrastrar no envía escrituras al servidor. Solo se lee el documento al abrir y se escribe al guardar. El cálculo local necesario para una hoja funcional permanece en el motor del SDK.
- `Descargar copia` entrega una copia nativa Vitrinaya JSON; no se etiqueta falsamente como XLSX.
- La edición estructurada anterior permanece accesible en `/dashboard/inventario/lotes` desde Ayuda. No se descartaron sus cambios locales ni sus funciones.

El componente se carga dinámicamente solo en el cliente, sin SSR del motor. Inicializa el editor dentro de su propio contenedor, espera el estado `Steady` antes de permitir guardar y lo dispone en una microtarea al desmontarse, según el ciclo de vida de React. No hay motor nuevo programado desde cero.

## Persistencia y API

Un libro por cuenta, con hasta diez pestañas. Inicio: 500 filas y 26 columnas, ampliables dentro de los límites de guardado. No son bodegas adicionales: son pestañas de un documento libre.

Migración nueva `20261120000000_inventory_workbooks`:

- `InventoryWorkbook`: propietario como PK/FK, snapshot nativo JSON serializado en TEXT, versión y fecha de actualización.
- `InventoryWorkbookSave`: propietario + operationId como PK, hash de la petición y versión resultante. Conserva el recibo para reintentar incluso después de otros guardados.
- FKs restrictivas, versiones positivas y límite SQL de 2 MiB de snapshot. No copia datos del catálogo ni cambia productos, saldos o movimientos.

`GET /api/inventory/workbook` recupera únicamente el documento del usuario autenticado; retorna null si todavía no existe. `PUT` recibe snapshot, expectedVersion y operationId. No acepta un selector de propietario. Ambas respuestas son privadas y no-store.

Guardar bloquea al propietario abierto y usa un advisory lock transaccional propio del documento. Una versión inesperada devuelve conflicto, sin sobrescribir. El mismo operationId/contenido devuelve el recibo previo; reutilizarlo con otro contenido se rechaza. Snapshot y recibo se escriben en una transacción. El cierre de cuenta bloquea nuevas escrituras.

El protocolo mantiene los cambios que se hagan mientras llega una respuesta: recuperar un guardado anterior no marca como guardadas las ediciones posteriores. En caso de respuesta incierta se reintenta el mismo cuerpo/operationId. Tras recargar se obtiene la versión persistida en servidor. No se usa localStorage para filas, autenticación ni documentos.

El SDK termina la celda activa y espera resultados de fórmulas antes de crear el snapshot. Las mutaciones internas `formula.mutation.*` son datos derivados y no se confunden con otra edición del vendedor. Si una fórmula no termina dentro del plazo de guardado, se informa para reintentar, sin inventar un guardado exitoso.

Límites del documento guardado: diez pestañas, 10.000 filas y 200 columnas por pestaña, 50.000 celdas almacenadas, snapshot de 2 MiB, profundidad JSON 32 y 200.000 nodos. La validación rechaza estructura inválida, dimensiones fuera de límite y claves de prototipo. Los metadatos nativos de estilos/recursos del SDK se conservan como datos opacos, no como órdenes de negocio.

La excepción de cuerpo (4 MiB para el JSON que contiene el snapshot serializado) se limita a PUT `/inventory/workbook`; mantiene Origin antes de leer en el proxy, JWT/cookie existente y rate limiting. Express autentica antes de leer ese cuerpo. El API limita además la cadencia de guardado; no se amplió el JSON global.

## Verificación

Resultados finales de esta fase:

- **220 pruebas de API aprobadas**. Dos nuevas regresiones verifican títulos/fórmulas libres y rechazo de JSON inválido, dimensiones, campos de propietario y cuotas.
- **12 etapas PostgreSQL tradicionales aprobadas** con las 27 migraciones.
- **10 etapas PostgreSQL de lotes/documento aprobadas**. Incluyen guardado idéntico concurrente, unicidad del recibo, conflicto entre dos versiones, replay de una operación anterior tras otro guardado, aislamiento por cuenta, cierre y ausencia de movimientos nuevos al guardar el documento.
- **27 etapas E2E reales aprobadas**, con PostgreSQL, API, frontend, autenticación y Chrome reales; sin API simulada. Cuatro etapas específicas verifican:
  1. Escribir títulos elegidos por el vendedor sin mutaciones HTTP por celda; `SUM(A2:A3)` calcula 5 y se conserva negrita.
  2. Guardar, recargar y editar otra columna sobre la versión recuperada.
  3. Arrastrar realmente con eventos de ratón el ancho de A y la celda A2 a E5; verificar ambos cambios en el snapshot persistido.
  4. Crear una segunda pestaña desde el SDK, escribir en ella, abrir la búsqueda y guardar/recargar ambas pestañas.
- El resto del E2E conserva el inventario tradicional y los lotes anteriores en su ruta propia. El segundo usuario no recibe el documento del primero y una cuenta cerrada no puede usar PUT.
- Tipos y builds de ambos proyectos aprobados. Lint frontend sin errores; siguen cuatro avisos de imágenes preexistentes fuera del módulo. API no tiene script lint/typecheck y frontend no tiene script typecheck: se ejecutó `tsc --noEmit` explícitamente.
- Pruebas de formatos y proxy del frontend aprobadas.

Evidencia: esquema `inventory_e2e_db2a2ff439615cf2`, 27 migraciones. Resumen y capturas en `C:/Users/danie/AppData/Local/Temp/vitrinaya-inventory-e2e-tvtk5X/`: `inventory-e2e-results.json`, `free-workbook-initial.png`, `free-workbook-edited.png`, `free-workbook-dragged.png`. Se inspeccionaron las capturas del editor real. PostgreSQL adicional: `inventory_verify_dd72945fe5f9784a` y `inventory_batch_35acf37b89da4f82`.

Se corrigieron dos problemas hallados por las pruebas del componente: habilitar acciones antes de terminar el montaje causaba un controlador del SDK aún inexistente después de recargar; el recálculo posterior a arrastrar podía marcar el guardado como si hubiera otra edición. Se añadió la espera de ciclo de vida completo y coordinación con el cálculo. La pasada final no presenta las excepciones de navegador de esos intentos iniciales.

Comandos ejecutados desde el proyecto correspondiente:

```powershell
# catalog-api
npm.cmd run prisma:generate
npm.cmd exec -- tsc --noEmit
npm.cmd run build
npm.cmd test
'postgresql://inventory_test@127.0.0.1:55479/catalogo_test' | npm.cmd run test:inventory-postgres
'postgresql://inventory_test@127.0.0.1:55479/catalogo_test' | npm.cmd run test:inventory-batches-postgres
# catalog-generator
npm.cmd exec -- tsc --noEmit
npm.cmd run lint
npm.cmd test
npm.cmd run build
'postgresql://inventory_test@127.0.0.1:55479/catalogo_test' | npm.cmd run test:inventory-e2e
npm.cmd audit --omit=dev --json
```

Los paquetes se instalaron con versiones exactas, tras consultar licencia y peers, con `--ignore-scripts --no-audit --no-fund`. `npm audit` se ejecutó aparte: devuelve código 1 por **Next.js 16.3.8 ya existente**, con severidad agregada crítica. No señaló a los nuevos módulos de Univer. Se requiere una tarea separada y prioritaria para revisar los avisos y actualizar Next con pruebas; no se mezcló esa actualización con la funcionalidad ni se ejecutó audit fix. El registro ofrece 16.4.6 como corrección en la fecha del ensayo, que deberá revalidarse antes de esa actualización.

## Migración, despliegue y límites pendientes

Las 27 migraciones solo se aplicaron en esquemas aleatorios de la base temporal `catalogo_test`, loopback IPv4 puerto 55479. No se editó ninguna migración anterior. La nueva migración sigue pendiente fuera de esos ensayos; requiere aplicarse antes del API nuevo en un despliegue futuro autorizado. Los comandos de arranque y parada del clúster están en `inventory-sheet-verification.md`. Los datos ficticios se conservaron y PostgreSQL temporal quedó detenido con `pg_ctl -m fast -w stop` al finalizar.

No se actualizaron archivos de entorno reales, no hubo commit/push/despliegue y no se accedió a producción. Se preservaron las modificaciones locales de la fase anterior. Rollback no destructivo: desactivar/revertir el editor y sus rutas conservando las tablas y snapshots; no borrar documentos ni receipts para volver al ejecutable previo. Una corrección de esquema futura requiere otra migración.

No se promete paridad completa con Microsoft Excel: macros, compatibilidad integral XLSX, gráficos, tablas dinámicas y colaboración simultánea no forman parte de esta integración. Algunas funciones avanzadas del proveedor pertenecen a paquetes Pro que no se instalaron ni se contrataron. Filtros/ordenación están registrados; el E2E automatiza búsqueda, formato, fórmulas, pestañas y arrastre, sin afirmar haber cubierto cada menú del SDK. La interacción de escritorio se comprobó con ratón/teclado; los gestos de todos los móviles y lectores de pantalla no están acreditados por este ensayo.

Pendientes de producto: importación/restauración del formato nativo, política de retención/purga de documentos y recibos tras cierre, y alcance móvil avanzado. La recuperación normal desde la cuenta ya está implementada. Si se excede una cuota, se informa y se puede descargar una copia; no se descartan columnas o celdas silenciosamente.

**Siguiente fase:** acordar cómo el vendedor seleccionará rangos/títulos y confirmará su significado, antes de convertirlos en artículos o movimientos. Esa interpretación no está implementada. Los límites y atomicidad de 500 filas del contrato de lotes continúan vigentes para una futura aplicación al inventario, aunque el documento libre pueda contener más filas. Ventas continúa pendiente.

## Archivos

Backend: esquema Prisma, migración `20261120000000_inventory_workbooks`, `src/app.ts`, `src/routes/inventory-workbook.routes.ts`, `src/schemas/inventory-workbook.schema.ts`, `inventory-workbook.test.ts`, `src/services/inventory-workbook.service.ts`, `scripts/test.cjs` y ambos verificadores PostgreSQL (actualizados para las migraciones adicionales).

Frontend: página `/dashboard/inventario/hoja`, página preservada `/dashboard/inventario/lotes`, componentes `FreeWorkbook.tsx` y `FreeWorkbookLoader.tsx`, `lib/backend-proxy-limits.ts`, `package.json`, `package-lock.json`, licencias públicas, `scripts/free-workbook-e2e.mjs`, `inventory-sheet-e2e.mjs` y `verify-inventory-e2e.mjs`. Los cambios anteriores de `InventorySheet.tsx` y la navegación tradicional se conservaron.

Documentación: este informe y las referencias de `inventory.md` e `inventory-sheet-verification.md`.
