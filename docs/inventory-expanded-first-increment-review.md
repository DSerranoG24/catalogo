# Inventario ampliado: revisión previa del primer incremento

Estado: primer incremento de estabilización implementado localmente. Tras exponer
las alternativas, el usuario indicó «continua»; se siguió el alcance recomendado:
base existente, costo de referencia y sin añadir archivado ni compras reales.
No se considera esa continuación una aprobación de nuevos modelos o políticas.
No se migró ni duplicó un módulo. La matriz siguiente conserva el diagnóstico.

## Base inspeccionada

Git estaba limpio. Se revisaron los paquetes `catalog-api` y `catalog-generator`,
sus instrucciones, Prisma, autenticación, rutas privadas y pruebas. Se leyeron
completamente `inventory-expanded-next-phase-plan.md`, `inventory.md`,
`sales-contract.md` e `inventory-sheet-contract.md`. Algunas secciones históricas
hablan de Ventas como futura, aunque ya existe: no son evidencia de una función
faltante ni autorización para reimplementarla.

| Requisito | Evidencia y estado actual |
| --- | --- |
| Artículo operativo separado del catálogo | `InventoryItem`, relación a User, SKU único por propietario. `Product` sigue siendo comercial y tiene vínculo explícito opcional. No duplicar los modelos. |
| ID/SKU | `inventoryItemSchema`, `createInventory`, unicidad `(userId,sku)`, normalización a mayúsculas. La búsqueda por nombre no autoriza ni identifica una mutación. |
| Consulta privada y stock | `GET /api/inventory/items`, `listInventory`, 24 por página y filtro por propietario. Ruta real `/dashboard/inventario`. |
| Entrada/salida/ajuste | `POST /api/inventory/items/:id/movements`, `moveInventory`, `applyInventoryMovement`, `inventoryBalance`. Bloqueo del propietario y artículo; saldo y ledger atómicos. |
| Ajuste absoluto y delta | `ADJUSTMENT.quantity` es existencia final. `delta = resultingStock - previousStock`; conservar 8→12 como +4 y 12→7 como -5. |
| Historial persistente | `InventoryMovement` con saldos, delta, actor, motivo, origen y fecha; `GET /items/:id/movements`. No hay endpoint de borrado. Migración existente añade trigger de inmutabilidad. |
| Precio de venta/costo | `ItemCommercialTerms.unitSalePrice` y `referenceUnitCost?`, COP entero BigInt y versión independiente. `GET/PUT /items/:id/commercial-terms`; interfaz `InventoryDetails`. No representan compras reales ni costos por lote. |
| Versiones | `dataVersion`, `stockVersion` y versión comercial. La migración `20261119000000_inventory_batches` contiene triggers de incremento: no añadir incrementos de servicio duplicados sin revisar esos triggers. |
| Clientes y ventas | Customer pertenece a owner; Sale guarda snapshots independientes y SaleLine guarda nombre/SKU/precios/cantidades. No introducir recalculo ni cambios en historial privado. |
| Importación/exportación | Ya existen lote/preview/recibo y exportación bajo Inventario; el importador comercial es independiente y admite resolución por nombre. No trasladar ese criterio a inventario ni modificarlo en este incremento. |
| Archivado operativo | `InventoryItem` no tiene `archivedAt`, `active` ni endpoints para archivarlo. `Customer.archivedAt` y `Product.active` son contratos de entidades distintas. |
| Compatibilidad marca/modelo | Product tiene `brand` y `model`, pero no equivalen a compatibilidades operativas. No hay diseño de compatibilidades en el primer bloque existente. |

Fuentes principales: `catalog-api/prisma/schema.prisma`,
`src/schemas/inventory.schema.ts`, `src/schemas/inventory-batch.schema.ts`,
`src/repositories/inventory.repository.ts`, `src/services/inventory-calculation.ts`,
`src/services/inventory-batch.service.ts`, `src/routes/inventory.routes.ts`,
`src/routes/inventory-batch.routes.ts`, `src/services/inventory-export.service.ts`,
`src/services/product-import.service.ts`, `src/repositories/product.repository.ts`,
`src/repositories/customer.repository.ts`, `src/services/sale-customer.ts` y
`src/middlewares/auth.middleware.ts`. Frontend: `app/dashboard/inventario/page.tsx`,
`components/inventory/InventoryDetails.tsx`, `InventorySheet.tsx`,
`InventoryPublicationPanel.tsx`, `lib/inventory-retry.ts` y scripts relacionados.

