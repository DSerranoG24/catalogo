# Inventario: contrato de edición masiva e intercambio de archivos

Versión 1.0 para revisión — 17 de noviembre de 2026. **Diseño y planificación, sin implementación.** Amplía el [contrato de Inventario](inventory.md) y establece dependencias del [contrato de Ventas](sales-contract.md). No autoriza cambios de código, esquema, migraciones, dependencias ni producción.

## 1. Alcance del MVP y compatibilidad

Dos modos sobre los mismos artículos y reglas: tradicional y hoja de cálculo. Incluir tabla editable, pegado de Excel/Google Sheets, importación/exportación XLSX/CSV, vista previa, errores por fila y confirmación explícita. No incluir sincronización con Google Sheets, macros, imágenes, múltiples bodegas, borrado masivo ni sustitución completa del inventario.

El importador de productos del catálogo no se convierte automáticamente en importador de inventario: hoy puede emparejar por nombre y no conserva un recibo durable de aplicación. Esas reglas no son apropiadas para modificar existencias. Solo se evaluará reutilizar lectura protegida, worker, cuotas ZIP/XML, plantilla y componentes de reporte; identidad, validación y persistencia serán específicas de Inventario. No cambiar el contrato del catálogo como efecto colateral.

Los E2E aprobados corresponden al Inventario actual; **no acreditan este diseño futuro**. Las rutas existentes seguirán siendo compatibles y no empezarán a aceptar un saldo editable en el formulario de datos.

## 2. Experiencia tradicional

- Buscar/listar productos y consultar su historial como actualmente.
- Crear artículo con nombre/SKU; saldo inicial cero. Los datos, ficha comercial y movimientos tienen acciones diferenciadas.
- Editar nombre, SKU y mínimo mediante «Guardar datos», con versión esperada. No escribir stock en ese endpoint.
- Editar precio/costo en ficha comercial privada, con su propia versión.
- «Registrar movimiento» mantiene entradas, salidas y ajuste por existencia final contada, con motivo. Muestra saldo anterior, diferencia y saldo final.
- Si cambió una versión, mostrar conflicto y permitir recargar/revisar sin sobrescribir silenciosamente.
- Una misma función transaccional de dominio atiende ambos modos; no mantener dos implementaciones distintas del cálculo de saldos.

## 3. Experiencia de hoja

La tabla ofrece columnas visibles/configurables, cabeceras y SKU fijos, celdas editables, selección rectangular, copiar/pegar y marcas de cambios. `Existencia actual`, ID y versiones son de solo lectura. Editar `Existencia objetivo` es una solicitud de ajuste, todavía sin efecto.

Flujo: **editar/pegar/importar → guardar borrador de lote → validar y previsualizar → revisar → confirmar → recibo**. Nunca guardar inventario al salir de una celda ni al pegar. Separar visualmente «Datos y ficha comercial» de «Conteos de existencias». Antes de confirmar, resumir altas, cambios de datos, cambios comerciales, ajustes positivos/negativos y filas sin efecto.

La vista previa muestra por fila ID/SKU, acción, campos antes/después, saldo anterior, objetivo, delta firmado, motivo y errores. Filtros: nuevas, modificadas, sin cambios, con ajustes, con errores y excluidas. No sumar stock de productos distintos como si fuera un total comercial significativo ni inventar una valorización monetaria.

El informe por fila será consultable y descargable con las mismas protecciones de texto y privacidad de la exportación. Debe identificarse como reporte, no como una plantilla que pueda aplicarse accidentalmente sin volver a mapear/validar sus datos.

Teclado: Tab/Shift+Tab, Enter, edición de celda, selección y pegado; flechas solo navegan celdas cuando no se está editando texto. Esc y deshacer/rehacer actúan sobre cambios pendientes, nunca sobre movimientos ya aplicados. Labels, foco visible, cabeceras y mensajes accesibles. Mantener funciones nativas de copiar/pegar texto cuando corresponda.

En móvil, el modo tradicional será el predeterminado. La hoja usa desplazamiento horizontal, columnas clave fijas y edición ampliada por fila; no comprimir catorce columnas ilegibles. Incluir «Pegar tabla» mediante área de texto como alternativa al portapapeles. No exigir permisos de lectura automática del portapapeles. Vista previa y errores utilizables como tarjetas por fila.

