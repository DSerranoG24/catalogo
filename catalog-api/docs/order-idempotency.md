# Idempotencia de pedidos públicos

La clave se envía como `idempotencyKey` en el JSON del pedido. Va junto con los datos de la operación, se valida con el mismo esquema de entrada y el cliente puede conservarla al repetir exactamente esa solicitud. Es opcional para mantener compatibilidad con clientes existentes.

La clave admite entre 1 y 100 caracteres ASCII alfanuméricos, guion o guion bajo. La base de datos aplica unicidad por catálogo. Una repetición devuelve los datos del recibo originalmente guardado; no vuelve a calcular precios.

La migración agrega una columna nullable y un índice único compuesto. Las filas anteriores quedan con `NULL`; PostgreSQL permite varias filas `NULL` en ese índice, así que no se reescriben ni eliminan pedidos existentes. La migración no se debe aplicar a producción desde este bloque.

Antes de desplegar, aplicar la migración en el entorno de pruebas, verificar el estado de migraciones y luego coordinar el despliegue de API y frontend. El flujo sigue siendo una solicitud sujeta a confirmación por WhatsApp; `Product.stock` permanece informativo y no se reserva ni se descuenta.
