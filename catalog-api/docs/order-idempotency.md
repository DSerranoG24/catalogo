# Idempotencia de pedidos públicos

La clave se envía como `idempotencyKey` en el JSON del pedido. Va junto con los datos de la operación, se valida con el mismo esquema de entrada y el cliente puede conservarla al repetir exactamente esa solicitud. Es opcional para mantener compatibilidad con clientes existentes.

La clave admite entre 1 y 100 caracteres ASCII alfanuméricos, guion o guion bajo. La base de datos aplica unicidad por catálogo. Una repetición devuelve los datos del recibo originalmente guardado; no vuelve a calcular precios.

La recuperación usa catálogo y clave; no compara un hash del nuevo cuerpo. Reutilizar la clave con otros productos o cantidades no crea una compra nueva: el cliente debe conservarla solo para reintentar esa compra y generar otra para una compra distinta. Si faltaba cotización, el reintento puede emitirla y completar la representación del mismo pedido; véase [cotizaciones](../../docs/quotations.md#consecutivo-e-idempotencia).

La migración agregó una columna nullable y un índice único compuesto. Las filas anteriores quedan con `NULL`; PostgreSQL permite varias filas `NULL` en ese índice, así que no se reescriben ni eliminan pedidos existentes. Cualquier aplicación pendiente exige seguir el procedimiento autorizado de migraciones; este documento no autoriza ejecutarla.

Antes de desplegar código que requiera una migración pendiente, probarla en entorno aislado y seguir el procedimiento autorizado antes de publicar API y frontend. No repetir migraciones ya aplicadas. El flujo sigue siendo una solicitud sujeta a confirmación por WhatsApp; `Product.stock` permanece informativo y no se reserva ni se descuenta.

La ejecución PostgreSQL del 23 de octubre se conserva en el [historial](../../docs/historial/2026-10-23-idempotencia.md), con sus cifras originales. Para repetir la verificación actual, consultar la [matriz de pruebas](../../docs/testing.md) y el [procedimiento de migraciones](../../docs/migrations.md).
