# SEO y tarjetas públicas

El dominio canónico es `https://catalogo-pink.vercel.app`. La raíz `/` es la landing pública y sobrescribe explícitamente los robots del layout con `index, follow`, canonical raíz y metadata propia de Vitrinaya. El listado privado reside en `/dashboard`. Login y dashboard conservan `noindex, nofollow` del layout raíz; carrito lo define expresamente. Catálogos y productos publicados mantienen su metadata de servidor, canonical, Open Graph y Twitter. Esto no sustituye autenticación.

## Rastreo, indexación y sitemap de marca

[app/robots.ts](../app/robots.ts) genera `/robots.txt` con `User-Agent: *`, `Allow: /` y la URL absoluta del sitemap. No usa `Disallow`: bloquear el rastreo impediría al buscador leer el `noindex` de login, dashboard y carrito. Rastreo permitido no significa indexación permitida; la exclusión de esas páginas se conserva en su metadata HTML. Robots no es un mecanismo de autorización.

[app/sitemap.ts](../app/sitemap.ts) genera `/sitemap.xml` con exactamente una URL: `https://catalogo-pink.vercel.app/`. No incluye login, dashboard, carrito ni URLs de vendedores. No inventa `lastModified`. Ambas rutas usan `MetadataRoute`, son estáticas y no consultan API, base de datos, sesión ni cabeceras de la petición. El dominio procede de `SITE_URL`, coherente con `metadataBase`, y nunca de `Host`.

El `noindex` del layout raíz afecta a las páginas HTML que lo heredan; no filtra las entradas del sitemap ni se aplica al contenido XML/texto de estos manejadores. La landing lo sobrescribe explícitamente. La lista del sitemap debe mantenerse deliberadamente limitada a URLs canónicas indexables.

La separación entre rastreo e indexación se explica en la [documentación de Google sobre noindex](https://developers.google.com/search/docs/crawling-indexing/block-indexing). Un sitemap ayuda al descubrimiento; no garantiza la indexación.

## Lecturas y errores

`public-catalog.server.ts` valida la respuesta de la API pública existente, usa un límite de 8 segundos (incluida lectura JSON) y `cache: no-store`. React `cache` comparte la promesa exclusivamente durante una petición entre layout, metadata y página. Los componentes de catálogo/producto reciben los datos iniciales y no vuelven a consultar el catálogo al hidratar. Las reseñas del producto siguen teniendo su consulta independiente en cliente. El carrito conserva su carga cliente existente.

Solo un 404 de la API o un producto ausente produce `notFound()`. Una respuesta inválida, 429, 5xx, fallo de red o timeout muestra un estado temporal con enlace Reintentar y metadata noindex; no se convierte en ausencia ni se reintenta automáticamente, para no amplificar el límite de 120 lecturas por 15 minutos. El enlace vuelve a solicitar la página al servidor. La página de error temporal puede responder 200; su metadata noindex evita ofrecerla para indexación.

La metadata se resuelve antes del streaming (`htmlLimitedBots: /.*/`) para que las etiquetas y la decisión de ausencia están disponibles antes de la respuesta. Esto aumenta la espera inicial hasta resolver la API (máximo 8 segundos para la lectura). El layout de producto comprueba ausencia antes del loading del segmento: sin esa barrera el streaming podía devolver 200 para un producto inexistente.

## Imagen estable

`/c/[publicId]/og` y `/c/[publicId]/og?product=[slug]` devuelven bytes, nunca una redirección. Cada petición consulta la API pública para comprobar publicación: inexistentes, inactivos, archivados y productos ausentes devuelven 404; fallo de API devuelve 503 y Retry-After 30.

El catálogo usa logo; producto usa primera imagen, después logo y finalmente PNG generado con `next/og`. Si la imagen no se puede descargar o validar, también se genera el fallback. No requiere credenciales de Storage en Next.js ni hace público el bucket.

Solo se descargan URLs HTTPS con hostname de proyecto `*.supabase.co`, sin puerto explícito no estándar, usuario ni contraseña, y ruta `/storage/v1/object/sign/product-images/`. No se aceptan destinos arbitrarios, IP, HTTP ni redirects. La firma procede de la API de confianza, no de un parámetro del visitante. Descarga máxima 5 MiB, timeout 5 segundos incluyendo streaming y comprobación de firma binaria PNG/JPEG/WebP/GIF. No se sirven SVG ni contenido HTML. Se añade `nosniff`.

Política deliberada de caché: sin caché persistente en la aplicación, fetch `no-store` y respuesta `Cache-Control: no-store, max-age=0`. La invalidación ocurre en cada petición: se comprueba de nuevo publicación y se obtiene la firma vigente. No quedan logos anteriores o catálogos archivados servidos desde nuestra caché. La página y la imagen son solicitudes HTTP independientes y cada una consume una lectura de API; no se promete una única lectura entre ambas. Esta decisión prioriza vigencia y revocación sobre ahorro de consultas. Una caché futura requiere invalidación coordinada con cambios y archivado; no se implementa aquí. Las plataformas externas pueden guardar sus propias tarjetas; no controlamos esa retención.

## Verificación local sin producción

Desde `catalog-generator`, construir para la API simulada (variable solo del proceso):

```powershell
$env:NEXT_PUBLIC_CATALOG_API_URL = 'http://127.0.0.1:4317/api'
npm.cmd run build
node scripts/verify-public-seo.mjs
Remove-Item Env:NEXT_PUBLIC_CATALOG_API_URL
```

El script usa los puertos loopback 4317 y 4318, arranca el build con Next, comprueba metadata en head sin ejecutar JavaScript, lecturas compartidas, ausencias, noindex, errores, timeout y PNG de fallback, y cierra sus procesos. Ese build local contiene la URL simulada: no se debe publicar; un despliegue real debe compilar de nuevo con su configuración correcta. No se han modificado archivos de entorno reales.

## Pendiente

- Sitemap de catálogos y productos de vendedores: pendiente. Necesita un endpoint público paginado y una decisión de privacidad por catálogo antes de enumerar sus URLs. No se crea ese endpoint ni se cambia su indexabilidad actual en este bloque.
- Visibilidad por catálogo: todos los públicos activos son indexables por defecto; la opción individual no está implementada.
- Verificación real de WhatsApp y descargas Supabase tras despliegue autorizado. Las pruebas locales no demuestran el comportamiento de cachés externas ni conectividad de producción.
