# Comprador de un pedido convertido en venta

`POST /api/orders/:orderId/convert-to-sale` sigue siendo una ruta privada.
Conserva estados PENDING/CONFIRMED del pedido, modos DRAFT/CONFIRMED/DELIVERED,
precio congelado de las líneas y reglas de stock anteriores. El catálogo público
no recibe ni expone identificadores Customer y no se actualiza ningún pedido.

## Datos e idempotencia

La primera conversión escribe en la misma transacción:

- Sale.customerNameSnapshot = Order.customerName, o null si no existe.
- Sale.customerPhoneSnapshot = Order.customerPhone, o null si no existe.
- Sale.customerEmailSnapshot = Order.customerEmail, o null si falta/está vacío.
- Sale.customerId = null por defecto; no crea ni busca un Customer por coincidencias.

No normaliza ni recorta los snapshots. Mantiene los campos libres anteriores
customerName/customerPhone para compatibilidad. La creación directa de una venta
sigue tomando sus snapshots de Customer; esa regla NO se aplica a la conversión.

El cuerpo admite `customerId?: UUID | null` además de operationId, requestId,
mode y acceptPriceDifference. Si se proporciona un UUID, valida en servidor que
el cliente pertenezca al usuario autenticado y no esté archivado. Su fila queda
bloqueada con FOR SHARE hasta el commit. El vínculo no sustituye ninguno de los
tres snapshots del pedido, aunque la ficha interna tenga otros datos o correo.
No existe selector de clientes en el panel de conversión actual: no se modificó
el frontend ni se agregó elección de clientes a la compra pública.

Un reintento idéntico devuelve la venta original sin recapturar datos ni volver
a descontar stock, incluso si el cliente ahora está archivado. El mismo comando
no se puede reutilizar para otro pedido, otro tipo de operación o distinto cliente.
Ventas ya convertidas antes de este cambio conservan sus valores existentes:
no hay backfill ni reparación automática de snapshots históricos null.

Los datos de comprador enviados en el cuerpo de conversión se rechazan por el
esquema estricto; solo se leen del pedido ya autorizado. Los errores de cliente
son 404 CUSTOMER_NOT_FOUND (ajeno o inexistente) y 409 CUSTOMER_ARCHIVED. Los
errores inesperados devuelven CONVERSION_FAILED sin detalles internos.

## Ampliación autorizada del teléfono

Los tres campos snapshot ya existen, pero customerPhoneSnapshot admitía solo
VARCHAR(15), mientras el pedido público permite teléfonos con formato de hasta
24 caracteres. El usuario autorizó ampliar únicamente esa columna a VARCHAR(24)
y preparar el SQL sin ejecutarlo. Se conserva exactamente el teléfono, incluido
su formato, hasta el límite del contrato público.

Migración pendiente: `prisma/migrations/20261123010000_order_sale_buyer_phone/migration.sql`.
Se generó offline comparando el schema anterior de Git con el nuevo, sin usar
datasource ni shadow database. Solo amplía la columna; no ejecuta UPDATE, backfill
ni truncamiento y no modifica migraciones anteriores. El operador debe ensayarla
en PostgreSQL desechable y aplicarla antes de publicar este backend. ALTER TABLE
toma un bloqueo DDL: planificar una ventana adecuada. Un rollback de código puede
conservar la columna ampliada; no volver a VARCHAR(15), pues podría rechazar o
perder teléfonos ya guardados de mayor longitud. No hay variables ni dependencias
nuevas. Prisma Client se regenera localmente sin aplicar ninguna migración.

Un teléfono histórico que supere incluso 24 caracteres devuelve 409
ORDER_BUYER_PHONE_TOO_LONG y revierte la conversión sin recortarlo ni alterar
el pedido. No se ejecutó ninguna operación sobre una base real.

## Verificación

Las pruebas específicas cubren comprador completo, correo null/omitido/vacío,
datos opcionales ausentes, vínculo opcional activo/ajeno/archivado, diferencias
entre ficha y pedido, reintentos, rollback y conservación de precios y stock.
Los dobles no tienen Customer.create ni Order.update: cualquier intento de crear
un cliente o modificar el pedido falla. Las pruebas no certifican bloqueos SQL
ni concurrencia con PostgreSQL real; queda pendiente un ensayo aislado.

Comprobación local: 34 pruebas específicas y 303 pruebas backend completas
aprobadas; pruebas frontend y builds de ambos paquetes correctos. Lint frontend
sin errores y con las cuatro advertencias previas de img. `git diff --check`
correcto. No hay scripts independientes de typecheck ni lint backend; ambos
builds verifican TypeScript.

Crear clientes desde un pedido o fusionarlos por teléfono/correo sigue siendo
una decisión posterior: no hay altas, coincidencias ni fusiones automáticas.