Los cambios locales aún no guardados requieren aviso al navegar; no se promete recuperarlos tras cerrar la pestaña. Un borrador guardado se recupera por `batchId` y sesión real desde servidor. No guardar filas, motivos, precios/costos ni credenciales en localStorage/sessionStorage.

## 4. Formatos y columnas

Formato versionado `INV1`. XLSX: hoja de datos `Inventario`, primera fila de cabeceras; hoja `Instrucciones` opcional y sin filas importables. CSV: UTF-8 con BOM opcional, cabecera, delimitador coma o punto y coma elegido explícitamente; comillas dobles y escapes coherentes, sin adivinar formatos ambiguos. Pegado: TSV, con vista de asignación a columnas y preservación de celdas vacías.

Las cabeceras desconocidas, repetidas o de otra versión se rechazan. No interpretar índices de fila, columnas ocultas o nombres como permisos. ID y versiones son referencias no confiables: el servidor los contrasta con la cuenta autenticada.

Las filas con datos ocultas o filtradas en XLSX también cuentan y aparecen en la preview, con advertencia; no omitirlas ni aplicarlas a espaldas del usuario. La selección efectiva se hace explícitamente en la vista previa de Vitrinaya.

| Columna | Obligación y significado |
| --- | --- |
| `Formato` | En archivos de plantilla: `INV1` o perfil seguro CSV descrito más abajo. En pegado/manual se asigna desde la interfaz, no es una celda comercial. |
| `ID` | Vacío para nuevas filas; UUID propio para identificar inequívocamente un artículo existente. De solo lectura en hoja/exportación. |
| `SKU` | Obligatorio para crear y para identificar existentes sin ID. Si hay ID y está vacío, conservar el SKU existente. Texto, trim y mayúsculas; validar longitud también después de normalizar, según contrato actual. |
| `Nombre` | Obligatorio al crear, máximo 160 caracteres. Vacío en actualización: conservar. |
| `PrecioVentaCOP` | Opcional; pesos enteros no negativos. Vacío: sin ficha nueva o conservar precio existente. `0` es un precio explícito. |
| `CostoRefCOP` | Opcional; pesos enteros no negativos, solo referencia. Vacío no significa costo cero ni borrado. |
| `AccionCosto` | Vacío: asignar si hay costo numérico, conservar si no. Valores explícitos `CONSERVAR`, `ASIGNAR`, `BORRAR`; borrar exige costo vacío y lo deja en `null`. Contradicciones son errores. |
| `ExistenciaMinima` | Entero entre 0 y 2147483647; nueva vacía → 0, existente vacía → conservar. |
| `ExistenciaActual` | Informativa, de solo lectura; nunca se usa como saldo autorizado ni como orden de escritura. |
| `ExistenciaObjetivo` | Opcional, entero entre 0 y 2147483647. Vacío: no tocar existencias. `0`: solicitar conteo final cero. |
| `MotivoAjuste` | De 3 a 300 caracteres cuando hay ajuste; puede heredarse de un motivo general del lote que el usuario revisa antes de confirmar. Sin motivo válido no se aplica. |
| `VersionProducto` | Referencia técnica de los datos del artículo al exportar/cargar. Vacía para altas. |
| `VersionExistencia` | Referencia técnica del saldo/ledger al exportar/cargar. Independiente de la ficha comercial. |
| `VersionFicha` | Referencia técnica de precio/costo. Ausente si todavía no existe ficha. |

Las plantillas contienen las catorce cabeceras. Para archivos externos se ofrece asignación explícita a ese esquema antes de validar. Columnas opcionales no mapeadas se omiten; nunca completar por posición de forma silenciosa. `SKU` y `Nombre` deben poder mapearse; las reglas por fila determinan si su celda es obligatoria.

La pantalla identifica COP expresamente y no convierte moneda. Las columnas externas que no se utilicen deben excluirse de forma visible en el mapeo; no ignorar una columna de moneda o precio adicional sin revisión. Un archivo no puede mezclar versiones/perfiles de escape entre sus filas.

Crear ficha requiere un precio explícito. Costo sin precio y sin ficha previa produce `PRICE_REQUIRED_FOR_TERMS`, no una ficha con precio inventado. Artículos nuevos sin precio pueden existir en Inventario, pero no se podrán vender hasta configurar su ficha.

