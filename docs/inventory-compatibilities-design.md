# Compatibilidades de Inventario ampliado — diseño para aprobación

Fecha: 24 de noviembre de 2026. **Estado: propuesta, no implementada.**
La estabilización anterior queda cerrada según la validación desplegada comunicada
por el propietario. Esta propuesta no modifica código, Prisma, OpenAPI, datos,
migraciones ni despliegues. No autoriza ejecutarlos.

## 1. Alcance y decisiones recomendadas

Registrar afirmaciones explícitas de compatibilidad entre un artículo/accesorio
y modelos de dispositivos identificados por UUID, dentro de la cuenta del vendedor.
Un artículo puede tener varias relaciones y alcanzar marcas distintas a través
de los modelos seleccionados. La marca de fabricación del accesorio y las marcas
de dispositivos compatibles son conceptos independientes.

Recomendaciones para aprobar:

1. Diccionario de marcas/modelos **por propietario**, no un maestro global compartido.
2. Identidad persistente por UUID; nombres normalizados y alias sirven para resolver
   candidatos, nunca para confirmar una relación ni sustituir al identificador.
3. Una fuente operativa por artículo de inventario, compartida por sus publicaciones.
   Productos de catálogo sin inventario pueden tener un conjunto propio, separado.
4. Estados `PENDING`, `VERIFIED`, `REJECTED`, `WITHDRAWN`; la confirmación es explícita.
   Una equivalencia entre dispositivos nunca propaga automáticamente una relación.
5. Primera entrega privada, sin alterar precio, stock, pedidos, ventas o catálogo
   público. Publicación de compatibilidades, importación y equivalencias se dividen
   en incrementos posteriores con aprobación propia.
6. Migración aditiva vacía; no inferir relaciones desde `Product.brand`, `model`,
   nombres, descripción, SKU, códigos de barras o `specs`.

Fuera de alcance: compras reales, contabilidad, cambios de política de inventario,
archivado de InventoryItem, fusiones de productos/modelos y nuevas funciones de
venta. «Verificado» significa revisado por ese vendedor, no certificación de fabricante.

## 2. Evidencia del repositorio y consumidores

Git estaba limpio antes de redactar este documento. Se inspeccionaron el plan
[del siguiente bloque](inventory-expanded-next-phase-plan.md),
[Inventario](inventory.md), [Ventas](sales-contract.md),
[listado de productos](product-list.md), [importación](product-import.md) y
los contratos/esquemas actuales. Los documentos históricos que describen Ventas
como futura no sustituyen al código ya implementado ni justifican reimplementarlo.

| Componente actual | Evidencia y consecuencia |
| --- | --- |
| `InventoryItem` | ID, `userId`, nombre, SKU, stock y versiones. Unicidades `(id,userId)` y `(userId,sku)`. Sin marca/modelo normalizados ni compatibilidades. |
| `Product` | `brand` y `model` son strings opcionales; SKU opcional único por catálogo. Tiene `specs` JSON y `inventoryItemId` opcional. Unicidad `(id,catalogId)`; el propietario se obtiene mediante Catalog. |
| `InventoryPublication` | Vincula artículo/producto/catálogo del mismo propietario mediante claves compuestas. Permite publicar el mismo inventario en distintos catálogos. No hay reglas de compatibilidad. |
| Editor comercial | `CatalogProductEditor.tsx` y `CatalogWorkspace.tsx` editan/copían marca/modelo descriptivos como texto; copiar sugerencias o consultar código de barras no verifica que un accesorio encaje. |
| Búsqueda comercial | `product-list.repository.ts`: q busca nombre/SKU/marca/modelo de texto. El esquema privado es estricto; no admite filtros nuevos hasta ampliar su contrato. |
| Búsqueda de inventario | `inventory.repository.ts`: q busca nombre o SKU del propietario. Identidad de escritura por ID, nunca por resultado textual. |
| Catálogo público | `catalog.repository.ts` selecciona brand/model; no existe DTO dedicado de compatibilidad. Mantener sus significados actuales. |
| Importadores | El importador comercial conserva marca/modelo de texto y puede emparejar productos por nombre; el de inventario resuelve ID/SKU. No reutilizar el emparejamiento comercial para compatibilidades. |
| Venta histórica | `SaleLine` guarda nombre, SKU, precio, costo, cantidad y totales. El comprador tiene sus snapshots propios. No recalcular ni incorporar el diccionario vivo a esos campos. |

No se encontró un modelo, endpoint o servicio dedicado a compatibilidades de
dispositivos. La palabra «compatibilidad» en temas visuales o formatos de archivo
corresponde a otro dominio. `specs` podría contener textos cargados por usuarios:
sin consultar datos reales no se afirma que estén vacíos ni que estén estructurados.

La validación operativa normaliza SKU con trim/mayúsculas y máximo 80 caracteres;
Product acepta hasta 100 y su importador recorta conservando mayúsculas existentes.
No hay normalización de identidad de marca/modelo compartida por esos flujos.
No unificar ni reescribir estos SKU durante esta migración. EAN/UPC/GTIN del lookup
describe mercancía, no una identidad de dispositivo ni una prueba de encaje.

Fuentes de código: `catalog-api/prisma/schema.prisma`,
`src/schemas/product.schema.ts`, `product-list.schema.ts`, `product-import.schema.ts`,
`src/repositories/product.repository.ts`, `product-list.repository.ts`,
`catalog.repository.ts`, `inventory.repository.ts`,
`src/services/inventory-publication.service.ts`, `inventory-batch-plan.ts`,
`product-import.service.ts`; frontend `components/inventory/InventoryDetails.tsx`,
`InventoryPublicationPanel.tsx`, `components/products/CatalogProductEditor.tsx`,
`components/catalogs/CatalogWorkspace.tsx` y `app/api/product-lookup/route.ts`.

## 3. Identidad de marcas, modelos y alias

### Normalización conservadora versionada

