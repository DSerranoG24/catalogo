# Importación de productos: contrato del backend

La API recibe únicamente JSON para validar, previsualizar y confirmar. El frontend ya dispone de lector, plantilla e interfaz; solo admite `.xlsx` sin macros ni contraseña y rechaza `.xls`, `.xlsm` y formatos no soportados. El archivo no se sube al servidor. El backend de importación no requiere migraciones ni variables nuevas.

## Rutas y límites

Ambas rutas exigen la autenticación privada existente y pertenencia al catálogo:

```text
POST /api/products/catalog/:catalogId/import/preview
POST /api/products/catalog/:catalogId/import/confirm
```

Solicitud:

```json
{
  "totalRows": 1,
  "rows": [
    {
      "rowNumber": 2,
      "name": "Vela ámbar",
      "sku": "VELA-001",
      "price": 25000,
      "stock": 10,
      "categoryName": "Artesanía"
    }
  ]
}
```

Cada petición contiene de 1 a 50 filas. En la API, `totalRows` es el total de filas incluidas en el plan, entre 1 y 500: excluye filas rechazadas localmente y debe mantenerse igual en todos sus lotes. En el resultado del lector, `totalRows` cuenta todas las filas no vacías del archivo, incluidas las rechazadas; no se copia directamente al plan. `rowNumber` conserva el número de fila Excel (desde 2, después de la cabecera); no puede repetirse en una petición. Hay un límite de 2 MiB exclusivamente en estas rutas, después de autenticar. El parser JSON global permanece en 32 KB. Solo se acepta `application/json`: el archivo nunca se transmite.

La respuesta contiene `requestId`, `rows` (acción, código, motivo, campos inválidos si procede y producto afectado) y `summary` con `new`, `updates`, `errors`, `notProcessed`. HTTP 200 significa que se devuelve el reporte, no que todas las filas se escribieron. Envelope inválido o más de 50 filas: 400; catálogo ajeno/inexistente: 404; archivado o vista previa inválida/caducada: 409; exceso de tráfico: 429; contenido incorrecto: 415; exceso de bytes: 413. Un fallo general antes de procesar devuelve 503 sin detalles internos.

## Vista previa completa y conflictos entre lotes

1. Leer Excel en el navegador, normalizar los tipos de celda y contar como máximo 500 filas de datos. No enviar archivos ni imágenes.
2. Enviar lotes secuenciales de hasta 50 filas a `/preview`, con el mismo `totalRows`. El primero no lleva `previewToken`; los siguientes llevan el token devuelto por el lote anterior.
3. La respuesta incluye `ready`, `fileSummary` y `invalidatedRows`. Una fila posterior puede entrar en conflicto con una anterior: la UI debe marcar ambas como errores, no solo la última.
4. No habilitar confirmación hasta que `ready` sea `true` y se haya mostrado el resumen final. Enviar a `/confirm` los lotes originales de hasta 50 filas, todos con el **último** `previewToken` completo y el mismo `totalRows`.
5. Agregar los reportes de confirmación por número de fila. No contar dos veces una respuesta reintentada. Una importación de 300 filas requiere seis peticiones de escritura; las seis peticiones de vista previa son adicionales y no escriben productos.

El comprobante contiene el plan completo de hasta 500 filas y vence a los 30 minutos desde la primera vista previa. Usa HMAC SHA-256 con separación de dominio y el secreto de autenticación existente; no crea credenciales ni variables nuevas. Se vincula al usuario, catálogo, contenido normalizado de cada fila, productos/categorías y sus versiones. No contiene los textos de las celdas: usa hashes para detectar cambios y colisiones del archivo. No se debe registrar el token. No es un JWT de sesión ni reemplaza la autenticación.

Esto permite detectar duplicados **entre lotes** sin una tabla temporal ni un proceso en memoria que se perdería al reiniciar o escalar. Modificar filas ya previsualizadas requiere comenzar una nueva vista previa. La confirmación rechaza un plan incompleto, cambiado, de otro usuario/catálogo o caducado.

## Emparejamiento