XLSX exporta ID, SKU, versiones e importes monetarios como texto. SKU numérico o fórmula en XLSX: error; no reconstruir ceros o precisión ya perdidos. Los importes se aceptan como dígitos decimales en texto; también celdas numéricas enteras solo si son seguras y exactas. Los importes grandes deben ser texto. No aceptar separadores de miles, moneda escrita, notación exponencial ni decimales ambiguos. Las cantidades usan enteros acotados y precio/costo respetan el rango BIGINT COP del contrato de Ventas.

No evaluar fórmulas ni contenido HTML; rechazar macros, cifrado, vínculos externos activos, fórmulas y estructuras ZIP/XML peligrosas. Nunca descargar URLs incrustadas para importar.

### CSV seguro y vuelta a importar

Entrecomillar una celda CSV no basta para protegerla al abrirla en una hoja externa. La exportación CSV usa el perfil `INV1_ESC` en `Formato`: ante texto que comienza con apóstrofo, signos de fórmula (`=`, `+`, `-`, `@`) o espacios/controles que los precedan, anteponer un apóstrofo; proteger también SKU numéricos para conservarlos como texto. Un apóstrofo original se duplica. El importador de ese perfil deshace exactamente un escape marcado antes de validar; no quitar apóstrofos indiscriminadamente a archivos `INV1` o pegados normales. El parser nunca evalúa ninguna fórmula.

Probar el ciclo exportar/importar con códigos que empiezan por apóstrofo, ceros y signos. Si Excel/Sheets transformó o perdió contenido, no se reconstruye por suposición: revisar los cambios en la vista previa. XLSX con celdas de texto será el formato recomendado para conservar identidad y precisión; CSV no puede recuperar información que una aplicación externa ya destruyó.

## 5. Identificación y reglas por fila

1. Si hay ID, buscar únicamente dentro del propietario. ID inexistente/ajeno: error genérico, sin buscar otra coincidencia por SKU ni crear otro artículo.
2. Sin ID, buscar SKU normalizado exacto dentro del propietario. Encontrado: actualizar; no encontrado: nueva fila que exige nombre/SKU válidos.
3. No emparejar por nombre, coincidencias parciales, fila de Excel, orden de exportación o categoría.
4. El servidor reserva IDs estables para altas en la vista previa; un reintento de aplicación no genera otros IDs.
5. Cambiar SKU exige ID del artículo y una vista previa explícita «SKU anterior → nuevo». Si el nuevo pertenece a otro artículo, rechazar. Sin ID, un SKU desconocido representa una creación, no un renombrado implícito.
6. IDs repetidos, SKU repetidos o varias filas resueltas al mismo artículo son errores para **todas** las filas implicadas, incluso si sus valores coinciden. Detectar sobre el lote completo, entre páginas y fragmentos de subida. No sumar cantidades ni elegir la última fila.
7. El mismo SKU en otra cuenta es válido y no se informa su existencia. Un nombre compartido no es un duplicado de identidad.
8. Para el MVP no se admiten intercambios de SKU entre dos artículos dentro del mismo lote; no resolver colisiones con borrados ni códigos temporales invisibles.

Vacío significa omitir/conservar en existentes; nunca borrar datos por una celda vacía. Para costo existe `BORRAR`; no hay borrado de nombre/SKU ni eliminación de artículos por ausencia en el archivo. Una fila totalmente vacía se ignora y se contabiliza como vacía; una fila parcialmente rellena inválida se informa, no se pierde.

Clasificación de datos: `NEW`, `MODIFIED`, `UNCHANGED`, `ERROR` o `EXCLUDED`. En paralelo, clasificar existencias como `NO_CHANGE` o `ADJUSTMENT`, con su delta. Una fila puede modificar únicamente ficha comercial, únicamente datos o únicamente existencias. No incrementar versiones ni crear movimientos para valores sin cambio real.

## 6. Existencias: objetivo, delta y ledger

Editar un saldo en la hoja significa proponer una **existencia final contada**, nunca un PATCH directo a `stock`.

```text
delta = existenciaObjetivo − saldoActualValidadoEnServidor
8 -> 12: delta +4; saldo anterior 8, saldo final 12
12 -> 7: delta -5; saldo anterior 12, saldo final 7
```

Se conserva la semántica actual de `ADJUSTMENT`: su `quantity` representa el conteo final no negativo, no la diferencia firmada. Así, el primer caso guarda `quantity=12`, `previousStock=8`, `resultingStock=12` y `delta=+4`; el segundo, `quantity=7`, `previousStock=12`, `resultingStock=7` y `delta=-5`. Mostrar «Ajuste +4» o «Ajuste -5» sin cambiar silenciosamente el significado de la API existente ni permitir cantidades finales negativas.

