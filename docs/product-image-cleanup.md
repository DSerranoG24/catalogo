# Limpieza persistente de imágenes de producto

Esta entrega solo procesa borrados nuevos. No enumera Storage ni reconcilia
huérfanos anteriores. AccountClosureJob y su worker conservan su contrato.

## Escritura y ejecución

El borrado individual, el lote (incluido descartar) y quitar una foto capturan
las rutas y crean ProductImageCleanupTask dentro de la misma transacción que
elimina las referencias. Si falla la cola, se revierte el borrado. No se llama
a Storage desde esas transacciones. Los pedidos conservan sus instantáneas.

La tabla no tiene claves foráneas: sus tareas sobreviven a productos y catálogos.
La unicidad bucket/path evita duplicados. No conserva histórico por archivo:
la tarea se elimina después de confirmar remove. Los intentos fallidos conservan
PENDING y programan esperas de 30 segundos, duplicadas hasta una hora.

El worker arranca desde server.ts, revisa cada 30 segundos y procesa como máximo
diez tareas por tick. FOR UPDATE SKIP LOCKED coordina instancias; el bloqueo de
fila dura hasta el commit. Un fallo del commit después de remove deja una tarea
repetible. No se registra información del proveedor ni rutas en logs.

Solo acepta el bucket product-images y rutas catalogUUID/productUUID/fileUUID
con extensión jpg, jpeg, png o webp. Reutiliza assertOwnedStoragePath y remove.
Rechaza logos, categorías, banners, otros catálogos y rutas ambiguas. Las tareas
rechazadas siguen pendientes y se reintentan, sin tocar Storage. También aplaza
una tarea mientras exista otra ProductImage con la misma ruta.

El flujo actual genera nombres UUID nuevos y sube con upsert:false; no ofrece
una operación que vuelva a asociar una ruta arbitraria ya eliminada. Este worker
no debe reutilizarse como reconciliador ni habilitar reasociación de rutas sin
añadir coordinación específica con las escrituras de referencias.

## Migración y despliegue manual

20261028180000_product_image_cleanup/migration.sql crea exclusivamente la tabla,
su clave primaria, unicidad, índice de pendientes y CHECK de estado, bucket e
intentos. No modifica datos ni migraciones anteriores y no crea tareas antiguas.
schema.prisma solo añade el modelo ProductImageCleanupTask.

El responsable aplica la migración con prisma migrate deploy después del
respaldo y migrate status, antes de desplegar esta API: los borrados y el worker
consultan la tabla nueva. Regenerar Prisma y compilar no aplica la migración.
Un rollback de código puede conservar la tabla y las tareas; no eliminarla
mientras queden pendientes. El código anterior deja de encolar nuevos borrados.

## Alcance de las pruebas

Las pruebas usan transacciones simuladas con rollback y Storage simulado:
encolado y rollback individual/lote/foto, eliminación tras éxito, espera y
reintento, commit interrumpido, extensiones y rutas prohibidas, referencia aún
existente. No sustituyen un ensayo PostgreSQL ni verifican Supabase remoto.
La migración no se ha aplicado en esta entrega.