## Primer incremento recomendado

El plan pide auditar y estabilizar la base existente antes de ampliarla. Por tanto,
se recomienda **estabilización del inventario tradicional**, no crear otra tabla,
API ni importador: ficha descriptiva/comercial, movimientos manuales, lectura,
estados de carga/error/reintento y pruebas de sus contratos actuales.

Hallazgos de lectura a reproducir antes de corregir:

- El test `verify-inventory-browser.mjs` consulta todos los inputs bajo la sección
  de movimientos. Allí ahora también están `InventoryDetails` y sus formularios;
  los primeros inputs ya no son cantidad/motivo. El fallo «draft must not leak»
  por sí solo no acredita fuga de borradores entre artículos.
- Su doble trata GET de `commercial-terms` como listado de artículos, devolviendo
  `{items,total,page}` donde la UI espera un artículo. Esto explica campos
  indefinidos y puede producir avisos de input controlado. También faltan respuestas
  para catálogos/publicaciones. Actualizar el doble al contrato real antes de
  decidir si hay un defecto de producto; no quitar assertions para ocultar fallos.
- `InventoryDetails` no valida en ejecución la respuesta recibida y no presenta
  un estado de carga explícito. Revisar recuperación de errores y confirmación
  de los valores canónicos después de guardar, sin rediseñar el panel.
- La UI del ledger muestra cantidad absoluta para ajustes; debe distinguirla de
  la variación firmada ya guardada. El contrato existente no debe reinterpretarse.

Los movimientos manuales actuales registran también un ajuste al mismo saldo;
el lote evita ajustes sin delta. Cambiar esa semántica exige revisar la respuesta
e idempotencia de los no-op; no eliminar registros ni inventar un recibo sin
definir el contrato. Probar el caso no significa cambiarlo silenciosamente.

## Alternativas revisadas y límite adoptado

1. **Archivado.** La solicitud pide cubrir artículo archivado, pero el contrato
   de ventas, sección 10, dice «Archivado futuro de un artículo» y «No añadir
   ahora una interfaz de archivado». Alternativas:
   - Recomendada para este incremento: conservar ese aplazamiento, documentar el
     caso como no aplicable al modelo actual y estabilizar la base sin esquema.
   - Incluirlo ahora: aprobar primero semántica de altas, movimientos, ventas
     nuevas y compensaciones históricas; preparar diseño/migración aditiva. No
     reutilizar `Product.active` ni impedir compensaciones antiguas por accidente.
2. **Precio de compra.** La ficha aprobada es costo de referencia opcional; el
   contrato de ventas aclara que no acredita costo real de lotes ni contabilidad.
   Alternativas:
   - Recomendada: conservar `referenceUnitCost` y su etiqueta; no llamarlo compra
     histórica ni crear otra fuente de precio.
   - Compras reales: diseñar primero sus eventos, fechas, costos y correcciones;
     no guardar un historial de compras ficticio copiando la ficha actual.

La selección recomendada no requiere migración. Las alternativas amplias pueden
requerir modelos, índices, restricciones y reglas nuevas; se informará su impacto
antes de prepararlas. Compatibilidades no están diseñadas para este incremento:
si se priorizan, se necesitan ejemplos y cardinalidad antes de definir un modelo.

No se tocó catálogo, stock, ventas, pedidos, historial de clientes, importadores,
datos reales ni archivos de entorno. Tampoco se ejecutaron migraciones ni se
instalaron dependencias. Esta revisión no autoriza commits o despliegues.

## Verificación de referencia

Se ejecutaron las pruebas existentes específicas de inventario, planificación
de lote y snapshots históricos: 22 aprobadas. Son dobles locales; no certifican
concurrencia ni triggers de PostgreSQL. No se añadieron pruebas de una semántica
de archivado o compras que todavía no existe.