Cada ajuste nuevo conserva actor autenticado, propietario, fecha de servidor, motivo, `batchId`, revisión/operación aplicada, fila original, artículo y saldos anterior/final. `delta` se calcula en servidor y se contrasta en base de datos; el cliente no lo impone.

Sin objetivo o con objetivo igual al saldo validado: no crear movimiento artificial de cero. Nueva fila: crear con cero; si su objetivo es positivo, crear su ajuste inicial en la misma transacción. El fallo del ajuste revierte también el alta. Los datos y los conteos son intenciones separadas, pero una confirmación que contiene ambas las aplica atómicamente.

Si el saldo o su versión cambian después de la vista previa, **no recalcular y aplicar otro delta silenciosamente**. Marcar el plan obsoleto y exigir otra vista previa. Esto evita que una venta o movimiento manual entre medias sea sobrescrito por un conteo antiguo.

La existencia actual en un archivo exportado es solo informativa. `ExistenciaObjetivo` se exporta vacía para que reimportar un archivo antiguo no restaure automáticamente saldos viejos. Los conteos deben introducirse expresamente en esa columna.

## 7. Vista previa, errores y atomicidad

La validación local mejora la experiencia, pero la vista previa autoritativa la produce el servidor: resuelve identidades, valida propiedad/duplicados/campos, consulta versiones, calcula valores efectivos y clasifica filas. No escribe artículos, ficha comercial ni movimientos. Puede persistir el borrador, plan e informe privado del lote: «sin cambios por errores» se refiere a los datos operativos de Inventario.

Mostrar cada error con fila original, columna, código y explicación accionable. Ejemplos: `SKU_REQUIRED`, `SKU_DUPLICATE_IN_BATCH`, `ID_NOT_FOUND`, `ID_SKU_CONFLICT`, `INTEGER_REQUIRED`, `NEGATIVE_STOCK`, `MONEY_OUT_OF_RANGE`, `REASON_REQUIRED`, `PRICE_REQUIRED_FOR_TERMS`, `STALE_STOCK`, `STALE_ITEM`, `STALE_TERMS`. No devolver SQL, datos de terceros ni filas completas en logs.

**Propuesta de MVP: todo o nada para las filas seleccionadas del lote.** Si hay errores, no habilitar aplicación. El usuario puede corregir celdas o excluir explícitamente filas; ambas acciones crean una revisión nueva y anulan la vista previa anterior. Después debe validar y confirmar nuevamente. No aplicar automáticamente «las válidas» mientras se omiten otras.

El reporte conserva las filas excluidas y no modifica su inventario. Tras aplicar, el lote queda cerrado: corregir y aplicar las excluidas requiere otro lote, no reabrir el anterior. Si no hay cambios efectivos, devolver un recibo de aplicación sin escrituras de negocio ni movimientos.

Los errores de lectura estructural bloquean el archivo completo. Los errores de contenido se reportan por fila; permiten editar/excluir, pero tampoco producen escrituras de negocio. Un conflicto de escritura o validación tardía revierte todo el lote, incluidos cambios de datos y ajustes.

## 8. Operación de lote e idempotencia durable

```text
DRAFT -> READY -> APPLIED
DRAFT -> INVALID -> DRAFT
READY -> DRAFT       (edición o exclusión)
READY -> STALE       (datos/versiones cambiados o preview vencida)
STALE -> READY      (nueva validación y revisión explícita)
DRAFT / INVALID / READY / STALE -> CANCELLED
```

`APPLIED` y `CANCELLED` son terminales. Persistir `batchId`, propietario, revisiones, fuente (`GRID`, `PASTE`, `XLSX`, `CSV`), filas normalizadas, selección, plan/hash, estado, operación de aplicación y recibo. El archivo bruto se procesa localmente y no se conserva en servidor; las filas guardadas son privadas, no se registran en logs ni se comparten por enlaces públicos.

Identidades separadas: `batchId` para la intención de lote, `applyOperationId` para la aplicación preparada, UUID de fragmento para cada edición idempotente y `requestId` para cada transmisión HTTP. Ninguna reemplaza la autenticación ni se reutiliza como clave de una operación de Venta.

