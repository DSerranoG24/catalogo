# Inventario ampliado: implementación y verificación local

Fecha de cierre: 18 de noviembre de 2026. Alcance: Inventario tradicional, ficha comercial, hoja editable y lotes XLSX/CSV. Ventas permanece sin implementar. Sin despliegues ni acceso a producción.

## Estado y trazabilidad

La implementación partió de `9896a3a`, con Git limpio. Al reanudar después de la pausa, HEAD era `9e4b2d0` y la implementación ya estaba confirmada en esa base, también limpia. El agente no ejecutó commit, push, merge ni cambios de rama. Las correcciones y la documentación posteriores quedan sin confirmar para revisión.

La ejecución final aprobó **22 etapas E2E reales**, incluyendo copia rectangular, pegado por celdas, edición tradicional de ficha y recuperación tras reiniciar el API. No confundir estos resultados con las 14 etapas históricas de la primera versión.

## Comportamiento implementado

- Tradicional: conserva altas y movimientos; añade formularios separados para nombre/SKU/mínimo y precio/costo de referencia. Ambos usan su versión esperada. Ninguno escribe existencias.
- Hoja: `/dashboard/inventario/hoja`, enlazada desde Inventario. Carga páginas existentes de 24 artículos sin descargar el inventario entero. Conserva filas por UUID en el borrador y muestra 50 por página, con filtros de clasificación.
- Tabla con columnas configurables, cabecera/SKU fijos, selección rectangular, copia, pegado delimitado y edición ampliada por fila en móvil. El pegado respeta filas filtradas y columnas visibles, sin modificar filas ocultas por un filtro.
- XLSX/CSV y pegado TSV con cabeceras y asignación explícita de columnas externas. Los archivos se leen en un worker cancelable con plazo de diez segundos. El archivo bruto no se sube al API: se envían fragmentos de filas y el servidor vuelve a validar todo su contenido.
- El navegador rechaza archivos grandes, ZIP/XML incompatibles y fórmulas XLSX antes de usar el parser de matrices. No ejecuta fórmulas. Los SKU numéricos XLSX se conservan como números inválidos para que el servidor exija corregirlos, sin convertirlos silenciosamente y perder ceros.
- CSV UTF-8, BOM opcional, coma o punto y coma elegidos explícitamente; comillas, saltos internos y escapes reversibles `INV1_ESC`. Se prohíbe mezclar perfiles. XLSX usa texto para SKU y dinero.
- Máximo 500 filas en el manifiesto completo, incluyendo excluidas; hasta 50 por fragmento, 256 KiB por solicitud y 2 MiB acumulados. XLSX hasta 5 MiB comprimidos, 20 MiB expandidos, 64 entradas y 8 MiB por entrada; CSV/TSV hasta 2 MiB.
- Lotes atómicos. Una fila inválida impide aplicar todas las seleccionadas; excluirla requiere guardar y generar una nueva preview. No hay división automática ni sustitución del inventario por ausencia de filas.
- Identidad por ID propio o SKU exacto normalizado; nunca por nombre. Se detectan duplicados de identidad/SKU en todas las filas, incluso entre páginas y fragmentos.
- Existencia objetivo vacía conserva el saldo. Un objetivo diferente se convierte en movimiento `ADJUSTMENT`, conservando el significado de `quantity` como conteo final y guardando también `delta`, actor, lote, fila y saldos anterior/final.
- Datos, ficha comercial y stock tienen versiones independientes. Toda confirmación vuelve a calcular el plan dentro de la transacción. Un movimiento o cambio de datos/precios posterior a la preview invalida la aplicación, sin escrituras parciales.
- Dinero COP en BIGINT y cadenas decimales JSON, sin pasar por `Number` para precios/costos. Costo opcional de referencia; no valorización contable.

## Persistencia, concurrencia e idempotencia

`InventoryBatch` conserva propietario, fuente, revisión, preview, hashes de entrada/plan, operación preparada, vencimiento y recibo. `InventoryBatchRow` conserva ID, número de origen, revisión y valores. `InventoryBatchChunkReceipt` recupera el mismo resultado al repetir un fragmento con el mismo contenido; rechaza reutilizar la clave con contenido distinto.

El flujo es `DRAFT → READY/INVALID → APPLIED`, con `STALE` para conflictos y `CANCELLED` antes de aplicar. Editar invalida el plan. Preview dura 30 minutos; un recibo aplicado se recupera aun después de vencer esa preview. La cuenta abierta se verifica antes de devolver recibos o escribir.

