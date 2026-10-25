# Cotizaciones de pedidos

## Emisión

Primero se registra y confirma el pedido `PENDING`, sus precios y sus líneas. Solo después se intenta emitir la cotización en otra transacción. Si falla configuración, emisión o formato, el pedido permanece y el POST devuelve HTTP 201 con `quotationNumber`, `quotationUrl` y `quotationIssuedAt` nulos. No se lanza trabajo en segundo plano sin esperar. El vendedor sigue viendo el pedido; el panel muestra su número o «Sin cotización». El comprador puede continuar en WhatsApp sin enlace ni error de cotización.

Una emisión exitosa asigna un número `COT-000001` por catálogo, fecha real de emisión y validez comercial de 15 días desde esa fecha. El PDF indica **Solicitud sujeta a confirmación**. No es una confirmación del vendedor y no cambia inventario, precios ni transiciones de estado. Cambiar a `CONFIRMED` no emite otro documento.

`Catalog.nit` y `Catalog.quotationTerms` son opcionales y editables en la configuración existente. La garantía forma parte de `quotationTerms`; no hay campo independiente. El NIT admite números, puntos, espacios y guion (hasta 30 caracteres); condiciones son texto plano de hasta 4000 caracteres. Ambos se validan en controlador y repositorio.

Al emitir exitosamente se congelan en `Order.quotationSellerSnapshot` nombre, NIT, teléfono, WhatsApp, dirección, horario, correo, redes y condiciones actuales del vendedor. La fecha se guarda en `quotationIssuedAt`, sin fechar retrospectivamente al registro del pedido. Si la primera emisión falla y se reintenta después, se usan los datos comerciales de la emisión posterior. Cliente, nombre del producto, cantidades, precios unitarios, subtotales y total proceden del pedido persistido, nunca de precios enviados por el navegador. Los importes se muestran en COP y las fechas en `America/Bogota`.

El logo es deliberadamente el **actual** del catálogo, incluso al volver a descargar una solicitud anterior. No se conserva el logo histórico ni se necesita recuperar un objeto eliminado. Si no hay NIT o logo, se omiten sin bloquear la emisión. La fuente estándar cubre español y caracteres latinos; controles se eliminan y caracteres fuera de ese repertorio, incluidos emojis, se sustituyen por `?` en el PDF.

## Consecutivo e idempotencia

La transacción principal verifica `active: true, archivedAt: null`, recupera un recibo previo si hay clave idempotente y calcula precios con productos persistidos. Solo crea el pedido y sus líneas: no valida configuración de cotizaciones, no incrementa contador ni genera token o instantánea. Una vez confirmado su commit, se conserva el recibo para responder aunque falle la siguiente etapa.

La segunda etapa valida `PUBLIC_API_URL` y abre una transacción con `maxWait: 1000 ms` y `timeout: 3000 ms`; además usa `SET LOCAL lock_timeout = '1500ms'` y `statement_timeout = '2500ms'`. Bloquea primero el pedido mediante `SELECT ... FOR UPDATE OF o`, con identificador y pertenencia al catálogo parametrizados. Relee su estado: si está cancelado no emite; si ya tiene cotización completa devuelve la original sin tocar el contador. Un estado parcialmente cumplimentado se trata como inconsistencia y no se sobrescribe.

Solo entonces incrementa atómicamente `Catalog.quotationCounter`, lee los datos comerciales y guarda número, instantánea, fecha y token juntos en ese pedido. El bloqueo de catálogo serializa números entre pedidos distintos del mismo catálogo; el bloqueo previo del pedido evita dos emisiones para el mismo pedido. No se usa `count() + 1`. La actualización final exige los campos escalares aún nulos y estado no cancelado: si no afecta exactamente una fila, lanza un error que revierte toda la transacción, incluido el incremento. No se captura SQL fallido para continuar dentro de una transacción abortada. Un pedido cancelado conserva su número; no se reutiliza.

Un reintento con la misma clave recupera el mismo pedido, sin volver a crear líneas ni recalcular su precio. Si no tiene cotización se intenta emitir de nuevo. Si la emisión ya se confirmó pero se perdió la respuesta HTTP, se recuperan número, fecha y token originales. La representación del mismo pedido puede pasar de cotización nula a emitida. No hay cola, tarea automática ni botón de reemisión en el panel; «Sin cotización» no promete procesamiento futuro. Tampoco se emite si el pedido fue cancelado mientras se intentaba cotizar. Fallos del proceso completo o de la transacción principal siguen siendo fallos de compra; la protección se refiere a errores de aplicación de la etapa de cotización tras el commit.

