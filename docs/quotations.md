# Cotizaciones de pedidos

## Emisión

Al registrar un pedido `PENDING` se guarda una solicitud de cotización con número `COT-000001` por catálogo, fecha de emisión y validez comercial de 15 días. El PDF indica **Solicitud sujeta a confirmación**. No es una confirmación del vendedor y no cambia inventario, precios ni transiciones de estado. Cambiar a `CONFIRMED` no emite otro documento.

`Catalog.nit` y `Catalog.quotationTerms` son opcionales y editables en la configuración existente. La garantía forma parte de `quotationTerms`; no hay campo independiente. El NIT admite números, puntos, espacios y guion (hasta 30 caracteres); condiciones son texto plano de hasta 4000 caracteres. Ambos se validan en controlador y repositorio.

Se congelan en `Order.quotationSellerSnapshot` nombre, NIT, teléfono, WhatsApp, dirección, horario, correo, redes y condiciones. La fecha se guarda en `quotationIssuedAt`. Cliente, nombre del producto, cantidades, precios unitarios, subtotales y total proceden del pedido persistido, nunca de precios enviados por el navegador. Los importes se muestran en COP y las fechas en `America/Bogota`.

El logo es deliberadamente el **actual** del catálogo, incluso al volver a descargar una solicitud anterior. No se conserva el logo histórico ni se necesita recuperar un objeto eliminado. Si no hay NIT o logo, se omiten sin bloquear la emisión. La fuente estándar cubre español y caracteres latinos; controles se eliminan y caracteres fuera de ese repertorio, incluidos emojis, se sustituyen por `?` en el PDF.

## Consecutivo e idempotencia

La transacción de creación verifica `active: true, archivedAt: null`, recupera un recibo previo si hay clave idempotente y calcula precios con productos persistidos. Luego realiza un incremento atómico de `Catalog.quotationCounter` mediante `UPDATE`, con el mismo filtro de publicación. Esa actualización bloquea la fila del catálogo hasta commit/rollback. Dentro de la misma transacción se lee el contador resultante y la información comercial y se crea el pedido con su instantánea.

Otra transacción del mismo catálogo debe esperar ese bloqueo antes de incrementar; una de otro catálogo puede continuar. No se usa `count() + 1`. El índice único `(catalogId, quotationNumber)` protege además la unicidad. Si falla la creación, también se revierte el incremento. Ante una carrera de idempotencia, el conflicto de unicidad revierte toda la transacción y se recupera el recibo persistido, incluido su número y enlace originales. Un pedido cancelado conserva su número; no se reutiliza.