- SKU: quitar espacios exteriores, conservar mayúsculas. Se busca exclusivamente dentro del catálogo. No convertir números a SKU: Excel puede haber perdido ceros o precisión; la plantilla debe usar celdas de texto.
- Si el SKU coincide, se actualiza ese producto, aunque cambie el nombre.
- Si el SKU no coincide pero el nombre sí, se actualiza el producto y se asigna el SKU de la fila. No se crea un duplicado. La regla no se limita a los productos cuyo SKU estaba vacío.
- Si no hay SKU, se busca por nombre.
- Nombre y categoría: normalización Unicode NFC, espacios exteriores eliminados y comparación sin distinguir mayúsculas, **conservando acentos**. `Té` y `Te` son distintos.
- Ninguna coincidencia: crear. Más de una: error, nunca elegir la primera.
- Filas que apuntan al mismo ID, repiten SKU o usan una misma identidad por nombre que podría crear/actualizar el mismo producto son conflictos del archivo. Se rechazan las filas implicadas. Productos distintos identificados por sus SKU existentes pueden compartir nombre, conforme al modelo actual.
- La categoría se resuelve por nombre al ID existente del catálogo. Desconocida o ambigua: error de fila. No se acepta un `categoryId` enviado por Excel ni se crea una categoría automáticamente. Se conserva el comportamiento privado existente respecto a categorías inactivas; asociarlas no las reactiva.

## Celdas vacías y columnas

Celda vacía significa campo omitido, `null`, cadena vacía o texto compuesto solo por espacios. **Cero y `false` no son celdas vacías.** Las cadenas se recortan y normalizan a NFC. Se reutilizan los esquemas de producto y `validateProductPromotion`; no se evalúan fórmulas ni se interpretan HTML o URLs de imágenes.

| Campo JSON | En creación | En actualización cuando está vacío |
|---|---|---|
| `name` | Obligatorio, hasta 150 caracteres | Error: sigue siendo obligatorio para identificar/previsualizar |
| `price` | Obligatorio, entero no negativo | Conservar precio existente |
| `stock` | Vacío: 0; entero no negativo | Conservar inventario; `0` lo fija explícitamente a cero |
| `sku` | Vacío: sin SKU | Conservar SKU y emparejar por nombre |
| `brand`, `model` | Vacío: sin valor; máximo 100 cada uno | Conservar |
| `description` | Vacío: sin valor; máximo 2000 | Conservar |
| `categoryName` | Vacío: sin categoría; máximo 100 | Conservar asociación |
| `salePrice`, `saleStartsAt`, `saleEndsAt` | Vacío: sin promoción; si hay oferta se exige el conjunto válido | Conservar cada valor existente y validar el resultado combinado |
| `saleEnabled` | Ausente: deducir de los datos de promoción; `true` exige oferta válida | Vacío: no cambiar. `false` sin datos de oferta tampoco borra la promoción existente |

`saleEnabled: false` junto con valores de oferta es contradictorio y produce error. Desactivar o vaciar una promoción existente se hace desde el panel, no mediante celdas vacías. `saleEnabled: true` sin oferta completa nueva o existente es error. Fechas: texto ISO 8601 con zona/offset. El lector rechaza fechas numéricas y no las convierte automáticamente, evitando interpretaciones ambiguas de formato o zona horaria. Precio, oferta e inventario no superan el máximo INTEGER de PostgreSQL (2147483647).

No se aceptan `id`, `catalogId`, `userId`, `slug`, `active`, `specs`, archivos, imágenes ni columnas extra. `saleEnabled` es el control del formulario y no se almacena. Los productos inactivos pueden actualizarse, pero no se reactivan. Un catálogo inactivo no archivado puede editarse como en el panel privado; un catálogo archivado rechaza importación. Nada en este flujo borra productos, categorías o imágenes.

El slug se genera solo al crear: minúsculas ASCII sin acentos, separadores `-`, base de hasta 130 caracteres; si queda vacía se usa `producto`. Si está ocupado se prueba `base-2`, `base-3`, etc., bajo bloqueo del catálogo. Al actualizar se conserva el slug existente y las imágenes permanecen intactas.