Aplicación: bloqueo compartido del propietario → namespace transaccional de identidad/SKU del propietario → lote exclusivo → artículos por ID ascendente. Altas y renombrados tradicionales usan el mismo namespace. Movimientos manuales bloquean su artículo y comparten el cálculo y los datos del ledger con la operación de lote.

Las escrituras de artículos, fichas, saldos y movimientos se realizan por conjuntos en una sola transacción; cualquier fallo revierte todas. Presupuesto de aplicación 15 s, espera de pool 2 s y `lock_timeout` 2 s al bloquear el lote y sus artículos. Los locks anteriores están sujetos al plazo de la transacción. El ensayo local de 500 filas con stock inicial y precio tardó 298 ms en aplicar; no predice el rendimiento de una base remota.

La URL conserva solo `batchId`. Tras recargar se recupera el staging confirmado, preview y recibo del servidor. Doble clic, reintento HTTP y respuesta perdida después del commit no generan movimientos adicionales. No se guarda inventario ni autenticación en localStorage. Los cambios locales todavía no guardados advierten antes de abandonar la pestaña; no se promete recuperar celdas que nunca llegaron al staging.

Los reintentos persistentes del formulario manual de movimientos continúan fuera de alcance: tras recargar se consulta el historial antes de reenviar, conforme a la decisión anterior. La política de retención por doce meses después del cierre sigue pendiente de aprobación e implementación; no se añadió una purga.

## API

Todos los recursos se limitan al propietario autenticado y usan `private, no-store`.

| Ruta bajo `/api/inventory` | Uso |
| --- | --- |
| `GET /batches?page=` | Lotes propios, 20 por página, para reanudar o cancelar pendientes. |
| `POST /batches` | Crear o recuperar el mismo UUID y manifiesto inicial. Máximo cinco lotes no terminales. |
| `PATCH /batches/:id/rows` | Fragmento con UUID de operación, revisión esperada y revisiones por fila. |
| `GET /batches/:id` | Estado, revisiones, hashes, resumen y recibo resumido. |
| `GET /batches/:id/rows?page=&filter=` | Hasta 50 filas con valores, errores, preview y resultado aplicado. |
| `POST /batches/:id/preview` | Validación y plan persistido de todo el manifiesto. |
| `POST /batches/:id/apply` | Confirmar revisión/hash/operationId preparados; recuperar recibo si ya se aplicó. |
| `POST /batches/:id/cancel` | Cancelar antes de aplicar, sin borrar staging ni historial. |
| `GET /batches/:id/report` | Informe CSV de una instantánea del plan completo. |
| `PATCH /items/:id` | Datos sin stock ni precio. |
| `GET/PUT /items/:id/commercial-terms` | Ficha comercial independiente del catálogo. |
| `GET /export?format=csv\|xlsx` | Exportación privada consistente; `template=true` genera cabeceras. |

El API permite exportaciones de hasta 10.000 filas bajo cuotas de tamaño; no entrega archivos truncados silenciosamente. La pantalla solicita segmentos explícitos de hasta 500 para edición, con búsqueda y cursor, e indica cuándo hay otro segmento. Cada segmento tiene su fecha de captura, sin prometer una única instantánea entre descargas. `ExistenciaActual` es informativa y `ExistenciaObjetivo` siempre se exporta vacía. Reimportar sin modificar no crea movimientos.

El proxy conserva las respuestas como bytes, incluyendo XLSX, y propaga únicamente las cabeceras necesarias de descarga y segmentación. La excepción de tamaño para fragmentos se limita a PATCH + ruta exacta + UUID + JSON; Origin, autenticación, límites generales y rate limiting siguen activos.

## Migración y compatibilidad

Nueva: `20261119000000_inventory_batches`. No se modificaron las 25 anteriores. Se ensayaron las 26 sobre PostgreSQL 17.11 local aislado y se repitió deploy sin cambios.

Añade versiones, ficha comercial uno a uno mediante FK compuesta por artículo/propietario, tablas de lote/filas/recibos, índices y auditoría del ledger. Backfill de `delta` a partir de snapshots existentes; actor histórico queda NULL porque no puede inferirse. No importa stock del catálogo ni inventa precios/costos. Triggers incrementan versiones, validan identidad del lote/actor/artículo y rechazan editar o borrar movimientos anteriores.