Esta referencia corresponde a la base anterior a las correcciones; los resultados
del incremento están al final. El E2E PostgreSQL aplica migraciones: no se ejecutó
ni se usó la BD de entorno real para este diagnóstico.

## Implementación del primer incremento

Se reutilizaron modelos, endpoints, control de versión, triggers y ledger
existentes. El servidor sigue siendo la autoridad; no hay nuevos endpoints,
cambios de JSON público/privado ni nuevos errores de backend. `ADJUSTMENT.quantity`
sigue significando conteo final, no delta. COP sigue siendo entero BigInt;
`referenceUnitCost=null` significa desconocido y nunca se inventa una compra.

Correcciones localizadas:

1. `InventoryDetails` valida en ejecución la identidad solicitada, datos básicos,
   saldos, versiones y ficha comercial recibidos. Una respuesta de listado,
   precio numérico inseguro/negativo o artículo distinto no habilita guardar.
   No confundir esta validación de UI con autorización: esta sigue en backend.
2. La carga muestra un estado explícito, deshabilita formularios y permite
   recargar tras error. AbortController descarta cargas antiguas, también si
   una respuesta ya había terminado de llegar cuando se cambió de artículo.
3. Guardar sincroniza los campos enviados con la respuesta canónica del servidor
   (por ejemplo SKU normalizado). Un bloqueo inmediato por ref evita dobles
   envíos, además del estado visual. Guardar metadatos conserva el borrador
   comercial no enviado; guardar ficha no elimina el borrador descriptivo.
4. El callback del panel solo actualiza la selección si el artículo guardado
   sigue siendo el seleccionado. Una respuesta tardía de B no vuelve a abrir B
   después de que el operador seleccione A. La lista sí se refresca.
5. El historial distingue variación firmada y conteo final, calculados desde
   los saldos históricos guardados: 8→12 muestra +4; 12→7 muestra -5. Ningún saldo
   se recalcula desde productos actuales ni se escribe por mostrar ese texto.
6. Se corrigió el fixture de navegador: ficha devuelve artículo/versiones,
   imágenes/catálogos/publicaciones tienen respuestas propias y el formulario
   de movimiento se identifica por un nombre accesible. Los selectores ya no
   inspeccionan o envían formularios descriptivos por accidente.

No hay cambios de esquema, índices, restricciones, migraciones, dependencias o
variables del producto. La opción `INVENTORY_BROWSER_NO_SANDBOX=1` es únicamente
del script de prueba: usa Chrome headless con perfil nuevo bajo el temporal y
API simulada local. No cambia cookies, proxy, autenticación o navegador del usuario.

### Contratos reutilizados

- `GET/POST /api/inventory/items`: listado propio y alta idempotente por UUID.
- `GET/POST /api/inventory/items/:id/movements`: historial paginado y movimiento
  con UUID de operación. La transacción bloquea propietario y artículo.
- `PATCH /api/inventory/items/:id`: metadatos con versión esperada.
- `GET/PUT /api/inventory/items/:id/commercial-terms`: ficha comercial con su
  versión, costo opcional y precio explícito. No hay endpoint duplicado.

### Casos y límites del incremento

Inexistente/ajeno: 404 desde backend, sin escrituras; claves no conceden acceso.
SKU vacío/excesivo o cuerpo inválido: validación; duplicado propio: unicidad y
conflicto; mismo SKU en otro propietario: permitido. Negativos, fracciones y
desbordamientos de stock/dinero: rechazados. Entrada/salida y ajustes guardan
saldo y movimiento juntos; fallo de escritura revierte el saldo. La misma clave
y contenido recuperan el recibo; un contenido distinto entra en conflicto.
Cliente/historial de ventas no se modificaron y sus snapshots siguen probados.

Un ajuste manual sin cambios conserva el contrato actual de recibo/movimiento
delta cero y su idempotencia; no se reinterpretó como un lote, que evita no-op.
El control de versión comercial/datos y los locks actuales no se cambiaron.
Las pruebas con dobles no acreditan concurrencia/locks/triggers en PostgreSQL.