Guardar etiqueta legible original recortada y una clave `normalizationVersion=1`:
Unicode NFC, trim, colapso de espacios y conversión a minúsculas con una regla
determinista común al backend. Rechazar controles, NUL y caracteres invisibles de
formato; no eliminarlos silenciosamente. Normalizar otra vez al validar en servidor.
Usar una conversión de minúsculas independiente de la configuración regional del
proceso y limitar también la clave resultante (máximo 320 caracteres). No delegar
la identidad exclusivamente a una collation o a `ILIKE` de PostgreSQL.

No eliminar acentos, guiones, signos `+`, números, códigos regionales, capacidades
ni sufijos 4G/5G/Pro. No deducir que `A58`, `A58 5G` y `A58 Pro` son lo mismo.
No cambiar las reglas actuales de SKU, cuyo propósito es identificar mercancía.
Un cambio futuro de normalización requiere análisis de colisiones y migración,
no recalcular claves publicadas durante un despliegue ordinario.

Cada marca y modelo tiene un nombre canónico y cero o más alias, representados
en **la misma tabla de nombres** de su clase. Así un alias no puede colisionar
con el nombre canónico de otra entidad en ese espacio. No basta con poner una
unicidad separada en una tabla de alias y otra en la tabla principal.

- Marca: namespace `(ownerId, normalizedKey)`.
- Modelo: namespace `(ownerId, brandId, normalizedKey)`.
- `A58` puede existir en distintas marcas y cuentas. Dentro de una marca, las
  variantes realmente distintas requieren nombres canónicos calificados, por
  ejemplo `A58 4G — CPHxxxx` y `A58 5G — variante regional` si esos datos se conocen.
  No inventar códigos ni variantes para completar el registro.
- Un alias puede resolver exactamente un modelo dentro de su marca. Si `A58`
  resulta ambiguo, se deja como término de búsqueda que presenta candidatos,
  no como alias que elige una variante por defecto.
- Una coincidencia aproximada solo ordena sugerencias; el vendedor selecciona ID.
  Incluso un alias exacto no crea ni verifica compatibilidades automáticamente.

El ejemplo de Oppo y Realme se modela con una marca y sus modelos por cada lado,
y una relación explícita por cada modelo seleccionado. No se afirma aquí cuáles
son compatibles en realidad ni que todas las variantes Oppo A58 compartan piezas.

## 4. Modelo lógico propuesto

Nombres orientativos para Prisma, sin cambiar aún `schema.prisma`. IDs nuevos
UUID opacos; el tipo SQL debe coincidir con las claves TEXT existentes del proyecto,
sin convertir ahora todas las claves a PostgreSQL UUID.

| Entidad nueva | Campos relevantes y propósito |
| --- | --- |
| `DeviceBrand` | `id`, `ownerId`, `version`, `retiredAt?`, `createdAt`, `updatedAt`, `createdById`, `updatedById`. Identidad de marca de destino. |
| `DeviceBrandName` | `id`, `ownerId`, `brandId`, `label` (1–100), `normalizedKey`, `normalizationVersion`, `isCanonical`, `retiredAt?`, fechas. Incluye canónico y alias; cambios protegidos por versión de la marca. |
| `DeviceModel` | `id`, `ownerId`, `brandId`, `manufacturerCode?` (máx. 100), `manufacturerCodeKey?`, `version`, `retiredAt?`, fechas/actores. Identifica un modelo/variante concreto, no el accesorio vendido. |
| `DeviceModelName` | `id`, `ownerId`, `brandId`, `modelId`, `label` (1–160), `normalizedKey`, `normalizationVersion`, `isCanonical`, `retiredAt?`, fechas. Namespace dentro de marca; cambios protegidos por versión del modelo. |
| `CompatibilitySet` | `id`, `ownerId`, `kind`, `inventoryItemId?`, `productId?`, `catalogId?`, `version`, `retiredAt?`, fechas/actores. Cabecera privada de una única fuente operativa. Se crea solo al confirmar la primera escritura. Su retirada se reserva para una transferencia legacy explícita, no un borrado de historia. |
| `ItemCompatibility` | `id`, `ownerId`, `setId`, `modelId`, `status`, `version`, `evidenceType?`, `evidenceReference?` (máx. 500), `note?` (máx. 1000), `reviewReason?` (máx. 500), `verifiedById?`, `verifiedAt?`, fechas/actores. Una relación durable por conjunto/modelo. |
| `CompatibilityOperation` | `ownerId`, `operationId`, `resourceKind`, `resourceId`, `requestHash`, `responseSnapshot`, `createdAt`. Recibo idempotente terminal de mutaciones exitosas; no guarda credenciales. |
| `CompatibilityEvent` | `id`, `ownerId`, `operationId`, `entityKind`, `entityId`, `actorId`, `eventType`, `before`, `after`, `occurredAt`. Auditoría inmutable de diccionario, alias, conjuntos y relaciones. |

No añadir marca del accesorio a InventoryItem como efecto colateral. Los nombres
de destino normalizados no reemplazan `Product.brand/model`. Si se desea normalizar
también el fabricante del accesorio, eso exige otro contrato explícito.

### Claves, restricciones e índices

- Todas las entidades principales: UNIQUE `(id,ownerId)` y FK owner→User.
- Modelo→Marca mediante `(brandId,ownerId)`; nombres de modelo mediante FK
  `(modelId,ownerId,brandId)` a UNIQUE `DeviceModel(id,ownerId,brandId)`.
  Nombre de marca→Marca mediante `(brandId,ownerId)`. Actores y verificadores
  referencian User con RESTRICT; el servidor impone el actor de la sesión.
- Nombres: unicidades de namespace indicadas arriba, incluyendo nombres retirados:
  retirar un alias no lo libera para reasignarlo a otro dispositivo por accidente.
- Índice único parcial: un nombre canónico activo como máximo por marca/modelo.
  Al confirmar una mutación debe existir exactamente uno para cada entidad activa;
  validación transaccional y constraint trigger diferible si se exige también en BD.
  Prisma no representa todos estos CHECK/índices/triggers: documentarlos en SQL.
- Código fabricante: único por propietario/marca cuando no sea null. Su ausencia
  no permite deduplicar por parecido. Cadena vacía se normaliza a null.