Antes de un despliegue futuro autorizado: backup, revisar tamaño y datos reales, ensayar la migración en una copia autorizada y planificar el bloqueo de backfill/índices. Desplegar migración antes del API que consulta las columnas nuevas; no activar la hoja hasta que el API esté preparado. No hay rollback destructivo automático: conservar datos nuevos y corregir hacia delante; una reversión del ejecutable no debe eliminar columnas, lotes ni ledger. La retención no se resuelve mediante cascadas.

Solo se ejecutó contra esquemas nuevos `inventory_verify_*`, `inventory_batch_*` e `inventory_e2e_*` dentro de `catalogo_test`, en loopback. Ninguna otra base de desarrollo o producción fue inspeccionada ni migrada. La migración queda pendiente en esos destinos. Al cerrar, PostgreSQL temporal quedó detenido mediante `pg_ctl -m fast -w stop`, con sus datos ficticios conservados. Los procesos del API, Next y navegador del E2E también finalizaron.

## Comandos y entorno reproducible

No se instalaron, eliminaron ni actualizaron dependencias. Se reutilizan Prisma, TypeScript, fflate y read-excel-file existentes. API no tiene scripts `lint` o `typecheck`; se ejecuta TypeScript explícitamente además del build. Frontend tampoco tiene script `typecheck`; se usa `tsc --noEmit`.