Artículo archivado no es un estado existente de InventoryItem: no se añadió un
campo ficticio ni se usó Product.active. Archivado, compras reales y
compatibilidades requieren un diseño posterior aprobado; no están implementados
por este incremento. Tampoco se agregó historial de compras o una auditoría
completa nueva de cada edición descriptiva/comercial: se conserva lo existente.

### Archivos modificados

- Backend, solo pruebas: `catalog-api/src/services/inventory.test.ts`.
- Frontend: `catalog-generator/app/dashboard/inventario/page.tsx`,
  `components/inventory/InventoryDetails.tsx`, nuevos `lib/inventory-item.mjs`
  y `lib/inventory-item.d.mts`, `scripts/verify-inventory.mjs` y
  `scripts/verify-inventory-browser.mjs`.
- Documentación: este informe. El historial privado de clientes no se editó.

### Verificación final

Comandos específicos: `node --require ./scripts/test.cjs --import tsx --test
src/services/inventory.test.ts src/services/inventory-batch.test.ts
src/repositories/customer-sales.test.ts`: **25 aprobadas** (11 inventario,
7 planificación/validación existente, 7 historial/snapshots). Se añadieron pruebas
de alta/reintento/SKU duplicado por propietario, +4/−5 y no-op/replay, historia
vacía; se ampliaron validaciones de dinero exacto y SKU.

`node scripts/verify-inventory.mjs`: aprobado, incluyendo respuesta mal formada,
IDs/versiones, cantidades/precios inválidos y conservación de claves pendientes.
Navegador de inventario: **11 etapas aprobadas** con API simulada local, incluyendo
los 7 escenarios previos, errores/reintento de ficha, dos envíos simultáneos,
valores canónicos, dinero grande, borrador comercial conservado, respuesta tardía
de otro artículo y representación de ajustes positivos/negativos.

Comando Windows del navegador: `$env:INVENTORY_BROWSER_NO_SANDBOX='1'; npm.cmd run
test:inventory-browser` (variable solo en el proceso de verificación; no .env).

Suite backend `npm.cmd test`: **332 aprobadas**. Suite frontend `npm.cmd test`:
aprobada. Ambos `npm.cmd run build`: aprobados, incluyen TypeScript. Lint frontend:
sin errores ni avisos nuevos, cuatro advertencias previas `no-img-element` en
componentes públicos. No existe script lint backend ni typecheck independiente.
`test:customer-sales-browser`: 11 grupos aprobados, 36 peticiones al doble y cero
escrituras. `test:order-customers-browser`: 10 grupos aprobados. El historial
aprobado parcialmente permanece sin cambios de implementación.

`test:import-browser` sigue fallando fuera de Inventario: primero `CDP_TIMEOUT:
Page.enable` con sandbox; al reintentar mediante adaptador temporal de proceso
para perfil headless aislado alcanza una assertion antigua de la landing que
espera «Ver un ejemplo» como botón deshabilitado, aunque hoy es un enlace.
No hubo lecturas de API ni importaciones; no se modificó esa prueba o la landing
para convertir artificialmente el resultado en aprobado. No toda la batería de
navegador está verde.

`git diff --check` aprobado y estado final revisado: cinco archivos existentes
modificados y tres nuevos (ocho en total), sin commits. No se modificó ningún
archivo .env, dependencia, contrato de backend o migración.

### Riesgos y siguiente incremento

No se probaron datos reales ni PostgreSQL en esta ejecución. Falta validar locks,
triggers e integridad con dos propietarios en instancia desechable y medir planes
de consulta. No se ejecutó el E2E que aplica migraciones sin una autorización
específica de preparación de esa BD. Este límite no se presenta como prueba real.

Recomendación: aceptar primero este inventario tradicional estabilizado mediante
prueba manual con datos sintéticos. Después elegir explícitamente entre archivado
operativo o compatibilidades y diseñar sus reglas; mantener compras reales como
otra decisión. No comenzar todavía importación masiva, contabilidad, informes,
nuevas operaciones de venta ni cambiar inventario público/histórico.