- Set: UNIQUE `inventoryItemId` y UNIQUE `productId`; CHECK de sujeto exclusivo:
  `INVENTORY_ITEM` exige inventario no null y producto/catálogo null;
  `CATALOG_PRODUCT` exige producto y catálogo no null e inventario null.
- Set→InventoryItem mediante `(inventoryItemId,ownerId)`→`(id,userId)`.
  Set→Product mediante `(productId,catalogId)`→`(id,catalogId)` y Set→Catalog
  mediante `(catalogId,ownerId)`→`(id,userId)`. No añadir un ownerId redundante
  obligatorio a todos los Product anteriores solo para esta relación.
- Relación: UNIQUE `(setId,modelId)` incluso retirada/rechazada; FKs compuestas
  `(setId,ownerId)` y `(modelId,ownerId)` impiden mezclar cuentas en PostgreSQL.
- Recibo: PK/UNIQUE `(ownerId,operationId)`; hash de contenido normalizado incluye
  acción, ruta, IDs, versiones y campos, excluyendo metadatos de transporte.
- Evento: FK compuesta a su recibo; UNIQUE `(ownerId,operationId,entityKind,entityId)`
  para no duplicar eventos de una entidad en el mismo comando. `before/after`
  incluye identidad/etiquetas/estados del momento; un rename posterior no los rehace.
- Índices de lectura: nombres por namespace y prefijo; modelos `(ownerId,brandId,id)`;
  relaciones `(ownerId,modelId,status,setId)` y `(ownerId,setId,status,id)`;
  eventos `(ownerId,entityKind,entityId,occurredAt,id)`. Evaluar planes en base aislada
  antes de sumar trigramas, índices sobre JSON o extensiones.
- No DELETE CASCADE de conjuntos, relaciones, recibos ni eventos. FKs RESTRICT;
  triggers de inmutabilidad de eventos/recibos. No fijar retención automática.
- `ownerId`, sujeto del set y `DeviceModel.brandId` son inmutables. Corregir una
  identificación de modelo usada requiere crear el destino correcto y revisar
  explícitamente las relaciones; no moverlas ni fusionarlas por un rename.

En el MVP, un rename con **otra clave normalizada** de un modelo ya referenciado
se rechaza como `DEVICE_IDENTITY_IN_USE`; lo mismo para una marca que ya tenga
modelos. Se admiten correcciones de presentación que mantengan la clave. Para
cambiar sustancialmente un nombre usado, ofrecer revisión de impacto en una fase
posterior o crear el destino correcto y retirar relaciones anteriores expresamente.
Así no se puede transformar una verificación de A58 en una de A18 cambiando su
etiqueta. Añadir un alias exige declarar que nombra la misma identidad, se audita
y no mueve la relación; no sustituye a esa revisión de identidad.

### Por qué una cabecera de conjunto

Centraliza ownership, versión de la colección y lógica de relaciones para artículos
y productos históricos, evitando dos motores de compatibilidad. Sus dos tipos de
sujeto se protegen mediante FKs y CHECK, no mediante un `entityId` polimórfico sin FK.
En la primera entrega basta el sujeto INVENTORY_ITEM; el segundo se habilita después
con sus consumidores y pruebas de ciclo de vida completos.

## 5. Fuente única, publicaciones y productos anteriores

Resolución de compatibilidades efectivas de Product:

1. Si `inventoryItemId` existe y pertenece al mismo propietario que su catálogo,
   usar exclusivamente el set de ese InventoryItem. No copiar relaciones al publicar.
2. Si no tiene inventario, usar su set CATALOG_PRODUCT, cuando ese incremento exista.
3. Sin set/relaciones: **«Compatibilidades no declaradas»**, nunca «universal» ni
   «incompatible con todo». El producto puede seguir vendiéndose/publicándose con
   sus reglas actuales. Tener solo pendientes/rechazos no constituye compatibilidad.

Publicaciones de un mismo artículo comparten hechos operativos; título, descripción,
precioOverride y estado de publicación conservan su contrato. No se permiten
overrides contradictorios de compatibilidad por catálogo en esta propuesta.

Un producto vinculado no puede tener un set directo activo adicional. La integridad
entre tablas requiere validación del servicio y constraint triggers que comprueben
Set y Product ante cambios de vínculo, en transacción y con bloqueo compatible.
Un CHECK local no basta para consultar otra tabla.
«Activo» en un set significa `retiredAt=null`; no equivale al estado de sus filas.
Un set retirado solo permite lectura de auditoría y no aporta relaciones efectivas.
No ofrecer retirar/reactivar conjuntos arbitrariamente en el primer incremento.

El flujo inspeccionado `publish` crea un Product nuevo vinculado; no migra productos
existentes. Por ello el primer incremento de inventario no necesita inventar una
pantalla de «enlazar producto antiguo». Si se implementa ese enlace posteriormente:

- Si hay compatibilidades propias, exigir previsualización del destino y resolución
  explícita de cada conflicto; rechazar el enlace hasta terminar esa revisión.
- No unir sets automáticamente, descartar rechazos ni convertir pendientes en
  verificados. Preservar todos los eventos y la procedencia del set anterior.
- La migración/transferencia será un comando separado aprobado; no habilitarlo
  aceptando `inventoryItemId` arbitrario en los schemas actuales de Product.
  El set de origen se conserva retirado y con sus filas/eventos intactos; no se
  cambia su sujeto ni se rehabilita al desvincular el producto. Copias revisadas
  al destino registran los IDs de procedencia en los eventos del comando.

Impacto de ciclo de vida a aprobar: un Product/Catalog que ya tenga set/auditoría
no puede borrarse físicamente por cascada. Adaptar sus servicios de eliminación
para devolver 409 `COMPATIBILITY_HISTORY_EXISTS`, con alternativa de desactivar el
producto mediante el flujo vigente. Productos sin set conservan sus condiciones
de borrado actuales. No habilitar sujetos CATALOG_PRODUCT hasta cubrir este impacto;
no ocultar una FK nueva como un 500 ni inventar archivado operativo de inventario.

