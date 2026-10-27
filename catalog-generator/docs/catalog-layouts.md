# Distribución del catálogo

Implementación local de la fase 2B-3. No se aplican migraciones ni se realizan
operaciones de Git o acciones sobre servicios externos.

## Contrato

`Catalog.layoutPreset String?` es independiente de plantilla y paleta:

| Valor persistido | Distribución | Plantillas |
| --- | --- | --- |
| `null` | Clásica | TECH, FASHION, BEAUTY, GLAMOUR |
| `sidebar` | Lateral | Las cuatro |
| `sidebar-compact` | Lateral compacta | Las cuatro |

Creación y PUT existentes admiten esos valores. Omisión conserva el valor;
null restablece Clásica. Zod rechaza IDs desconocidos al escribir. La lectura
pública normaliza valores desconocidos, ausentes o incorrectos a null y conserva
el catálogo. GRID sigue siendo un alias histórico de TECH, nunca un layout.
El registro y normalizador están en `lib/catalog-layout.ts`, fuera del resolvedor
de color. Se conserva el filtro por propietario de las escrituras.

Migración nueva, aditiva y no aplicada:

```sql
ALTER TABLE "catalogs" ADD COLUMN "layoutPreset" TEXT;
```

Los catálogos existentes quedan en null. Aplicar antes de publicar la API que
consulta la columna. La reversión de código puede dejar la columna nullable
sin uso; eliminarla perdería las preferencias y requiere otra decisión.

## Presentación

Las cuatro plantillas entregan sus bloques existentes a `PublicCatalogLayout`.
Cabecera, banners y destacados quedan fuera y conservan ancho y orden.
El estado y los callbacks permanecen en `PublicCatalogPage`.

Clásica devuelve un fragmento: categorías, sección de productos con sus clases
originales, encabezado, toolbar, tarjetas y paginación. No añade wrapper,
atributos de distribución ni reglas nuevas al catálogo clásico. El contacto
completo permanece al final en las tres variantes.

Por debajo de 1024 px, el aside usa `display: contents`, conserva la barra
horizontal y oculta el resumen adicional de contacto. Desde 1024 px aparece
la columna de 256 px (Lateral) o 192 px (Compacta). No se utiliza matchMedia,
ni se remonta el árbol al redimensionar. Desde el bloque de acceso superior,
el carrito se renderiza una sola vez antes de la plantilla, en su franja sticky;
las categorías conservan su ubicación pero ya no son sticky. Lateral apila la toolbar;
Compacta la conserva encima del listado. Los controles no se duplican.

Solo las variantes laterales activan un contenedor CSS `catalog-products`.
Su rejilla usa dos columnas; desde 660 px disponibles usa tres, y desde
900 px, cuatro. Los breakpoints de Clásica se conservan sin cambios.
El resumen lateral reutiliza `PublicCatalogContact compact`, sin ID; solo
el contacto completo tiene `id="contacto"`.

## Selector

CatalogSettings integra tres radios nativos en el borrador existente, después
de las paletas. Sus esquemas son CSS, sin imágenes ni librerías. Texto de
selección, borde y foco identifican la opción activa. Elegir no hace peticiones;
guardar envía layoutPreset junto con los demás campos mediante el PUT existente.

## Verificación local

`scripts/fixtures/public-layout-classic.json` contiene 150 hashes de referencia,
capturados antes del cambio. `verify-public-layouts-browser.mjs --record-classic`
sirve para capturarlos sobre un build de referencia deliberado. Ejecutarlo
sin ese argumento compara estilos computados y geometría con esos hashes;
no se debe regenerar para aceptar una regresión. No es una comparación de píxeles.
El verificador descuenta la altura de la franja superior autorizada al comparar
la geometría histórica. Desde ese bloque utiliza `public-layout-classic-content.json`,
derivado de la misma captura original: omite coordenadas internas SVG sensibles
al redondeo de 0,01 px al trasladar la página; conserva estilos y geometría HTML.
Los hashes originales de `public-layout-classic.json` permanecen intactos.
La referencia comprende cabecera, destacados, listado y contacto; la barra de
categorías conserva su componente sin modificaciones y se comprueba funcionalmente.

El script usa API simulada en loopback 4347 y Next en 4348. Construir primero
con `NEXT_PUBLIC_CATALOG_API_URL=http://127.0.0.1:4347/api`, solo en el proceso.
Ese build es para pruebas, no para publicar.

Comprueba 320, 390, 768, 1024 y 1440 px, las paletas compatibles, variantes
laterales, ausencia de desbordamiento, destacados, un único contacto, fallback,
redimensionado y navegación sin JavaScript. `--layouts-only` omite la comparación
clásica para diagnóstico. `verify-catalog-highlights-browser.mjs --layout-settings`
comprueba el selector contra otra API simulada, incluyendo guardado, teclado,
árbol de accesibilidad y preservación del formulario.

La prueba de persistencia usa dobles del repositorio; no acredita la migración
en PostgreSQL. No se prueba lector de pantalla humano ni despliegue remoto.

## Inventario de cambios

Rutas relativas a la raíz del repositorio:

| Archivo | Cambio |
| --- | --- |
| `catalog-api/prisma/schema.prisma` | Campo nullable layoutPreset. |
| `catalog-api/prisma/migrations/20261027120000_catalog_layout_preset/migration.sql` | Añade la columna TEXT, sin aplicar. |
| `catalog-api/src/schemas/catalog.schema.ts` | Validación de creación/actualización: dos IDs, null u omisión. |
| `catalog-api/src/services/catalog.service.ts` | Tipos y propagación del campo existente. |
| `catalog-api/src/repositories/catalog.repository.ts` | Tipos de escritura y selección pública explícita. |
| `catalog-api/src/schemas/catalog.schema.test.ts` | Valores admitidos/rechazados e independencia de plantilla. |
| `catalog-api/src/repositories/catalog-theme.test.ts` | Persistencia parcial, propietario, selección pública y rechazo HTTP desconocido. |
| `catalog-generator/lib/api.ts` | Contratos Catalog/PublicCatalog. |
| `catalog-generator/lib/catalog-layout.ts` | Registro y normalizador independiente. |
| `catalog-generator/lib/public-catalog-data.ts` | Fallback de lectura sin invalidar el catálogo. |
| `catalog-generator/components/public/PublicCatalogLayout.tsx` | Composición común y fragmento clásico. |
| `catalog-generator/components/public/PublicCatalogLayout.module.css` | Sidebar, toolbar apilada, mobile y container queries; contador legible en sidebar TECH. |
| `catalog-generator/components/public/TechnologyTemplate.tsx` | Entrega sus bloques existentes al contenedor. |
| `catalog-generator/components/public/FashionTemplate.tsx` | Misma integración, conserva contenido editorial. |
| `catalog-generator/components/public/BeautyTemplate.tsx` | Misma integración, conserva contenido editorial. |
| `catalog-generator/components/public/GlamourTemplate.tsx` | Misma integración, conserva contenido editorial. |
| `catalog-generator/components/public/PublicCatalogContact.tsx` | Resumen reutilizable sin duplicar ID; footer original intacto. |
| `catalog-generator/components/catalogs/CatalogSettings.tsx` | Borrador, selector y PUT sin perder otros campos. |
| `catalog-generator/components/catalogs/CatalogLayoutSelector.tsx` | Radios nativos y esquemas CSS. |
| `catalog-generator/scripts/verify-public-highlights.mjs` | Fallback y compatibilidad de lectura. |
| `catalog-generator/scripts/verify-public-layouts-browser.mjs` | Matriz pública, hashes, responsive, no-JS y estado. |
| `catalog-generator/scripts/fixtures/public-layout-classic.json` | 150 hashes anteriores al cambio. |
| `catalog-generator/scripts/verify-catalog-highlights-browser.mjs` | Modo de prueba del selector con guardados simulados. |
| `catalog-generator/scripts/verify-public-seo.mjs` | Puerto de fixture alternativo para reutilizar el mismo build local. |
| `catalog-generator/docs/catalog-layouts.md` | Contrato, migración, presentación, pruebas e inventario. |

## Resultados locales del 27 de octubre de 2026

- API: build correcto; 163/163 pruebas (160 anteriores y tres nuevas).
- Frontend: build correcto con TypeScript; lint sin errores y con las cuatro
  advertencias previas de img; importador 17/17.
- Normalizador público y verificador SEO correctos; metadata, lectura compartida,
  404, fallos temporales y PNG OG probados con API simulada. Para reutilizar este
  build, ejecutar SEO con `PUBLIC_SEO_API_PORT=4347` en el proceso.
- 150 referencias clásicas de geometría/estilos; 300 casos laterales con las
  paletas compatibles y cinco anchos. La referencia es de Chromium en Windows,
  con fuentes externas bloqueadas; no demuestra identidad de píxeles entre motores.
- 40 casos laterales sin JavaScript y clic nativo de categoría. Redimensionar
  conserva búsqueda, orden, página, categoría, cantidades y carrito.
- Selector: 15 guardados en cinco anchos, null explícito, borrador sin guardado
  automático, flechas nativas, foco, árbol accesible y formulario preservado.
- Movimiento reducido y navegación nativa por teclado/swipe verificados con
  los carruseles existentes. Sin errores de ejecución del navegador.

Peso de scripts iniciales, sumando gzip por recurso servido:

| | Antes | Después | Diferencia |
| --- | ---: | ---: | ---: |
| JavaScript sin comprimir | 547.263 B | 549.481 B | +2.218 B |
| JavaScript gzip | 162.049 B | 162.587 B | +538 B |
| Chunks iniciales | 11 | 11 | 0 |

Registro de paletas excluido del JavaScript inicial, igual que antes.

Texto lateral medido con estilos computados y composición de fondos, incluido
placeholder y estados seleccionados, mínimo entre las plantillas compatibles:

| Paleta | Mínimo |
| --- | ---: |
| Sin paleta | 4,55:1 |
| Bosque | 7,13:1 |
| Océano | 6,70:1 |
| Terracota | 7,24:1 |
| Rosa | 7,24:1 |
| Violeta | 7,10:1 |
| Grafito | 7,24:1 |
| Menta noche | 9,85:1 |
| Ámbar noche | 9,85:1 |

Hallazgo separado: el placeholder del buscador clásico sin paleta mantiene su
contraste previo de 3,55:1. No se modifica por la garantía de identidad de Clásica.
Las distribuciones nuevas refuerzan ese placeholder y el contador lateral TECH
con reglas exclusivamente locales; no cambian tokens globales ni el resolvedor.

Pendiente fuera del alcance: ensayo/aplicación de la migración en PostgreSQL,
despliegue, comprobación remota, otros motores y lector de pantalla humano.