- Creación: UUID opaco del lote en URL antes del primer POST; misma cuenta, clave y contenido recuperan el mismo borrador. No usar el hash del archivo como identidad: importar el mismo contenido de nuevo puede ser una intención distinta.
- Subidas/ediciones por fragmentos: cada fragmento tiene UUID y hash canónico; repetirlo devuelve su recibo, no duplica filas ni revisiones. Nueva edición requiere versión esperada. No permitir preview sobre un manifiesto incompleto.
- Preview completa: guarda una revisión inmutable del plan, hash calculado por servidor y `applyOperationId` persistido. Preparaciones idénticas recuperan el mismo resultado; editar invalida el anterior. Vigencia propuesta: 30 minutos, sin tocar datos de negocio al vencer.
- Confirmación: envía solo lote, revisiones/hash y operación preparados; no otro juego de saldos o precios. El servidor vuelve a verificar todo antes de escribir.
- Un lote se aplica como máximo una vez. Restricciones únicas sobre aplicación/filas/movimientos y bloqueo del lote protegen incluso ante dos claves diferentes o dos instancias de API.
- Un reintento exacto recupera el recibo original; un cuerpo incompatible devuelve `409`. El recibo muestra el resultado de ese evento, no afirma que sus saldos siguen siendo los actuales tras otras operaciones.
- Error técnico con rollback: sigue siendo reintentable con el mismo ID. Conflicto de negocio: `STALE`/`INVALID`, sin cambios de Inventario; requiere nuevo plan y confirmación. No reintentar ciegamente con un ID nuevo cuando se perdió la respuesta.
- Recargar consulta `GET` por URL y sesión. Si se perdió la respuesta tras el commit, lote, recibo y movimientos existen juntos. El navegador no reenvía automáticamente al hidratar ni guarda formularios sensibles en almacenamiento local.

La expiración de preview no elimina un recibo ya aplicado ni habilita repetir efectos. No fijar una retención/borrado automático de lotes aplicados o historial en esta fase; los doce meses siguen pendientes.

## 9. Cancelación y cierre de cuenta

Cancelar significa marcar el borrador de lote `CANCELLED`, no eliminar inventario ni deshacer movimientos previos. Está disponible antes de aplicar. Aplicar/cancelar bloquean el mismo lote: si gana cancelar, aplicar no escribe; si el commit ya ocurrió, cancelar devuelve que el lote está aplicado. Abortar un fetch no garantiza cancelación del servidor. Ante respuesta incierta, consultar estado antes de ofrecer otra acción.

Toda mutación, fragmento, preview, aplicación y exportación requiere sesión y propietario. El servidor contrasta cuenta abierta dentro de las transacciones, no solo en el middleware. Si el cierre gana, no se puede aplicar; si la transacción del lote termina antes, queda íntegra y después se revoca acceso. No se ejecutan lotes pendientes automáticamente tras cerrar la cuenta.

No se añade acceso de soporte, borrado de historial ni política de retención. Los informes y exportaciones no contienen credenciales ni datos de compradores. Los costos siguen siendo privados.

## 10. Límites, escalabilidad y exportación

Límites iniciales propuestos para revisión y medición antes de publicar:

| Recurso | Límite MVP |
| --- | --- |
| Filas de datos por lote/archivo/pegado | 500, contando también inválidas/excluidas; sin dividir automáticamente una intención en commits parciales. |
| Columnas de intercambio | 14 del formato; rechazar posiciones/cabeceras extra no mapeadas. |
| XLSX | 5 MiB comprimidos, 20 MiB expandidos, 64 entradas ZIP, 8 MiB por entrada, lectura cancelable de 10 segundos en worker. |
| CSV / pegado | 2 MiB UTF-8; lectura acotada/cancelable, sin cargar contenido ilimitado. |
| Filas normalizadas de lote | 2 MiB como máximo, además de las cuotas de campos. |
| Fragmentos de borrador | Hasta 50 filas y 256 KiB JSON por petición, sujetos al límite menor. |
| Vista/listados | Cursor estable, 50 filas por defecto y máximo 100 por lectura. Mantener la API paginada actual compatible. |
| Exportación | Hasta 10000 artículos o 20 MiB por archivo, con detección de exceso antes de entregar un archivo truncado. |

Máximo inicial de cinco lotes no terminales por cuenta, una aplicación simultánea por lote y cuotas de peticiones por propietario. Propuesta: 60 peticiones de staging/preview/aplicación por 15 minutos y seis exportaciones por 15 minutos, además del limitador global; revisar con mediciones antes de publicar. La corrección entre instancias depende de PostgreSQL, no de un cupo en memoria. Las filas normalizadas y el tamaño total se comprueban también al acumular fragmentos, no solo por petición.