## 6. Estados, evidencia y trazabilidad

| Estado | Significado | Tratamiento |
| --- | --- | --- |
| `PENDING` | Relación propuesta, aún no revisada. Predeterminado. | Visible en gestión privada; excluida del resultado «compatible verificado». |
| `VERIFIED` | El vendedor revisó expresamente ese artículo y variante. | Exigir evidencia/tipo de comprobación; actor/fecha del servidor. No certifica al fabricante. |
| `REJECTED` | La propuesta fue descartada por revisión. | Motivo obligatorio. No significa incompatibilidad universal ni se borra para volver a sugerirla. |
| `WITHDRAWN` | La afirmación se retiró o era un alta errónea. | Motivo obligatorio; historial preservado. Se distingue de un rechazo técnico. |

Evidencia inicial: enum `SELLER_TEST`, `MANUFACTURER_REFERENCE`,
`SUPPLIER_REFERENCE`, `DOCUMENTED_REVIEW`, con referencia/nota breve obligatoria
al verificar. Una referencia puede ser un código/documento o URL HTTPS, pero el
servidor no la descarga: no añadir SSRF, scraping ni subida de archivos en este MVP.
Tratarla como texto; escapar al renderizar y no publicar enlaces/notas por defecto.

Transiciones propuestas: PENDING→VERIFIED/REJECTED/WITHDRAWN;
VERIFIED→PENDING/REJECTED/WITHDRAWN; REJECTED/WITHDRAWN→PENDING mediante revisión
explícita. No rehabilitar una relación rechazada con una nueva inserción ni pasar
directamente REJECTED→VERIFIED sin dejar el nuevo ciclo de revisión.
Toda transición a VERIFIED requiere una acción explícita con nueva evidencia.
Verificación vigente solo en VERIFIED; al salir, los campos vigentes verifiedAt/By
se limpian, pero sus valores anteriores permanecen en el evento inmutable.

Recomendación: alta siempre PENDING, incluso si el vendedor conoce el resultado;
verificar es un segundo comando. Modificar evidencia de una VERIFIED la devuelve
a PENDING; no editar silenciosamente el respaldo de una afirmación vigente.
Si en ese mismo cambio de evidencia se intenta mantener VERIFIED, rechazar la
combinación: primero actualizar en PENDING y después volver a verificar. Cambiar
una nota interna que no es evidencia no modifica por sí solo el hecho verificado,
pero sigue quedando versionado y auditado.

Marcas/modelos pueden retirarse sin borrar su historia: impide nuevas asignaciones
y los excluye de compatibilidades efectivas/publicables. La UI distingue relación
VERIFIED histórica de destino retirado. Reactivación de destinos y reasignación de
alias retirados quedan fuera del MVP: requieren revisión expresa y estrategia de
reverificación para evitar republicar afirmaciones automáticamente.

No confiar en `createdById`, `verifiedAt`, owner, etiquetas canónicas o versiones
nuevas enviados por el cliente. Actor y fechas provienen de sesión/reloj servidor;
con la arquitectura actual el actor es el usuario propietario. Colaboradores y
roles de revisión distintos serían otra fase, sin simular un equipo inexistente.

## 7. Contratos privados de API propuestos

Prefijo `/api`, middleware actual, proxy same-origin/HttpOnly, Origin para mutaciones,
`Cache-Control: private,no-store`. Endpoints **propuestos**, no disponibles aún.
Separar routers/esquemas/servicios/repositorios con las factorías del proyecto.

| Método/ruta | Contrato y propósito |
| --- | --- |
| `GET /device-brands?q=&page=1&status=active` | Buscar nombres canónicos/alias propios. 25 resultados, `hasMore`; sin coincidencia devuelve lista vacía. status: active/retired/all. |
| `POST /device-brands` | `{operationId,name}`. Crear marca y nombre canónico atómicamente. |
| `GET /device-models?brandId=UUID&q=&page=1&status=active` | Buscar modelos/alias/código dentro de la marca propia. Mostrar el canónico, variante y alias coincidente. Mismo enum de estado. |
| `GET /device-brands/:id` / `GET /device-models/:id` | Detalle propio, versión vigente, nombre canónico y estado de retirada. No devolver todos los alias sin límite. |
| Incremento alias: `GET /device-brands/:id/names?page=1` / `GET /device-models/:id/names?page=1` | Lista de nombres propios, canónicos/alias/retirados paginados. |
| `POST /device-models` | `{operationId,brandId,name,manufacturerCode?}`. No deducir marca por el texto. |
| `POST /device-brands/:id/names` | `{operationId,expectedVersion,label}`. Alias de esa marca; mismos checks de colisión que el canónico. |
| `POST /device-models/:id/names` | Contrato análogo para alias del modelo y su marca. |
| `PATCH /device-brands/:id` / `PATCH /device-models/:id` | `{operationId,expectedVersion,name}` para corregir nombre canónico preservando identidad. Código/brandId usados no se cambian por este PATCH. Canonizar renombre y alias anterior en la misma transacción. |
| `POST /device-brands/:id/retire` / `POST /device-models/:id/retire` | `{operationId,expectedVersion,reason}`. Retirada no destructiva; no DELETE ni reactivación automática. |
| `GET /inventory/items/:id/compatibilities?page=1&status=all` | Conjunto efectivo propio y relaciones paginadas, incluidas rechazadas/retiradas solo en gestión privada. |
| `POST /inventory/items/:id/compatibilities` | `{operationId,expectedSetVersion,modelId}`. Alta PENDING de una sola relación. `expectedSetVersion=0` representa ausencia de cabecera. |
| `PATCH /inventory/items/:id/compatibilities/:compatibilityId` | `{operationId,expectedSetVersion,expectedVersion,status?,evidenceType?,evidenceReference?,note?,reviewReason?}`; debe incluir al menos un cambio y respetar transiciones. |
| `GET /inventory/items/:id/compatibility-events?page=1` | Eventos privados paginados, filtrados por propietario y sujeto; sin joins de contactos de usuarios. |
| Incremento legacy: `GET/POST /products/:id/compatibilities`, `PATCH /products/:id/compatibilities/:compatibilityId`, `GET /products/:id/compatibility-events` | Misma lógica de conjunto para productos no vinculados; GET de uno vinculado resuelve inventario y devuelve su source; mutación directa vinculada: 409 `COMPATIBILITY_SOURCE_IS_INVENTORY`. |