Base del mecanismo: [bloqueos de filas de PostgreSQL](https://www.postgresql.org/docs/17/explicit-locking.html). Las pruebas de este bloque verifican las operaciones y filtros con dobles de base de datos; **no certifican concurrencia real en PostgreSQL con la nueva migración**, porque no se autorizó aplicarla.

## Descarga y privacidad

Ruta de API:

```text
GET /api/public/catalogs/:publicId/orders/:orderId/quotation.pdf?token=TOKEN_DE_LA_COTIZACION
```

Cada pedido nuevo recibe un token aleatorio de 32 bytes (256 bits), representado por 64 caracteres hexadecimales. El token persistido permite que un reintento idempotente recupere exactamente el mismo enlace. Es una credencial de acceso al documento: se guarda en la base de datos, no se registra en logs ni se añade al listado privado de pedidos. La respuesta de creación entrega solo el enlace que lo contiene, no un campo adicional con el token.

La consulta exige conjuntamente el identificador del pedido, la relación del catálogo con el `publicId`, el token y estado distinto de `CANCELLED`. Sin autorización o para pedidos históricos sin cotización devuelve 404 uniforme. No depende del catálogo público actual: un catálogo archivado no destruye el acceso a solicitudes anteriores. Al cancelar el pedido queda revocado para peticiones posteriores. Se vuelve a comprobar autorización antes de enviar los bytes, después del trabajo de logo/PDF. Un PDF ya descargado no se puede revocar ni borrar de otro dispositivo.

Los 15 días son validez comercial del documento, no caducidad del enlace: el enlace sigue accesible mientras exista el pedido y no esté cancelado, conforme a la decisión de dominio.

Cabeceras: `Content-Type: application/pdf`, `Content-Disposition: inline; filename="COT-000001.pdf"`, `Cache-Control: private, no-store`, `X-Robots-Tag: noindex, nofollow, noarchive`, `Referrer-Policy: no-referrer` y `X-Content-Type-Options: nosniff`. El nombre del archivo solo usa el número generado. No hay almacenamiento público del PDF, ni redirección a Storage.

La ruta admite 30 descargas por 15 minutos/IP, además del límite global de API. Se limita a dos generaciones simultáneas por instancia y 8 MiB de salida. Al saturarse devuelve 503 para reintentar. La cabecera de privacidad también se establece antes del limitador específico. Antes de desplegar hay que revisar que la infraestructura no registre URLs con query tokens; esta sesión no inspeccionó ni cambió los logs de Render. No incluir estos enlaces en analítica, sitemap o páginas indexables. La política pendiente de retención/anonimización debe cubrir las instantáneas y los enlaces, no solo el pedido original.

## Logo y PDFKit

Se usa únicamente PDFKit 0.20.2 y sus dependencias transitivas. No se instala un navegador ni una biblioteca de conversión. Como el paquete no incluye tipos, `src/types/pdfkit.d.ts` declara estrictamente el subconjunto utilizado, sin instalar otra dependencia.

Se descarga el objeto actual directamente de Storage autenticado y se incrustan los bytes en el PDF. El destino procede de `SUPABASE_URL` y se limita a HTTPS de proyectos `*.supabase.co`; la ruta debe pertenecer a `catalogId/branding/` en el bucket existente `product-images`. No se aceptan rutas arbitrarias ni redirecciones. No se crea ni se conserva una URL firmada.

Descarga máxima: 5 MiB y 5 segundos incluyendo el cuerpo. Se verifica firma binaria JPEG/PNG y dimensiones hasta 16 millones de píxeles antes de decodificar. Los PNG también se descomprimen con tope de 64 MiB y se validan sus filas/filtros antes del decodificador asíncrono de PDFKit. WebP se omite, tanto por extensión como por firma; no se convierte. Si Storage falla o el logo es inválido, se entrega el PDF sin logo. Nunca se registran errores que puedan incluir credenciales de Storage.

## Migración y despliegue pendiente

La única migración nueva es `20261024120000_order_quotations` y **no se ha aplicado**:

- Añade `nit` y `quotationTerms` nullable a catálogos y contador entero obligatorio con default 0.
- Añade número, fecha, instantánea JSONB y token nullable a pedidos.
- Crea índices únicos para catálogo/número y para token; los `NULL` históricos no colisionan.
- Añade CHECK para contador no negativo y número positivo. Como otras CHECK SQL del proyecto, no están representadas por Prisma PSL; conservarlas al reconstruir esquemas.

No elimina datos, no cambia migraciones anteriores ni asigna cotizaciones retroactivas. Los pedidos históricos siguen sin número, token, fecha o instantánea de vendedor; sus reintentos devuelven cotización nula. La primera solicitud nueva empieza en 1 por catálogo. Crear índices y restricciones puede bloquear escrituras durante su ejecución; evaluar tamaño real de tablas y ventana de mantenimiento.

Antes de desplegar, el responsable debe:

1. Revisar el diff y probar la migración en una base aislada, bajo autorización separada. Probar pedidos concurrentes con claves distintas (números diferentes), con la misma clave (un pedido y mismo enlace), rollback sin consumir número y catálogos archivados rechazados. Esta prueba no se ejecutó en este bloque.
2. Preparar respaldo restaurable según [migrations.md](migrations.md).
3. Configurar `PUBLIC_API_URL` con la URL HTTPS real de la API **incluyendo `/api`**, sin barra final, credenciales ni query. Solo se cambiaron los archivos `.env.example` y `.env.production.example`. La creación valida esta configuración antes de escribir el pedido; no toma el origen de `Host` ni del cliente. No hay secreto nuevo.
4. Aplicar y verificar la migración **antes del push que pueda desplegar código dependiente**. Comprobar columnas, dos índices únicos, dos CHECK y estado de migraciones. La API anterior tolera las columnas añadidas.
5. Desplegar API antes que frontend y comprobar un pedido de prueba autorizado, texto/enlace de WhatsApp, descarga, omisión de WebP y revocación por cancelación. El frontend conserva el flujo anterior para recibos históricos sin PDF. No se afirma que abrir WhatsApp envíe el mensaje.

Rollback de aplicación: volver al código anterior puede dejar las columnas aditivas en su sitio; no borrar números, tokens o instantáneas ya emitidos. No hay migración inversa automática. Si se vuelve temporalmente a una API antigua, los pedidos creados allí no tendrán cotización; no deben reconstruirse como originales.

## Verificación disponible

`npm.cmd test` incluye pruebas nuevas de filtros de archivado, asignación e idempotencia, consulta protegida, cabeceras y cancelación, validación de campos, PDF real y logo. La prueba HTTP usa servidor local y datos simulados, con PDFKit real. Se examinan cabecera `%PDF-`, final `%%EOF`, texto descomprimido, precios, fecha de Colombia, solicitud/validez, paginación con 50 productos y condiciones largas, y objeto de imagen incrustado. No se lee ni modifica una base de datos ni se contacta Storage real.

El verificador optativo `src/scripts/verify-order-idempotency-postgres.ts` quedó preparado para comprobar números distintos en solicitudes concurrentes, mismo enlace en reintentos y rechazo de pedidos archivados sin incrementar contador. Fija la URL de la API al servidor loopback del ensayo y limpia únicamente sus fixtures, eliminando pedidos antes de catálogos por RESTRICT. Solo admite la base local `catalogo_test`. **No se ejecutó**: requiere primero la migración en esa base bajo autorización separada. Tampoco ejecuta migraciones por su cuenta.

Fuera de alcance: editor avanzado de condiciones, emisión al confirmar, cambios de inventario, numeración retroactiva, conversión de WebP, firma digital y factura electrónica. La documentación OpenAPI generada quedó intacta por restricción; el contrato nuevo se describe aquí.