Base del mecanismo: [bloqueos de filas de PostgreSQL](https://www.postgresql.org/docs/17/explicit-locking.html). Las pruebas de este bloque verifican el flujo HTTP, las operaciones y filtros con dobles de persistencia y un simulador de transacciones con bloqueo y rollback; **no certifican los bloqueos contra PostgreSQL real**. No se conectó a ninguna base ni se aplicaron migraciones.

## Registro seguro de fallos

El POST devuelve `requestId` en JSON y en la cabecera `X-Request-ID`. Se genera en el servidor y no se copia un identificador arbitrario enviado por el cliente. Un fallo de cotización registra únicamente `event: quotation_issue_failed`, ese `requestId` y una categoría segura `errorCode`: configuración, validación de instantánea, transacción no disponible, unicidad, base de datos, integridad o fallo no clasificado. No se registra el error completo, su mensaje o stack sin filtrar, cuerpos, datos comerciales/personales, token ni URL. Si falla el transporte del propio log, también se mantiene HTTP 201.

## Descarga y privacidad

Ruta de API:

```text
GET /api/public/catalogs/:publicId/orders/:orderId/quotation.pdf?token=TOKEN_DE_LA_COTIZACION
```

Cada cotización emitida recibe un token aleatorio de 32 bytes (256 bits), representado por 64 caracteres hexadecimales. El token persistido permite que un reintento idempotente recupere exactamente el mismo enlace. Es una credencial de acceso al documento: se guarda en la base de datos, no se registra en logs ni se añade al listado privado de pedidos. La respuesta de creación entrega solo el enlace que lo contiene, no un campo adicional con el token.

La consulta exige conjuntamente el identificador del pedido, la relación del catálogo con el `publicId`, el token y estado distinto de `CANCELLED`. Sin autorización o para pedidos históricos sin cotización devuelve 404 uniforme. No depende del catálogo público actual: un catálogo archivado no destruye el acceso a solicitudes anteriores. Al cancelar el pedido queda revocado para peticiones posteriores. Se vuelve a comprobar autorización antes de enviar los bytes, después del trabajo de logo/PDF. Un PDF ya descargado no se puede revocar ni borrar de otro dispositivo.

Los 15 días son validez comercial del documento, no caducidad del enlace: el enlace sigue accesible mientras exista el pedido y no esté cancelado, conforme a la decisión de dominio.

Cabeceras: `Content-Type: application/pdf`, `Content-Disposition: inline; filename="COT-000001.pdf"`, `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow, noarchive`, `Referrer-Policy: no-referrer` y `X-Content-Type-Options: nosniff`. El nombre del archivo solo usa el número generado. No hay almacenamiento público del PDF, ni redirección a Storage.

La ruta admite 30 descargas por 15 minutos/IP, además del límite global de API. Se limita a dos generaciones simultáneas por instancia y 8 MiB de salida. Al saturarse devuelve 503 para reintentar. La cabecera de privacidad también se establece antes del limitador específico. Antes de desplegar hay que revisar que la infraestructura no registre URLs con query tokens; esta sesión no inspeccionó ni cambió los logs de Render. No incluir estos enlaces en analítica, sitemap o páginas indexables. La política pendiente de retención/anonimización debe cubrir las instantáneas y los enlaces, no solo el pedido original.

## Logo y PDFKit

Se usa únicamente PDFKit 0.20.2 y sus dependencias transitivas. No se instala un navegador ni una biblioteca de conversión. Como el paquete no incluye tipos, `src/types/pdfkit.d.ts` declara estrictamente el subconjunto utilizado, sin instalar otra dependencia.

Se descarga el objeto actual directamente de Storage autenticado y se incrustan los bytes en el PDF. El destino procede de `SUPABASE_URL` y se limita a HTTPS de proyectos `*.supabase.co`; la ruta debe pertenecer a `catalogId/branding/` en el bucket existente `product-images`. No se aceptan rutas arbitrarias ni redirecciones. No se crea ni se conserva una URL firmada.

Descarga máxima: 5 MiB y 5 segundos incluyendo el cuerpo. Se verifica firma binaria JPEG/PNG y dimensiones hasta 16 millones de píxeles antes de decodificar. Los PNG también se descomprimen con tope de 64 MiB y se validan sus filas/filtros antes del decodificador asíncrono de PDFKit. WebP se omite, tanto por extensión como por firma; no se convierte. Si Storage falla o el logo es inválido, se entrega el PDF sin logo. Nunca se registran errores que puedan incluir credenciales de Storage.

## Esquema existente y despliegue

El desacoplamiento no necesita ni crea una migración. Reutiliza los campos nullable y los índices de `20261024120000_order_quotations`, aplicada en producción según lo comunicado por el responsable; no se verificó remotamente en esta sesión. Esa migración previa:

- Añade `nit` y `quotationTerms` nullable a catálogos y contador entero obligatorio con default 0.
- Añade número, fecha, instantánea JSONB y token nullable a pedidos.
- Crea índices únicos para catálogo/número y para token; los `NULL` históricos no colisionan.
- Añade CHECK para contador no negativo y número positivo. Como otras CHECK SQL del proyecto, no están representadas por Prisma PSL; conservarlas al reconstruir esquemas.

Este bloque no modifica datos históricos, números, tokens, instantáneas ni migraciones anteriores. No hace emisión masiva retroactiva. Si se reintenta un POST idempotente para un pedido sin cotización, puede emitirse ahora usando fecha y condiciones actuales; nunca se inventa una instantánea del pasado. El contador existente continúa donde estaba.

Antes de desplegar, el responsable debe:

1. Revisar el diff y, en un entorno aislado que ya tenga el esquema de cotizaciones, verificar concurrencia y rollback contra PostgreSQL real. No aplicar migraciones como parte de este bloque. Se mantienen las recomendaciones de respaldo y operación de [migrations.md](migrations.md).
2. Confirmar `PUBLIC_API_URL=https://catalog-api-jma7.onrender.com/api` en el entorno de despliegue. Ahora también está declarada con `sync: false` en `render.yaml`; el Blueprint debe recibir su valor. No se cambiaron variables reales ni el panel. No hay secreto nuevo. Si falta o es inválida, el pedido se guarda y solo falta la cotización.
3. Tras autorización separada, desplegar API y luego frontend. Verificar creación con y sin cotización, mismo pedido al reintentar, número o «Sin cotización» en el panel y enlace condicional en WhatsApp. No se afirma que abrir WhatsApp envíe el mensaje. No hay pasos de migración para este cambio.

Rollback de aplicación: volver al código anterior puede dejar las columnas aditivas en su sitio; no borrar números, tokens o instantáneas ya emitidos. No hay migración inversa automática. Si se vuelve temporalmente a una API antigua, los pedidos creados allí no tendrán cotización; no deben reconstruirse como originales.

## Verificación disponible

`npm.cmd test` conserva las pruebas de archivado, idempotencia, consulta protegida, cabeceras, cancelación, validación, PDF real y logo. Las expectativas de la transacción principal se ajustaron: ahora se exige que no toque campos de cotización. Las diez nuevas pruebas cubren fallo de emisión, configuración ausente, reintento del mismo pedido, fallo del logger/formato, emisión concurrente única, rollback tras incremento o actualización fallida, recuperación sin renumerar y cancelación/pertenencia. Los servidores de pruebas son loopback; no se lee ni modifica una base de datos ni se contacta Storage real.

El verificador optativo `src/scripts/verify-order-idempotency-postgres.ts` quedó preparado para comprobar números distintos en solicitudes concurrentes, mismo enlace en reintentos y rechazo de pedidos archivados sin incrementar contador. Fija la URL de la API al servidor loopback del ensayo y limpia únicamente sus fixtures, eliminando pedidos antes de catálogos por RESTRICT. Solo admite la base local `catalogo_test`. **No se ejecutó**: requiere primero la migración en esa base bajo autorización separada. Tampoco ejecuta migraciones por su cuenta.

Fuera de alcance: editor avanzado de condiciones, emisión al confirmar, cambios de inventario, numeración retroactiva, conversión de WebP, firma digital y factura electrónica. La documentación OpenAPI generada quedó intacta por restricción; el contrato nuevo se describe aquí.