Alias retirados se gestionan con un PATCH de su recurso de nombre en el incremento
de alias: `/device-brands/:id/names/:nameId` o `/device-models/:id/names/:nameId`,
con `{operationId,expectedVersion,retired:true,reason}` y versión del padre,
auditado; nunca DELETE. Retirar el canónico exige
primero otro canónico válido en el mismo comando transaccional. No exponer un PATCH
genérico que permita mover un alias a otro modelo. Detalle de diccionario por ID
propio podrá reutilizar las mismas lecturas del servicio, con 404 uniforme.

Listados de marcas/modelos: `{success:true,items:[{id,name,version,retiredAt,...}],
page,pageSize:25,hasMore}`; modelo añade `brandId`, `manufacturerCode` y nombre
canónico de marca. Alias coincidente es informativo. Detalle usa `{success:true,
result:entity}`. Altas/renombres de diccionario devuelven el mismo detalle y
`idempotent`; nombres se auditan junto a su padre en el mismo recibo.
La retirada de un canónico aislado no se habilita en el MVP: responder conflicto;
un reemplazo futuro debe preservar las reglas de identidad usada descritas arriba.

Respuesta orientativa de lectura:

```text
{
  success: true,
  source: { kind: "INVENTORY_ITEM", id: itemId },
  set: { id: setId, version: 3 } | null,
  compatibilities: [{
    id, version, status,
    model: { id, name, manufacturerCode, retiredAt,
             brand: { id, name, retiredAt } },
    evidenceType, evidenceReference, note, reviewReason,
    createdAt, updatedAt, verifiedAt
  }],
  page: 1, pageSize: 25, hasMore: false
}
```

Sin compatibilidades: `set:null`, `compatibilities:[]` y versión esperada de alta 0;
el GET no crea cabeceras/recibos/eventos. Un set existente vacío conserva su versión.
Mutación exitosa: `{success:true,result:{compatibility,setVersion,idempotent}}`;
201 en alta nueva y 200 en replay/actualización. El replay devuelve el recibo
histórico, no promete representar el estado vigente; la UI relee después por GET.

### Validación y errores

Zod estricto; UUID; enum cerrado; longitudes anteriores; página 1..100000; q máximo
160; status `all` o uno de los cuatro estados. Rechazar campos desconocidos,
parámetros repetidos, arrays improvisados, HTML de UI ejecutable y cuerpos >16 KiB.
Los textos siguen siendo datos, no HTML. No ampliar el parser JSON global.
El límite dedicado exige montar esos routers antes del parser global de 32 KiB,
siguiendo el patrón de las rutas de lotes; un parser más pequeño colocado después
de un cuerpo ya parseado no reduce el límite. Mantener Origin antes de leer en
el proxy. En búsquedas escapar comodines y enlazar parámetros; no ejecutar regex
arbitrarias del cliente ni SQL formado con etiquetas.

- 400 `INVALID_COMPATIBILITY_INPUT`, `BRAND_MODEL_MISMATCH`.
- 401: autenticación actual/cuenta cerrada. Nunca obtener owner de cuerpo/query.
- 404 `COMPATIBILITY_RESOURCE_NOT_FOUND`: objeto inexistente o de otro propietario,
  incluidos modelo, marca, set y relación de otro sujeto.