## Concurrencia y confirmación

Cada fila confirmada abre una transacción propia. Primero bloquea la fila del catálogo autorizado con `SELECT ... FOR UPDATE`, vuelve a comprobar archivado, repite el emparejamiento y valida categoría, campos y promociones. Compara el plan firmado con el estado actual (incluidos hashes de valores y versiones): si cambió la acción, producto o categoría, devuelve error de fila y exige otra vista previa. No aplica silenciosamente una creación como actualización ni sobrescribe cambios posteriores a lo mostrado al vendedor.

Solo después escribe. El bloqueo se conserva hasta commit/rollback. Las altas, ediciones y bajas **manuales** de productos y categorías también participan en ese bloqueo. Fue necesario ajustar esos repositorios: bloquear únicamente el importador dejaría una carrera con el formulario manual. No cambia su regla de visibilidad ni su API. Las restricciones únicas existentes de SKU y slug siguen actuando como última defensa.

El mecanismo coordina las escrituras de esta API entre instancias; SQL externo u otros programas que escriban directamente sin adquirir el bloqueo no participan. No se añadió unicidad por nombre ni se modificó el esquema.

El timeout de transacción por fila es 3 segundos, espera de conexión 1 segundo, `lock_timeout` local 1 segundo y `statement_timeout` local 2,5 segundos. Se procesa secuencialmente, sin 50 promesas de escritura simultáneas. Cada lote tiene un presupuesto de 15 segundos: al agotarse se informa `not_processed` para las filas que aún no comenzaron. La fila en curso puede añadir su tiempo limitado al presupuesto.

## Fallos y reintentos

Un error de validación o escritura revierte únicamente la fila actual y se informa su motivo; las siguientes continúan mientras quede presupuesto. Lo ya confirmado, tanto en este lote como en anteriores, permanece guardado. No se captura SQL fallido para continuar en la misma transacción abortada.

No hay registro durable de ejecución ni promesa de recibo idempotente de importación. Si se pierde la conexión, puede haber filas confirmadas aunque el navegador no reciba su reporte. No reenviar ciegamente el mismo comprobante: las versiones/acciones ya cambiadas se rechazan sin crear duplicados. Volver a previsualizar las filas cuyo resultado se desconoce antes de confirmar de nuevo. La nueva clasificación encontrará los productos creados en lugar de duplicarlos.

## Abuso e integración con el frontend

Además del límite global, ambas rutas comparten 60 peticiones por 15 minutos y usuario/catálogo, una petición activa por usuario y hasta cuatro activas por instancia. El cupo no se libera por desconexión del cliente mientras el trabajo del handler sigue activo. Son límites de proceso como los limitadores existentes; la seguridad de concurrencia entre instancias proviene del bloqueo PostgreSQL. Los errores nuevos se registran solo con evento, requestId y código seguro, nunca filas, tokens, URLs o excepciones Prisma completas.

La fase 3A incorpora el lector local `.xlsx` con cuotas, plantilla y excepción de 2 MiB en las dos rutas exactas POST JSON del proxy. El resto de JSON del proxy conserva 64 KiB y Origin se comprueba antes de leer. Las dependencias autorizadas están fijadas: `read-excel-file: 9.3.12` y `fflate: 0.8.3`. El contrato de lectura, los límites y las comprobaciones están en `catalog-generator/docs/product-import-reader.md` (desde la raíz del repositorio).

La interfaz del workspace incluye previsualización secuencial, propagación de `invalidatedRows`, reporte por fila y confirmación explícita. Detención, resultados desconocidos, reintentos, accesibilidad y aviso previo de formato están documentados en [interfaz](../catalog-generator/docs/product-import-ui.md). La mejora posterior amplía solo el contrato local del lector con `rejectedRows`, sin cambiar este contrato de API.

La documentación OpenAPI generada tiene cobertura parcial: el contrato de estas rutas vive aqui. El cierre previo de la verificación PostgreSQL del backend se conserva en el [historial](historial/2026-10-25-verificaciones.md). Comandos y límites actuales: [matriz de pruebas](testing.md).
