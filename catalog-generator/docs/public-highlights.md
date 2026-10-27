# Catálogo público: banners, destacados e identidad

Fase 2B-2 implementada localmente. No se ejecutaron operaciones Git, migraciones
ni acciones contra Supabase, Render o Vercel. Sin dependencias nuevas ni cambios
en el panel privado o la landing.

## Contrato y render

`public-catalog.server.ts` conserva una lectura de API por petición compartida
con metadata. `public-catalog-data.ts` normaliza las colecciones opcionales:
ausencia o tipo incorrecto produce listas vacías; elementos incorrectos se
descartan individualmente. La validación original de los datos base se conserva.
Se comprueban destinos, URL de imagen, protocolo externo, orden y duplicados.
Los destacados reutilizan los productos canónicos del catálogo, sin aceptar
precios alternativos ni productos ajenos; devuelve cero o entre tres y cinco.
Los banners se limitan a tres y los destacados no dependen de `pageProducts`.

Las cuatro plantillas llaman componentes comunes, sin cambiar sus títulos,
fondos, tipografías ni decoraciones editoriales. Orden:
identidad/cabecera, banners, destacados, categorías/listado y contacto.
Los alias siguen normalizándose; las plantillas antiguas no se eliminan.

## Carrusel e identidad

`PublicHorizontalRail` comparte CSS scroll-snap, región con nombre, lista,
navegación y variantes de anchura. El HTML inicial incluye contenido y enlaces.
Los botones aparecen solo después de hidratar; sin JavaScript funcionan scroll
nativo, teclado y swipe. No hay autoplay. Movimiento reducido usa scroll inmediato.
Hay espacio interior para el contorno de foco, incluido el offset del tema.
Un solo banner usa bloque estático. Secciones vacías no generan contenedores.

Las tarjetas reutilizan `PublicProductCard`, con `sizes` específico del carrusel.
Las imágenes de banners reservan 16:9 con recorte centrado; la primera es eager
y las restantes lazy. Texto y subtítulo están en otro panel completamente opaco.

`PublicCatalogIdentity` reserva cajas de logo de 40/56 px y ancho acotado,
sin recortar ni deformar la marca. Sin logo aumenta el tamaño del nombre.
Teléfono y horario corto se adaptan en filas. Horarios extensos o multilínea
enlazan al contacto completo, que conserva todos los datos al final.

## Categorías y SEO

Los filtros son enlaces nativos a `/c/PUBLIC_ID?category=ID#productos`.
La página espera `searchParams`, valida contra las categorías recibidas y aplica
el filtro en el HTML inicial. Un valor desconocido, repetido o excesivo muestra
Todos; no convierte el catálogo en un 404.

Con JavaScript, el clic normal preserva búsqueda y orden actuales, reinicia
la página y actualiza la URL con History. Atrás/adelante restaura la categoría.
Los clics modificados conservan el comportamiento nativo del enlace.
Los banners de categoría usan el mismo destino y comportamiento.

No cambia el canonical del catálogo, robots, sitemap ni Open Graph. Los enlaces
son rastreables; no se promete indexación independiente de cada filtro.

## Contraste

El panel usa `--catalog-surface`, `--catalog-text` y `--catalog-text-muted`.
Los fallbacks están limitados al componente, sin escribir `--catalog-*` ni tokens
globales. Tecnología mantiene superficie oscura. El resolvedor sigue en servidor.

Mínimo de texto medido en Chromium sobre estilos computados del panel:

| Paleta o fallback | Contraste mínimo |
| --- | --- |
| Bosque | 7,58:1 |
| Océano | 7,58:1 |
| Terracota | 7,58:1 |
| Rosa | 7,58:1 |
| Violeta | 7,58:1 |
| Grafito | 7,58:1 |
| Menta noche | 9,85:1 |
| Ámbar noche | 9,85:1 |
| Sin preset: Tecnología | 8,64:1 |
| Sin preset: Ropa | 5,12:1 |
| Sin preset: Belleza/Glamour | 5,03:1 |

TECH se prueba con sus dos paletas compatibles; las demás con las ocho.
El panel no cambia colores ni opacidad al pasar el puntero o recibir foco.

## Comprobaciones reproducibles

Desde `catalog-generator`, después de construir:

```powershell
node scripts/verify-public-highlights.mjs
node scripts/verify-public-highlights-browser.mjs
node scripts/verify-public-seo.mjs
```

El primer script comprueba normalización y categorías. El navegador usa API
simulada en loopback y un perfil descartable de Chromium. Revisa 120 casos
de plantilla/paleta/ancho, ausencia de contenido, banner único, logos, contraste,
paginación, filtros, history, movimiento reducido y contenido sin JavaScript.
También mide los scripts iniciales del HTML, sumando gzip por archivo igual que
la referencia: 160.370 bytes. Se detiene si supera +15.000 bytes gzip.

La medición excluye imágenes, CSS y payload HTML/RSC. No valida Storage o base
de datos reales, plataformas externas, lector de pantalla manual ni un teléfono
físico. La interacción táctil se simula con el protocolo nativo de Chromium.

Medición final de esta fase: 543.142 → 547.263 bytes sin comprimir;
160.370 → 162.049 bytes gzip (+1.679), conservando 11 scripts iniciales.
Con preset nulo y oscuro se cargan los mismos scripts; el registro de paletas
no aparece en el JavaScript inicial.
