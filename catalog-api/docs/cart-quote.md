# Cotizacion del carrito

POST /api/public/catalogs/:publicId/quote recibe { items: [{ productId, quantity }] }.
Valida UUID, 1..99 unidades, 1..50 productos y ausencia de duplicados.
Responde { success: true, quote: { token, available, lines } } sin cache.
Cada linea contiene productId, quantity y product (id, name, price efectivo,
regularPrice, discountPercent, saleEndsAt, stock), o null si no es publicable.
No devuelve identificadores del propietario, inventario ni publicaciones.

El token q1.<64 caracteres hexadecimales minusculos> es SHA-256 del JSON
canonico con version implicita q1, catalogId, propietario y lineas ordenadas
por productId. Incluye cantidades, nombre, precio base y efectivo, stock
vigente, promocion activa y sus fechas, inventoryItemId y publicacion
(id, propietario, inventario, estado y priceOverride). No contiene datos
personales del comprador. Es una huella de estado, no una credencial ni una
reserva. No tiene TTL: caduca cuando cambia el estado relevante; el inicio
o vencimiento de una promocion tambien cambia la huella. Cambios revertidos
exactamente al estado original permiten reutilizarla.

La precedencia sigue resolvePublicProductPrice: priceOverride del propietario,
ItemCommercialTerms.unitSalePrice y Product.price para productos historicos.
getCurrentProductPricing conserva las reglas de promociones. El stock procede
del inventario vinculado propio o de Product para historicos. available indica
publicabilidad, no una nueva regla de suficiencia de stock: no se reservan ni
se descuentan unidades, y se conserva la confirmacion posterior del vendedor.
Cualquier cambio del numero de unidades disponibles invalida el token.

POST /api/public/catalogs/:publicId/orders incluye quoteToken ademas de los
IDs y cantidades. Dentro de la transaccion se bloquean catalogo, publicaciones,
productos, inventario y terminos, se relee el catalogo y se recalcula la huella.
Los bloqueos de productos e inventario tambien impiden insertar relaciones
mediante sus claves foraneas mientras se confirma el pedido. Publicaciones se
bloquean antes de productos para respetar el orden de su actualizacion actual.
OrderItem.unitPrice congela el precio efectivo aceptado, calculado en servidor.
No cambia la conversion a venta, el inventario ni las cotizaciones PDF.

Errores HTTP 409: QUOTE_REQUIRED (ausente), QUOTE_INVALID (formato invalido),
QUOTE_CHANGED (diferente, no publicable o catalogo alterado tras localizarlo).
Incluyen message y quote actual, o null si el catalogo ya no es accesible.
Un catalogo inexistente/inactivo desde la consulta inicial conserva el 404.
Un cuerpo que no supera el esquema conserva el 400. Un reintento idempotente
de un pedido ya creado devuelve su recibo congelado sin exigir recotizarlo.

El frontend conserva el token confirmado en memoria. Recargar o cambiar
cantidades exige confirmarlo otra vez. Los carritos antiguos en sessionStorage
se hidratan sin perder cantidades y obtienen una cotizacion nueva. Un conflicto
invalida la confirmacion, consulta de nuevo, muestra el cambio y exige otra
accion explicita. Nunca reenvia automaticamente el pedido.

Sin migraciones, dependencias ni variables nuevas. Para publicar, coordinar
backend y frontend: clientes antiguos sin token reciben QUOTE_REQUIRED y deben
actualizarse. Las pruebas usan dobles de persistencia y HTTP local; la contencion
y los bloqueos SQL deben comprobarse adicionalmente en PostgreSQL desechable,
nunca contra produccion. Los bloqueos pueden generar esperas y deadlocks con
futuros escritores que no respeten el orden; no hay reintento automatico de pedidos.