Los fragmentos solo guardan staging: no son lotes de escritura parcial del inventario. La aplicación de hasta 500 filas es un commit, con escrituras por conjuntos y límites de tiempo/bloqueo. Presupuesto objetivo de transacción: 15 segundos, espera de locks 2 segundos; medir con 500 filas y concurrencia. Si el entorno no lo soporta, reducir el límite anunciado antes de publicar o diseñar otro protocolo; no convertirlo silenciosamente en confirmaciones parciales.

El proxy y Express actuales no admiten esos cuerpos de Inventario sin cambios específicos. El diseño exige límites dedicados únicamente a las rutas exactas de fragmentos, conservando Origin antes de leer, el límite global del resto y el rate limiting. No ampliar el JSON global ni debilitar CORS/CSRF.

No descargar todo el inventario al abrir la hoja. Mantener borrador por IDs y no por posiciones visuales; navegar páginas no pierde ediciones guardadas ni aplica filas. El plan valida duplicados globalmente, no solo en la página visible. No se exige virtualización ni una dependencia de grid para el primer MVP; evaluar después de medir la tabla paginada accesible.

Exportar por defecto todo el inventario del propietario; «solo resultados filtrados» debe ser una opción explícita. Nunca exportar solo la página visible sin indicarlo. Obtener datos/versiones de una misma instantánea consistente y acotada en PostgreSQL; generar el archivo fuera de la transacción, sin mantener conexión hasta que el navegador termine de descargar.

Si se supera la cuota de exportación, ofrecer archivos segmentados explícitos por rangos estables/filtros; cada archivo identifica su propia fecha de captura, sin prometer una única instantánea entre archivos. Las exportaciones de más de 500 filas sirven como informe: para reimportarlas, el usuario debe seleccionar grupos explícitos de hasta 500 con preview independiente o solicitar exportaciones para edición de ese tamaño. No aplicar grupos automáticamente. La interfaz debe advertirlo antes de exportar.

Exportación reutilizable: ID, SKU/nombre, ficha comercial, mínimos, saldo **informativo**, versiones y `ExistenciaObjetivo` vacía. Filas omitidas al importar no se borran, desactivan ni ponen a cero. Las columnas técnicas exportadas detectan archivos obsoletos: comparar versiones de componentes que la fila pretende cambiar; sin ellas, el baseline será el de la preview actual que el usuario debe revisar, no el saldo informativo del archivo.

## 11. Endpoints propuestos

Todos bajo `/api`, privados y `no-store`. Borradores y planes identificados por propietario; una clave/URL no es un permiso. Los endpoints de lectura paginan sin devolver archivos ni filas completas ajenas.

| Endpoint | Propósito |
| --- | --- |
| `PATCH /inventory/items/:id` | Solo nombre, SKU y mínimo, con versión esperada. No acepta stock ni campos de movimiento. |
| `GET/PUT /inventory/items/:id/commercial-terms` | Ficha compartida con Ventas, con su propia versión. |
| `POST /inventory/batches` | Crear/recuperar lote por UUID opaco y contenido inicial mínimo. |
| `PATCH /inventory/batches/:id/rows` | Guardar fragmento idempotente, IDs estables de fila y revisión esperada; no cambia Inventario. |
| `GET /inventory/batches/:id` | Estado, revisiones, resumen y recibo; no devolver de golpe 500 filas. |
| `GET /inventory/batches/:id/rows` | Filas/errores paginados y filtros de clasificación. |
| `POST /inventory/batches/:id/preview` | Validación autoritativa del manifiesto completo y creación del plan. |
| `POST /inventory/batches/:id/apply` | Confirmación explícita de la revisión preparada. |
| `POST /inventory/batches/:id/cancel` | Cancelar antes de aplicar, conservando el registro de la operación. |
| `GET /inventory/export?format=xlsx|csv` | Descarga privada bajo filtros/selección/rango y cuotas explícitos. |

El navegador procesa archivos y envía filas normalizadas, no el archivo bruto. Aun así el servidor trata las filas como entrada hostil y valida todos los valores. No enviar miles de campos en query strings ni datos sensibles en URLs. Se pueden generar exportaciones vacías con cabeceras; no inventar filas de ejemplo importables.