- 409 `COMPATIBILITY_ALREADY_EXISTS`, `NAME_CONFLICT`, `MODEL_CODE_CONFLICT`,
  `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `INVALID_COMPATIBILITY_TRANSITION`,
  `DEVICE_RETIRED`, `COMPATIBILITY_SOURCE_IS_INVENTORY`,
  `COMPATIBILITY_HISTORY_EXISTS`, `DEVICE_IDENTITY_IN_USE`.
- 413 tamaño/cuota; 429 limitadores vigentes y cuota específica a medir;
  503 `COMPATIBILITY_RETRY_SAME_OPERATION` para fallo técnico sin detalles internos.

Una coincidencia de nombre/alias devuelve candidato propio y conflicto identificable,
no crea otra entidad ni la selecciona silenciosamente. En un duplicate de relación
se devuelve el ID existente propio para revisión; si estaba REJECTED/WITHDRAWN,
se ofrece volver a PENDING, no crear otro ID.

## 8. Concurrencia, idempotencia y auditoría

Toda mutación de diccionario o compatibilidad incluye `operationId` UUID. En la
transacción: comprobar cuenta abierta; coordinar un namespace transaccional de
compatibilidades por propietario; recuperar recibo y comprobar hash antes de
validar versiones; bloquear los registros correspondientes en orden determinista;
contrastar FKs/estados/versiones; escribir estado, recibo y eventos juntos.

Un conflicto de negocio no deja filas parciales. Un fallo de escritura/auditoría
revierte todo. Reintento exacto recupera el recibo; misma clave con otro contenido
devuelve 409. Dos claves distintas para el mismo modelo no generan dos relaciones.
La versión de conjunto serializa altas/ediciones y permite detectar revisiones
obsoletas; una operación sin cambio real no incrementa versiones ni duplica eventos.
En la primera alta, versión esperada 0 crea cabecera y relación juntas y devuelve
setVersion 1. Una alta con otro operationId que encuentra la cabecera/relación ya
creada no se interpreta como autorización para insertar otra. Nombres y alias
se serializan bajo la versión de su marca/modelo, sin una versión independiente
por alias en este MVP.

El mutex debe ser PostgreSQL/advisory transaccional, no memoria de Express. Se
propone serializar mutaciones de compatibilidad de una cuenta por simplicidad
inicial; medir antes de granularizar. No reutilizar locks de SKU, venta o stock.
No actualizar InventoryItem/Product para «tocar» updatedAt ni sus versiones cuando
solo cambia una relación. No tomar locks de ventas/pedidos desde este módulo.

Los servicios de eliminación/enlace que interactúen con FKs nuevas deben revisarse
contra su orden de locks real antes de codificar triggers; ensayo obligatorio de
carreras con publicación/borrado/cierre en PostgreSQL aislado. Timeout/deadlock:
rollback y reintento explícito del mismo comando, sin claves nuevas automáticas.

Eventos legibles: quién, cuándo, entidad, cambio de estado, evidencia anterior/nueva
y nombres del momento. Mostrar actor por contexto privado, sin devolver correos u
otros contactos innecesarios. No registrar notas/evidencia/cuerpos en logs técnicos.
Sin eventos «de migración» que inventen un autor o una verificación histórica.

## 9. Búsqueda y frontend

Integrar en `/dashboard/inventario`, junto a la ficha existente, un bloque
«Compatibilidades» separado de metadatos, ficha comercial y movimientos:

1. Buscar/seleccionar marca; buscar modelo o alias dentro de ella. Mostrar nombre
   canónico, marca y código/variante, y advertir cuando hay varios candidatos.
2. Si no existe, acción explícita «Registrar marca/modelo» con revisión de posibles
   duplicados. Un texto tecleado no equivale a una selección ni guarda nada.
3. Añadir solo al confirmar; aparece PENDING. Revisar evidencia y verificar mediante
   otro botón. Rechazar/retirar requieren motivo y confirmación explícita.
4. Mostrar tabla/lista paginada con estado, destino, evidencia privada y fecha;
   cargar eventos bajo demanda. No descargar el diccionario completo al abrir.
5. Carga, vacío, error, sesión expirada, reintento y éxito accesibles; labels, teclado,
   foco visible y mensajes aria-live. Conservar borrador ante error y claves de
   operación inciertas. No reenvíos automáticos ni datos sensibles en localStorage.
6. Cambiar de artículo/marca descarta respuestas tardías; una respuesta guardada de
   A no selecciona A después de abrir B. La UI valida DTO e identidad esperada.

En el incremento legacy, colocar el mismo bloque en el editor real de catálogo
`/dashboard/catalogos/[catalogId]`, sin inventar rutas de productos. Un Product
vinculado muestra «Gestionado desde inventario» y su origen, no un segundo editor.
«Usar datos» de sugerencias y búsqueda por código de barras sigue copiando solo
datos descriptivos; no copia verificaciones ni usa un proveedor externo como prueba.

### Filtros exactos, sin cambiar q existente

Añadir, tras aprobar el incremento de búsqueda, `compatibilityBrandId`,
`compatibilityModelId` y `compatibilityStatus` a los listados privados existentes.
Sin ellos, contratos/resultados actuales se conservan. Con modelo/marca el estado
por defecto es VERIFIED; `all` solo es una vista de gestión privada, claramente rotulada.

Marca significa **marca del dispositivo compatible**, no `Product.brand`.
Con marca+modelo comprobar que el modelo pertenece a esa marca y que ambos filtros
se aplican a la misma relación (no dos EXISTS de filas distintas). q continúa su
semántica anterior; no ampliar silenciosamente «Oppo» a una afirmación de encaje.
Sin relaciones verificadas el artículo queda fuera del filtro de compatibles,
pero permanece en el listado general.

La marca sola retorna artículos con al menos un modelo de esa marca: nunca significa
«compatible con todos los modelos de la marca». AND con filtros actuales; usar
EXISTS para no duplicar artículos/conteos cuando coincidan varias relaciones.
Mantener tamaños/paginación originales de inventario y productos y su ownership.

## 10. Alias, equivalencias y conflictos semánticos

Alias = otro nombre de **la misma identidad concreta**. Equivalencia = afirmación
revisable entre dos identidades distintas. Compatibilidad = relación del artículo
con una identidad de destino. No confundir las tres.

No crear grupos equivalentes en el MVP. Un incremento posterior puede proponer
`DeviceModelEquivalence` por propietario: par ordenado de IDs distintos, tipo
`SAME_DEVICE`/`RELATED_PLATFORM`, estado/evidencia/versiones/eventos y unicidad del
par/tipo. Solo sugerencias privadas: sin herencia de relaciones, sin transitividad,
sin unión de grupos automática ni propagación entre marcas. Incluso SAME_DEVICE
no confirma que una pieza encaje en ambas variantes sin revisión del vendedor.

Errores de identidad se corrigen revisando las relaciones una por una; no ofrecer
fusiones de modelos ni reasignar alias usados como operación lateral de edición.
Una marca nueva con nombre parecido a Oppo o Realme no implica afiliación/equivalencia.

## 11. Ventas, catálogo público e importación futura

### Ventas y pedidos

Compatibilidades son información operativa actual. No modifican `SaleLine`, precios,
costos, SKU/nombres históricos, comprador, cantidades, totales, estados o ledger.
No invalidan por sí solas la versión comercial ni alteran reservas/conversión.
En una venta antigua no presentar una consulta viva de compatibilidad como dato
histórico de lo vendido. Si se requiere conservar una promesa de compatibilidad al
vender, diseñar en otra fase un snapshot opcional para ventas nuevas; sin backfill.
Tampoco cambia el token de cotización pública actual ni su contrato.

### Publicación posterior, separada y opt-in

El primer incremento no toca el catálogo público. En un incremento aprobado aparte:
publicar solo VERIFIED con marca/modelo activos y consentimiento explícito por
Product/publicación (`showVerifiedCompatibilities=false` por defecto, ubicación
final de ese flag a concretar con el contrato de publicación). Sin overrides del
hecho operativo. No mostrar pendientes, rechazos, retiradas, notas, evidencia,
actores, recibos, propietario ni otros artículos del diccionario privado.

Proyección pública mínima: marca/modelo canónicos y variante/código público que
el vendedor decida mostrar. Publicar una lista vacía no significa universalidad.
Los filtros públicos se resolverían exclusivamente dentro del catálogo público
visible, con IDs opacos previamente proyectados allí; nunca reutilizar endpoints
privados de diccionario ni revelar existencia/contadores de otras cuentas.
Revisar caché/DTO/paginación al diseñar esa entrega; no poner consultas por tarjeta
ni multiplicar todos los productos por todas sus compatibilidades.

Una revisión retirada debe desaparecer de la proyección vigente. Si posteriormente
la compatibilidad formara parte de la aceptación comercial de un pedido, habrá que
ampliar expresamente cotización/snapshots antes de ofrecer esa garantía, no de forma
implícita por añadir una etiqueta de búsqueda.

### Excel/CSV posterior

No extender ahora las 14 columnas INV1 ni el importador de catálogo. Diseñar un
perfil versionado separado, por ejemplo COMP1, con una fila por sujeto/modelo:
`SubjectType`, `InventoryItemID`/`ProductID`, `SKU` como ayuda según su ámbito,
`BrandID`, `ModelID`, `Action`, versiones y número original de fila. Etiquetas/alias
exportados son informativos, no identidad; SKU comercial sin catalogId es ambiguo.

UUID propios y SKU exacto dentro del sujeto/catálogo pueden resolver mercancía;
los modelos deben quedar resueltos a IDs propios antes de confirmar. Un archivo
externo de texto produce candidatos/errores en preview: nunca un autovínculo por
parecido, ni autoaltas masivas de marcas/modelos. Duplicados detectados en todo el
archivo, entre fragmentos, con error en todas las filas del par implicado.

Vacío conserva datos y filas omitidas no eliminan relaciones. Retirar es una acción
explícita revisada. Importación inicial solo puede proponer PENDING; no convierte
una columna «verificado» en credencial de revisión ni inventa autor/fecha. Mantener
rechazos existentes hasta un comando explícito de reapertura. Reutilizar límites,
lector seguro, worker, preview y confirmación, sin mezclar aplicación con ajustes
de stock. Este perfil necesitará diseño de staging/recibos propio antes de codificar.

## 12. Estrategia de migración y despliegue posterior

No se genera ni ejecuta SQL en esta fase de diseño.

1. Inventariar los esquemas/índices/FKs reales y preparar una migración nueva
   aditiva con tablas, claves compuestas, enums/CHECK, índices y guards anteriores.
   No editar migraciones aplicadas ni convertir brand/model actuales a FKs.
2. Para cada incremento desplegable instalar el conjunto coherente de tablas y
   restricciones que necesita. No habilitar endpoints con integridad parcial;
   ensayo de instalación y rollback de transacción en PostgreSQL desechable.
3. Tablas nuevas vacías: no actualizar productos, saldos, líneas o ventas existentes.
   Sin seed global ni asociación automática. El código antiguo continúa funcionando.
4. Productos con marca/modelo/specs quedan intactos y sin compatibilidades declaradas.
   Una herramienta privada posterior puede mostrar candidatos desde esos textos,
   pero exige selección de marca/modelo/variante, preview y confirmación humana.
   Copiar un texto legado al diccionario no acredita compatibilidad del accesorio.
5. Medir constraints, bloqueos e índices con volumen representativo antes de aprobar
   despliegue. La creación de índices sobre tablas previas grandes necesitaría plan
   específico; no asumir que producción está vacía ni crear índices duplicados.
6. Con aprobación específica: respaldo verificable, aplicar esquema aditivo y
   verificar constraints; publicar backend antes de frontend, activar primero UI
   privada. Los parsers actuales estrictos requieren ese orden para filtros nuevos.
7. Rollback de aplicación: desactivar la UI/endpoints nuevos y conservar las tablas
   y eventos; no DROP/CASCADE ni restaurar una copia sobre escrituras legítimas.
   Si falla SQL, rollback/rectificación hacia adelante revisada; no ocultar ledger.

La fase actual solo crea este documento. Preparar migraciones, aplicar incluso
en un entorno aislado, publicar o actuar sobre datos reales requiere el permiso
que corresponda en la siguiente tarea.

## 13. Casos límite y plan de pruebas

| Caso | Resultado a verificar |
| --- | --- |
| Sujeto/modelo/marca inexistente o ajeno | 404 uniforme; cero relaciones, recibos o eventos nuevos. |
| Igual etiqueta en otra cuenta | Permitido, sin avisar que existe fuera. FKs compuestas niegan el cruce. |
| Mismo alias/canónico de otra entidad propia | 409 con candidato propio; no fusión ni selección automática. |
| Doble alta simultánea de nombre o relación | Un único registro; replay recupera recibo o devuelve conflicto controlado. |
| Modelo con mismo nombre en dos marcas | Distintos IDs; marca obligatoria para resolverlo. |
| A58/A58 5G, acentos, guiones, +, espacios y Unicode | Reglas conservadoras probadas; sin colisiones por stripping agresivo. |
| Renombrar un modelo verificado a otro dispositivo | 409 DEVICE_IDENTITY_IN_USE; no reinterpretar verificaciones históricas. |
| Marca del accesorio distinta del destino | No es error; el fabricante comercial no cambia. |
| Producto sin relaciones o solo pendientes/rechazos | No universal; no confirmado; sigue disponible según reglas anteriores. |
| Producto compartido en varios catálogos | Una fuente inventario; sin duplicar hechos ni conteos. |
| Product sin inventario y enlace futuro | Set propio; bloqueo de dos fuentes y revisión explícita antes de transferir. |
| Alias retirado/código de modelo cambiado | Sin reasignación silenciosa ni reinterpretación de relaciones anteriores. |
| Edición/verificación concurrente | expectedVersion/setVersion; una gana, la otra 409. |
| Retirada durante lectura/publicación futura | Proyección vigente excluye la afirmación; nunca publica evidencia privada. |
| Fallo después de guardar relación y antes del evento | Rollback de relación/versión/recibo; reintento seguro. |
| Mismo operationId con otra ruta/cuerpo/propietario | Conflicto o aislamiento; no devolver un recibo ajeno. |
| Retry después de rename/rechazo posterior | Recibo original; GET actual separado, sin rehacer la verificación. |
| Nombre/nota maliciosa o referencia URL | Validación/escape; no ejecución HTML, descarga ni datos personales en logs. |
| Borrar Product/Catalog con historia nueva | Rechazo legible y ninguna cascada; producto sin set conserva reglas previas. |

Unitarias: normalizador versionado, alias vs canónicos, estados/evidencia, cuotas,
resolución de fuente, filtros EXACTOS/EXISTS y no inferencia por nombre/equivalencia.
Repositorios/servicios: propiedad en cada consulta, compuestos, replay, conflictos,
versiones y rollback integral, paginación vacía/fuera de rango y sin N+1.
HTTP: cookie/proxy/auth actual, cuenta cerrada, UUID/query/cuerpo inválidos, mensajes
seguros, cache privado y origen de mutaciones. No depender solo de la UI.

PostgreSQL aislado: FKs/CHECK/únicos/constraint triggers, carreras entre dos instancias,
primera creación del set, alias concurrentes, renombres y retiros, borrado de padre,
publicación y cierre de cuenta; confirmar ausencia de deadlocks o manejo de retry.
Medir EXPLAIN antes de recomendar índices adicionales.

Frontend/navegador: selección explícita, duplicados, vacío/carga/éxito/error/retry,
sesión expirada, teclado/móvil, dos marcas, variantes ambiguas, conservación de
borrador, respuesta tardía y cero escrituras al abrir/buscar/cancelar. Confirmación
separada de alta/verificación. Contratos inválidos no habilitan mutaciones.

Regresiones: suites completas de backend/frontend, browsers de inventario/clientes/
pedidos, builds, lint y diff-check. Probar que editar diccionario/compatibilidades
no modifica snapshots ni versiones comerciales, stock, movimientos, totales o
precios públicos. Conservar datos históricos sintéticos anteriores a la migración.

## 14. Incrementos pequeños y criterios de salida

1. **Diccionario privado y compatibilidades de InventoryItem.** Identidades,
   nombres canónicos, estados, evidencias, ownership, cabecera, recibos/eventos,
   endpoints básicos y bloque privado en la pantalla actual. Sin alias editables,
   legacy ni público. Alias como estructura comparte namespace desde el principio,
   aunque su gestión se habilite después. Salida: aislamiento, duplicados, estados,
   atomicidad/idempotencia y regresión de stock/ventas verificados.
2. **Alias y búsqueda exacta privada.** Gestión versionada de alias/canónicos y
   retiros; filtros aditivos de inventario. Salida: ambigüedad visible, nombres
   cruzados protegidos y planes de consulta medidos. No fuzzy matching de escritura.
3. **Productos de catálogo anteriores.** Sujeto CATALOG_PRODUCT, editor existente,
   búsquedas comerciales y protecciones de borrado/dos fuentes. Salida: migración
   sin backfill, precio/stock intactos, productos vinculados con fuente única.
4. **Proyección pública opt-in.** Contrato de publicación/DTO/filtros y privacidad
   aprobados por separado. Solo afirmaciones verificadas, sin costos/notas/actores.
5. **Intercambio COMP1 y equivalencias, separados entre sí.** Diseñar cada uno antes
   de implementar; staging/preview y propuestas nunca equivalen a verificación.

No comenzar el incremento siguiente hasta revisar pruebas y aceptar el anterior.
Las rutas y payloads de incrementos posteriores son propuestas de integración,
no una solicitud de implementarlos junto al primero.

## 15. Riesgos y puntos de aprobación

- Un diccionario por cuenta duplica conocimiento entre vendedores; es deliberado
  para aislar propiedad. Un maestro global exigiría gobernanza/moderación y otro diseño.
- Canonizar una etiqueta incorrecta no hace correcta una afirmación física. El
  vendedor debe distinguir variante, región y evidencia; no se puede automatizar por
  similitud. La palabra «verificado» necesita la etiqueta de responsabilidad descrita.
- La auditoría guarda notas privadas y puede contener datos personales introducidos
  por error: límites, advertencias y acceso mínimo, sin definir aquí retención o
  anonimización. Suponer que «no se borra» autoriza cualquier retención sería incorrecto.
- Las FKs de historia afectan borrados de Product/Catalog solo cuando exista set:
  aprobación explícita de ese cambio antes de habilitar el incremento legacy.
- Canonical names, triggers diferibles y exclusividad de fuente deben ensayarse
  con el esquema efectivo; no basta con que Prisma valide el archivo.
- El lock por propietario es conservador; medir antes de complicarlo. Sin validación
  PostgreSQL no afirmar garantía de concurrencia multiinstancia.
- Mantener búsqueda y exhibición independientes de garantía comercial histórica.
  Si se promete encaje al comprar, el cambio de cotización/snapshots necesita otra
  aprobación; este diseño no lo incorpora por accidente.

Para iniciar código se requiere aprobar: diccionario privado; conjunto por sujeto
con herencia desde inventario; los cuatro estados y verificación en dos acciones;
normalización conservadora/namespace compartido; evidencia/auditoría e idempotencia;
migración vacía sin inferencias. También confirmar que la primera entrega es solo
el incremento 1. Lo público, legacy, importación y equivalencias quedan escalonados.

Comprobación de esta entrega documental: lectura estática de contratos/código,
validación de enlaces relativos/UTF-8/espacios y `git diff --check`, con revisión
del estado Git. También se ejecutaron las comprobaciones generales exigidas por
las instrucciones del repositorio: `npm.cmd test` backend (332 aprobadas),
`npm.cmd test` frontend (aprobada) y `npm.cmd run build` en ambos paquetes
(aprobados, incluyendo tipos). `npm.cmd run lint` frontend: cero errores y cuatro
advertencias previas sobre imágenes en componentes públicos ajenos a este diseño.
No hay scripts independientes de typecheck ni lint backend. Son regresiones de
la base existente: no acreditan el modelo propuesto ni reemplazan su plan de
pruebas. No se ejecutaron migraciones, conexiones de ensayo ni navegadores de una
función todavía inexistente. Único archivo añadido: este diseño.