Comprobaciones ejecutadas desde cada proyecto:

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
```

El verificador PostgreSQL y el E2E requieren el build previo del API. El E2E usa Chrome/Edge real, copia temporal del frontend sin `.env`, backend real con configuración sintética y autenticación real. El destino se recibe por stdin, se comprueba loopback y base `catalogo_test` antes de crear un esquema único. Las cuentas son ficticias y no se envían correos.

Clúster temporal ya existente, separado del servicio habitual:

```powershell
$inventoryCluster = 'C:/Users/danie/AppData/Local/Temp/vitrinaya-inventory-0764518467a24c2daea1f5f04e4e7908'
$inventoryLog = Join-Path $env:TEMP 'vitrinaya-inventory-sheet-postgres.log'
& 'C:/Program Files/PostgreSQL/17/bin/pg_ctl.exe' -D $inventoryCluster status
# Solo si está detenido; no iniciar dos instancias sobre el mismo directorio.
& 'C:/Program Files/PostgreSQL/17/bin/pg_ctl.exe' -D $inventoryCluster -l $inventoryLog -o '-h 127.0.0.1 -p 55479' -w start
# Al terminar las pruebas:
& 'C:/Program Files/PostgreSQL/17/bin/pg_ctl.exe' -D $inventoryCluster -m fast -w stop
```

No borrar el clúster ni esquemas para repetir: cada verificador crea otro esquema. El puerto anterior 55439 rechazó sockets en esta sesión; se usó IPv4 55479. El arranque/navegador necesitaron ejecución local fuera de la restricción de procesos. Tras la pausa PostgreSQL recuperó su WAL correctamente; un log dentro del propio directorio de datos provocó una espera de Windows por archivo abierto, por eso los comandos recomendados escriben el log fuera del clúster.

## Resultados y problemas corregidos

- API: 218 pruebas aprobadas, frente a 213 iniciales. Nuevas regresiones de límites/autoridad, precios exactos, deltas, identidad y duplicados, motivos/versiones/costos y formatos exportados.
- PostgreSQL tradicional: 12 etapas aprobadas con las 26 migraciones.
- PostgreSQL lotes: ocho etapas aprobadas, incluyendo backfill sobre movimientos previos, replay concurrente, exclusiones, rollback real tras fallar una fila posterior, conflictos de stock/precio/datos, carreras por SKU, propietario/cierre, ledger inmutable y aplicación de 500 filas con conciliación.
- Frontend: 17 escenarios del importador existente, una comprobación de claves manuales y cinco grupos nuevos de formatos/seguridad aprobados.
- Tipos y builds de ambos proyectos aprobados. Lint frontend sin errores, con cuatro avisos preexistentes de `<img>` fuera de Inventario. No se modificaron esas pantallas.
- E2E: **22 etapas aprobadas**, sin API simulada ni excepciones de navegador no controladas. PostgreSQL, backend, frontend, navegador y autenticación reales; dos cuentas. Incluye importación de archivos reales mediante el worker, reimportación sin movimientos, copia/pegado rectangular, paginación a 1280/320/390 px, errores/exclusión/re-preview, confirmación con respuesta perdida, recarga, conflictos, ficha tradicional, aislamiento, cierre y conciliación.

Evidencia de la ejecución final: esquema `inventory_e2e_af24308c2317b5fc`; 26 migraciones; resumen `C:/Users/danie/AppData/Local/Temp/vitrinaya-inventory-e2e-EHkbvF/inventory-e2e-results.json`; capturas `inventory-sheet-320.png`, `inventory-sheet-390.png`, `inventory-sheet-1280.png` y las tradicionales en ese directorio. Se inspeccionaron visualmente las capturas móviles, además de comprobar que el documento no supera el ancho de su viewport. Últimos ensayos PostgreSQL: `inventory_verify_8d41013a3b8b6fd5` (12 etapas) e `inventory_batch_2d501577f181c30d` (ocho etapas; 298 ms para aplicar las 500 filas).

Se corrigió la descarga binaria del proxy, que convertía XLSX a texto; una validación monetaria que lanzaba excepción sobre decimales; el error de estado de un lote cancelado; la señal de carga de preview, que conservaba un mensaje anterior; el desbordamiento móvil del input de archivo; y el pegado de tablas filtradas para que no afecte filas ocultas. Se endureció el informe para leer una única instantánea, se agregó consulta de lotes pendientes para recuperarlos sin depender solo de recordar su URL y se sincronizaron los datos del artículo seleccionado después de editar la ficha tradicional.

También hubo fallos del propio ensayo: arranque restringido del navegador, eventos sintéticos de selección enviados sin esperar el render entre ellos y agotamiento del límite real de 300 solicitudes/IP al ampliar la suite. La ejecución final separa fases mediante un reinicio del proceso local del API, conservando la misma configuración efímera de autenticación y la misma base. Verifica que la cookie sigue siendo válida y el recibo persistido se recupera después de ese reinicio. No se deshabilitó ni aumentó el rate limiting; la regresión del API que rechaza la solicitud 301 sigue aprobada. Webpack emitió avisos Watchpack sobre archivos de sistema de Windows al escanear la copia temporal; no son errores de tipos/build ni se accedió a su contenido.

## Archivos de la ampliación

Backend: `prisma/schema.prisma`, la migración nueva, `src/app.ts`, `src/repositories/inventory.repository.ts`, `src/routes/inventory-batch.routes.ts`, `src/schemas/inventory-batch.schema.ts`, `src/services/inventory-batch-plan.ts`, `inventory-batch.service.ts`, `inventory-export.service.ts`, `inventory-batch.test.ts`, `src/scripts/verify-inventory-postgres.ts`, `verify-inventory-batches-postgres.ts`, `scripts/test.cjs` y `package.json`.

Frontend: `app/api/backend/[...path]/route.ts`, `app/dashboard/inventario/page.tsx`, `app/dashboard/inventario/hoja/page.tsx`, `components/inventory/InventorySheet.tsx`, `InventoryDetails.tsx`, `lib/backend-proxy-limits.ts`, `lib/inventory-sheet/formats.ts`, `reader.worker.ts`, `lib/product-import/xml-guard.ts` (perfil parametrizable, comportamiento de catálogo preservado), `scripts/verify-inventory-e2e.mjs`, `inventory-sheet-e2e.mjs`, `verify-inventory-sheet.mjs` y `package.json`.

Documentación: este informe, `inventory-verification.md`, `inventory.md` e `inventory-sheet-contract.md`. No hay cambios en código, esquema ni migraciones de Ventas.

## Límites y siguiente tarea

La verificación acredita este entorno local, no producción, Excel instalado en cada plataforma, lectores de pantalla específicos ni latencia de una base remota. Las filas ya guardadas sobreviven recargas; los cambios exclusivamente locales necesitan guardarse. Archivos con versiones obsoletas requieren revisar datos actuales y nueva preview; no se fuerza el baseline antiguo. Los límites y rate limiting producen errores explícitos, no aplicaciones parciales.

Pendientes de producto: retención/purga tras cierre y persistencia de reintentos del formulario manual. No afectan la idempotencia persistida de los lotes.

Siguiente tarea tras revisar estos resultados: comenzar la fase de modelo/transacciones de Ventas según `sales-contract.md`, reutilizando `ItemCommercialTerms`, los bloqueos por artículo y el ledger. Ventas deberá añadir sus referencias/orígenes y movimientos compensatorios mediante una migración nueva, congelar snapshots al confirmar y aplicar recibos persistidos propios. No reutilizar un lote de importación como venta ni conectar automáticamente catálogo/WhatsApp.