Errores: `400` estructura/campos, `401` sesión/cuenta cerrada, `404` ausente o ajeno, `409` revisión/versión/identidad/cancelación incompatibles, `413` cuotas, `429` abuso y `503` fallo técnico reintentable con el mismo ID. Informe por fila y mensaje accesible; no silenciar fallos como cero productos o aplicación exitosa.

## 12. Modelo y ampliaciones previstas — sin migraciones creadas

| Modelo/cambio | Contrato |
| --- | --- |
| `InventoryItem` | Añadir `dataVersion` y `stockVersion` independientes. Nombre/SKU/mínimo modificados incrementan la primera; todo movimiento incrementa la segunda. No reutilizar `updatedAt` para distinguir ambas. |
| `ItemCommercialTerms` | Única ficha uno a uno definida para Ventas, implementada primero en esta ampliación. COP, precio BIGINT, costo opcional y versión comercial. No duplicar precios en otro modelo de importación. |
| `InventoryBatch` | Propietario, UUID/clave, fuente, versiones de formato/borrador/preview, estado, selección/hash, operación preparada, motivo general y fechas. |
| `InventoryBatchRow` | ID estable de fila, número original, presencia/acciones de campos, intención normalizada, artículo resuelto/reservado, versiones base, clasificación, before/after/delta y errores. Solo el servidor fija la resolución. |
| `InventoryBatchChunkReceipt` | UUID de fragmento, hash, revisión original/resultante y respuesta; unicidad dentro del propietario/lote. |
| `InventoryBatchApplication` | Un único recibo durable por lote, operación/hash/revisión aprobada, resultados por fila y IDs de artículos/movimientos. Confirmado junto con datos de negocio. |
| `InventoryMovement` | `delta` firmado calculado, `actorUserId`, origen `MANUAL`/`INVENTORY_BATCH` y futuras fuentes de Ventas, referencias opcionales a lote/fila/aplicación. Nuevos movimientos con actor obligatorio por servicio; históricos sin actor registrado permanecen identificados como desconocidos, no se inventa un actor. |

Migración futura aditiva: versiones iniciales deterministas; delta histórico calculable a partir de snapshots; referencias de lote nullable en filas anteriores; sin copiar saldos del catálogo ni precios/costos ficticios. El actor histórico no puede deducirse con certeza solo del propietario actual. Validar antes de imponer restricciones obligatorias y conservar los CHECK de aritmética existentes.

Unicidades: SKU por propietario; fila estable por lote; recibo de fragmento por lote/UUID; una aplicación por lote; un movimiento por aplicación/artículo cuando hay delta. FKs/validación de propietario impiden vincular lote, fila, artículo, ficha o actor de otra cuenta. Referencias históricas no deben desaparecer por cascadas accidentales; retención sigue pendiente.

## 13. Aplicación transaccional y concurrencia

Orden de locks del lote: propietario `FOR SHARE` y cuenta abierta → namespace de identidad/SKU del propietario para altas/renombrados → lote `FOR UPDATE` → artículos afectados por ID ascendente. La coordinación del namespace será transaccional en PostgreSQL, no un mutex de proceso. Los formularios manuales de altas/edición participarán en la misma coordinación; stock manual no requiere tomar ese namespace, pero sí bloquear su artículo.

1. Recuperar primero un recibo ya aplicado; no aplicar otra vez ni bloquear después del hecho por preview vencida.
2. Comprobar revisión/hash, selección, cancelación, manifiesto y todos los errores.
3. Resolver nuevamente pertenencia, SKU únicos, IDs y versiones de los componentes tocados. Un SKU que apareció desde la preview es conflicto, no actualización automática de otro artículo.
4. Validar el conjunto completo y recalcular en servidor los campos efectivos y deltas. No confiar en valores before/after enviados por el cliente.
5. Escribir solo componentes realmente modificados, crear nuevas filas con sus IDs reservados y ajustes correspondientes, y aumentar las versiones pertinentes.
6. Guardar audit de datos/ficha en las filas del plan/recibo y movimientos para ajustes; ambos tipos de cambios quedan distinguibles.
7. Guardar recibo y estado `APPLIED` en el mismo commit. Cualquier fallo de escritura revierte el conjunto.

Preview obtiene una instantánea coherente; no mantiene locks mientras la persona revisa. Aplicación compara las versiones bajo lock. Todo movimiento manual, lote y futura Venta debe aumentar `stockVersion` dentro de su transacción; toda edición comercial debe aumentar exclusivamente su versión si realmente cambia precio/costo. Una venta o conteo concurrente no puede provocar una sobrescritura silenciosa.

El lote no toma locks de ventas, pedidos o catálogos. Ventas mantiene `User -> Sale -> SaleOperation -> artículos ordenados`; no añadir un camino inverso desde un artículo a una venta. El cierre existente toma `Order -> Catalog -> User`: no invertir ese orden incorporando catálogo/WhatsApp aquí. Los cambios masivos de precio pueden bloquear brevemente una confirmación, pero no cambiar una venta histórica.

## 14. Plan de implementación posterior a revisión

1. **Base de integridad:** versiones separadas, auditoría/delta, ficha comercial compartida, operaciones de lote y migraciones aditivas. Ensayar sobre fixtures anteriores, sin tocar migraciones aplicadas.
2. **Núcleo común:** validación, identidad/SKU, preview, transacción atómica, recibos durables, cancelación y coordinación con formulario tradicional/cierre de cuenta. Probar antes de habilitar escritura desde la hoja.
3. **Dos interfaces:** edición tradicional de datos y ficha, tabla paginada, borradores, pegado, selección, errores y preview accesible.
4. **Intercambio:** perfil XLSX/CSV versionado, cuotas, exportación y pruebas de ida/vuelta con precisión y seguridad. Sin sincronización de Google Sheets.
5. **Aceptación:** pruebas completas y E2E real de ambos modos, dos usuarios y concurrencia. Medir límites antes de publicar. Solo después continuar con Ventas, que consumirá la misma ficha/versiones y núcleo transaccional.

No elegir ni instalar ahora una dependencia de grid, CSV o generación de XLSX. Primero evaluar qué puede reutilizarse de las herramientas existentes sin cambiar reglas del catálogo; cualquier dependencia nueva se justificará por necesidad y mantenimiento.

## 15. Plan de pruebas

**Unitarias:** presencia frente a vacío/cero/borrar costo, límites y normalización SKU, identidad por ID/SKU sin nombre, duplicados entre fragmentos, clasificación y diff por componente, dinero entero exacto, delta positivo/negativo/cero, archivos vacíos/parciales, CSV quoted/multilínea/BOM/separador, escapes reversibles e inyección de fórmulas, XLSX con fórmulas/SKU numérico/ZIP bomb/XML externo/sparse rows/cuotas/cancelación de worker.

**Integración API y PostgreSQL real:** errores sin cambios de negocio; metadata sin movimiento; alta más ajuste atómicos; costo borrado explícito; un recibo/movimiento ante reintentos; misma clave con otro contenido rechazada; cancelar frente a aplicar; cuenta cerrada; IDs/SKU/filas de otra cuenta; fallo en última fila revierte altas, precios y ajustes previos; versiones e integridad histórica; exportación consistente bajo límites.

**Concurrencia:** dos lotes sobre el mismo artículo/SKU; creación y renombrado manual durante preview/aplicación; ajustes manuales y futuras ventas entre preview y confirmación; modificación de precio concurrente; cierre de cuenta; dos instancias aplicando el mismo lote; timeout/deadlock con resultado recuperable y sin commits parciales. SKU ajeno nunca se utiliza para emparejar.

**E2E real:** ambos modos, pegar desde TSV, XLSX/CSV, crear/editar/previsualizar/corregir/excluir/confirmar, duplicados y errores por fila, ajustar 8→12 (+4) y 12→7 (-5), actor/motivo/lote/fecha/snapshots, recarga antes y después del commit y respuesta perdida, exportar/importar sin restablecer stock informativo, selección filtrada y paginación, stock cero/negativo, cancelación, dos usuarios y anchos móvil/escritorio con teclado/foco.

Ejecutar regresiones de Inventario actual, importador del catálogo y contratos de precios de Ventas cuando existan. Los comandos y resultados anteriores no se presentan como pruebas de estas funciones todavía no implementadas.

## 16. Decisiones del diseño a revisar

La ampliación solicitada y la ausencia de sincronización/borrado silencioso están incorporadas. Revisar antes del código: lote atómico de hasta 500 filas, exclusión explícita con nueva preview, identificación estricta por ID/SKU, objetivos absolutos con delta auditado, perfil seguro CSV versionado, exportación informativa separada de conteos, cuotas propuestas y recuperación durable de lotes por URL. No se adopta todavía la retención de doce meses ni se implementa idempotencia adicional de movimientos manuales fuera del lote.
