# Paletas del catálogo

La sugerencia efímera desde el logo se describe en
[Paleta sugerida desde el logo](logo-palette-suggestion.md): solo cambia el
borrador tras aceptación y conserva el guardado mediante el formulario.

Fases 2A y 2B, implementación local del 26 de octubre de 2026. No se ha aplicado
la migración ni se ha desplegado el cambio.

## Contrato y compatibilidad

`Catalog.themePreset` es un `String?`. Crear o actualizar admite los ocho IDs
curados, `null` y omisión. Omitir conserva el valor; `null` lo elimina. La
validación Zod se ejecuta antes de guardar y las actualizaciones mantienen
`where: { id, userId }`. No hay endpoint nuevo.

Desde 2B, el servidor valida también la combinación resultante. Si se envía
template o preset, lee ambos valores persistidos bajo `FOR UPDATE` por ID y
propietario, valida el par combinado y escribe en la misma transacción. Una
petición parcial o concurrente no puede crear un par incompatible. Las
incompatibilidades producen HTTP 400 con un mensaje comprensible, sin detalles
internos. Los campos ajenos a apariencia conservan su actualización original.

Los IDs son `forest`, `ocean`, `terracotta`, `rose`, `violet`, `graphite`,
`night-mint` y `night-amber`. TECH, incluido su alias GRID, solo admite las dos
paletas nocturnas. FASHION, BEAUTY y GLAMOUR admiten las ocho.
EDITORIAL → FASHION y BOUTIQUE → BEAUTY conservan su normalización.

La lectura pública acepta un ID desconocido como string y sigue entregando el
catálogo. Para una respuesta de API anterior también admite el campo ausente.
El resolvedor devuelve **undefined** ante ausencia, null, ID desconocido o
incompatibilidad. No emite siquiera `colorScheme` en esos casos.

Los colores anteriores permanecen como fallback en cada consumidor. Los mapas
predeterminados del carrito y las variables predeterminadas de las tarjetas no
se han sustituido por una paleta aproximada. Las diferencias deliberadas con
preset nulo son las correcciones autorizadas de WhatsApp y del texto de
"Enviar reseña". Tamaño, posición, fondo y semántica de la reseña se conservan.

Las transparencias requieren conservar la expresión completa de Tailwind como
fallback. Convertir directamente `bg-[#fffdfa]/95` en una variable con `/95`
puede cambiar el redondeo del color generado. Las expresiones `color-mix` del
fallback conservan el resultado anterior, incluidas las referencias originales
a `--color-white` y `--color-black`. No se escriben esos tokens globales.

## Resolvedor y carga

[`resolveCatalogTheme`](../lib/catalog-theme.ts) es puro. Conserva los ocho
colores base aprobados y deriva `borderSubtle`, superficies suaves, imagen,
hover, foco, ofertas, errores, éxito, transparencias, degradados y sombras.
`border` identifica controles y `borderSubtle` separaciones decorativas. Los
roles de estado dependen del modo claro/oscuro y mantienen su significado.

La función devuelve `--catalog-*`, los 18 adaptadores de color/sombra
`--product-card-*` y los diez `--cart-*`. También define `colorScheme` únicamente
en el contenedor público personalizado. No cambia disposición, radios ni fuentes.

- Las páginas de catálogo y producto importan el resolvedor condicionalmente
  **en servidor**. Entregan solo el resultado serializable a sus componentes.
- El carrito mantiene su lectura cliente e importa el módulo con `import()`
  solo si la API entrega un preset no vacío. Publica catálogo y tema juntos,
  después de resolverlo. Un fallo al descargar ese chunk conserva el carrito
  con sus colores predeterminados.
- Los imports de tipos se eliminan del JavaScript. El registro de paletas no
  está en los scripts iniciales del catálogo ni se descarga al abrir su detalle.
- El CSS de foco está limitado al contenedor con `data-catalog-themed="true"`.
  Excluye WhatsApp, que conserva su identidad y foco propios.

Loading, landing y plantillas antiguas permanecen intactos. El panel incorpora
únicamente el selector y su integración en CatalogSettings.
`EditorialTemplate` sigue siendo el fallback del catálogo.

## Puntos conectados

Conteo reproducible de apariciones `var(--catalog-` por archivo. Incluye roles
de transparencia y sombra; un degradado con varios colores es un solo punto de
aplicación. No equivale al inventario previo de literales de color.

| Archivo en components/public | Puntos |
|---|---:|
| TechnologyTemplate.tsx | 37 |
| FashionTemplate.tsx | 26 |
| BeautyTemplate.tsx | 36 |
| GlamourTemplate.tsx | 36 |
| PublicCategoryFilter.tsx | 49 |
| PublicProductToolbar.tsx | 14 |
| PublicProductPagination.tsx | 24 |
| PublicCatalogPage.tsx | 4: dos existentes y dos de fondo/texto de raíz |
| PublicProductDetailPage.tsx | 108, más el texto del botón de reseña mediante style |
| PublicShoppingCartPage.tsx | 11, además de los diez adaptadores de su mapa existente |
| PublicCatalogContact.tsx | 3 opacidades |
| catalog-theme.module.css | 1 color de foco, limitado a paletas activas |

`PublicProductCard.module.css` no necesitó cambios: ya expone los 18 puntos de
color/sombra. Glamour continúa utilizando la variante beauty y recibe los
overrides de la paleta elegida.

`FloatingWhatsAppButton.tsx` cambia dos colores fijos, sin usar variables del
vendedor: fondo normal `#12813F` y hover `#0F7037`, con texto blanco.
Sus contrastes calculados son **4,96:1** y **6,19:1**, respectivamente.

Otros archivos modificados, relativos a su aplicación:

- Frontend: `app/c/[publicId]/page.tsx`,
  `app/c/[publicId]/producto/[productSlug]/page.tsx`, `lib/api.ts`,
  `lib/public-catalog.server.ts`, `lib/catalog-theme.ts`.
- API: `prisma/schema.prisma`, la migración enlazada más abajo,
  `src/schemas/catalog.schema.ts`, `src/schemas/catalog.schema.test.ts`,
  `src/services/catalog.service.ts`, `src/repositories/catalog.repository.ts`,
  `src/repositories/catalog-theme.test.ts`, `scripts/test.cjs`.
- Verificadores frontend: `scripts/verify-ui-pilot.mjs`,
  `scripts/public-theme-checks.mjs`, `scripts/public-theme-contrast.mjs`,
  `scripts/verify-catalog-theme.mjs`.
- Documentación: este archivo.

## Migración y operación futura

[`20261026120000_catalog_theme_preset/migration.sql`](../../catalog-api/prisma/migrations/20261026120000_catalog_theme_preset/migration.sql):

```sql
ALTER TABLE "catalogs" ADD COLUMN "themePreset" TEXT;
```

Es aditiva, nullable, sin DEFAULT, backfill ni índice. Los registros existentes
quedan en NULL. No se añadió `fontPreset`. Se generó el cliente Prisma local;
esa generación no aplica DDL ni consulta los datos de PostgreSQL.

Para un despliegue futuro autorizado: migración → API → frontend. La duración y
el bloqueo de ALTER TABLE no se midieron contra una base real. El rollback de
aplicación puede dejar la columna nullable; eliminarla no es necesario y
destruiría las elecciones guardadas. No hay variables de entorno nuevas.

## Repetir las comprobaciones

Antes de modificar los estilos, registrar el baseline contra fixtures locales.
Desde `catalog-generator`, en PowerShell:

```powershell
$env:NEXT_PUBLIC_CATALOG_API_URL = 'https://127.0.0.1:4317/api'
npm.cmd run build
node scripts/verify-ui-pilot.mjs --https-api --public-themes --record-theme-baseline "$env:TEMP/catalog-theme-baseline.json"
Remove-Item Env:NEXT_PUBLIC_CATALOG_API_URL
```

Después de los cambios, reconstruir con la misma URL de proceso y ejecutar:

```powershell
npm.cmd run lint
$env:NEXT_PUBLIC_CATALOG_API_URL = 'https://127.0.0.1:4317/api'
npm.cmd run build
Remove-Item Env:NEXT_PUBLIC_CATALOG_API_URL
node scripts/verify-catalog-theme.mjs
node scripts/verify-ui-pilot.mjs --https-api --public-themes --theme-baseline "$env:TEMP/catalog-theme-baseline.json"
npm.cmd test
```

Desde `catalog-api`, por separado:

```powershell
npm.cmd test
npm.cmd run build
```

SEO requiere su build HTTP específico; desde `catalog-generator`:

```powershell
$env:NEXT_PUBLIC_CATALOG_API_URL = 'http://127.0.0.1:4317/api'
npm.cmd run build
node scripts/verify-public-seo.mjs
Remove-Item Env:NEXT_PUBLIC_CATALOG_API_URL
```

Para volver a verificar carrito/navegador después, reconstruir con la URL HTTPS.

No publicar el build con la URL simulada: debe reconstruirse con la
configuración correcta en cualquier despliegue futuro autorizado.

El verificador reutiliza Chromium, OpenSSL y los puertos loopback 4317/4338 del
piloto. Bloquea solicitudes externas, usa productos y contactos sintéticos y
no envía formularios. Conserva el JSON de resultados y capturas en una carpeta
temporal; no añade capturas ni el baseline de unos 4,9 MB al repositorio.

La referencia compara colores sRGB renderizados, fondos/degradados, bordes,
sombras, opacidades, tipografía y dimensiones calculadas. Normaliza únicamente
la serialización de colores Lab/Oklab equivalente mediante canvas; no normaliza
geometría ni omite componentes, salvo el cambio autorizado de WhatsApp.

El contraste utiliza estilos calculados, compone superficies translúcidas y
evalúa los extremos de los degradados. Usa teclado y ratón reales, comprueba
foco visible y bordes de campos/controles, y respeta las excepciones de
contraste de controles deshabilitados. No equivale a una auditoría WCAG completa
con tecnologías de asistencia ni a comparación pixel a pixel de capturas.

## Accesibilidad de Enviar reseña

El baseline de detalle, antes de editar, confirma que el botón "Enviar reseña"
con preset nulo tiene texto `#322C29` sobre `#322C29` en FASHION/EDITORIAL
(1:1), y `#552E48` sobre `#B55271` en BEAUTY/BOUTIQUE/GLAMOUR (2,36:1).
Se corrigió en 2B, con autorización explícita: el texto predeterminado de esas
tres plantillas es blanco. TECH conserva `#071421`; con preset se usa
`onPrimary`. La regresión identifica exclusivamente ese botón y permite los
colores derivados de su currentColor (incluidos bordes de ancho cero y outline),
comparando el resto de estilos y geometría con la referencia histórica.
Comprueba texto en normal, hover y foco para los siete IDs y cuatro anchos.

## Resultados locales de fase 2A

| Comprobación ejecutada | Resultado |
|---|---|
| Frontend `npm.cmd run lint` | Exit 0; 0 errores y 8 avisos por img existentes |
| Frontend `npm.cmd run build` | Exit 0; incluye TypeScript; builds HTTP y HTTPS loopback |
| Frontend `npm.cmd test` | 17/17 grupos |
| API `npm.cmd test` | 140/140 pruebas: las 137 anteriores y 3 nuevas |
| API `npm.cmd run build` | Exit 0; TypeScript |
| `node scripts/verify-catalog-theme.mjs` | 44 combinaciones compatibles, aliases, fallback, aislamiento y contraste de roles derivados |
| Verificador público actualizado | 112 comparaciones NULL, 64 de fallback y 416 vistas con paletas; todas aprobadas |
| Interacción y contraste del navegador | 3.952 estados hover/foco y 33.916 pares comprobados, incluidos texto, iconos, bordes y foco |
| `node scripts/verify-public-seo.mjs` con build HTTP | Exit 0; metadata, robots/sitemap, una lectura, producto, 404, noindex, timeout y PNG OG |

La matriz cubre 320, 390, 1024 y 1440 px; tarjetas sin imagen, oferta activa,
detalle y carrito vacío/con productos. Se compararon los siete IDs con NULL
**antes** de habilitar la matriz de paletas. Luego se verificaron las 26
combinaciones actuales compatibles: dos TECH y ocho por cada otro diseño.
El menor contraste de texto medido en la matriz final fue 4,9556:1 (4,96:1).
No se detectó desbordamiento horizontal del documento.

El baseline de esta sesión está en `$env:TEMP/catalog-theme-baseline.json`.
Resultados y 26 capturas: `$env:TEMP/vitrinaya-ui-pilot-57DfXT/`, incluido
`theme-results.json`. Los archivos contienen únicamente fixtures locales.

### Peso del JavaScript

Misma configuración HTTPS loopback, misma ruta de catálogo y mismo método:
sumar scripts modernos referenciados por el HTML, excluir nomodule y calcular
gzip por archivo. No incluye HTML/RSC, CSS ni prefetch posterior, y no mide la
transferencia o latencia de un despliegue.

| Recurso | Antes, bytes / gzip | Después, bytes / gzip | Diferencia |
|---|---:|---:|---:|
| JS inicial del catálogo | 535.118 / 159.258 | 543.098 / 160.207 | +7.980 / +949 (gzip +0,60 %) |
| Chunk diferido del resolvedor y paletas | — | 4.262 / 1.797 | Solo lo descarga el carrito con preset |

El verificador comprueba que ese chunk no esté entre los scripts iniciales y
consulta Performance Resource Timing en las vistas con paletas: catálogo y
detalle no lo descargan; los carritos personalizados sí. La subida del JS
inicial incluye las clases con fallbacks y la conexión de estilos; no incorpora
el registro de las ocho paletas.

### Incidencias resueltas durante la comprobación

- La comparación inicial detectó redondeo distinto en transparencias al
  introducir variables: se conservaron las expresiones completas del fallback.
- La prueba ampliada detectó 2,36:1 en el borde predeterminado del botón de
  aumentar cantidad al usar una paleta oscura. Ambos botones de cantidad
  consumen ahora `border`, y pasaron la matriz final.
- El intento directo de ejecutar tsx falló por `uv_os_get_passwd` en Windows;
  `npm.cmd test` usa el workaround existente y terminó con 140/140.
- El navegador aislado cerró inicialmente con `LOCAL_BROWSER_CLOSED`; la
  ejecución local autorizada de Chromium completó las comprobaciones.
- SEO ejecutado inicialmente sobre el build HTTPS no alcanzó su fixture HTTP.
  Se reconstruyó con el HTTP documentado y pasó. Al terminar se restauró el
  build HTTPS local.

No existen scripts independientes `typecheck` en estas aplicaciones ni `lint`
en API. Ambos builds comprobaron tipos. No se instalaron herramientas nuevas.

Pendiente: aplicar y medir la migración en una base autorizada, verificación
con PostgreSQL/Storage reales, otros navegadores/dispositivos físicos y
tecnologías de asistencia. Ninguna de esas comprobaciones se acredita con
fixtures ni dobles. Los resultados siguientes documentan el selector ya
implementado en fase 2B.

## Selector de fase 2B

Sección "Colores de tu catálogo", entre las plantillas y la información del
negocio. Cada radio nativo tiene nombre humano, cuatro muestras (fondo,
superficie, principal, acento), miniatura y estado escrito. La miniatura llama
a `resolveCatalogTheme(template, preset)`; no replica el mapa de colores.
El registro se importa al montar el selector, con carga, error y reintento.

| Opción | ID | TECH / GRID | FASHION / EDITORIAL | BEAUTY / BOUTIQUE | GLAMOUR |
|---|---|---|---|---|---|
| Predeterminado | null | Sí | Sí | Sí | Sí |
| Bosque | forest | Deshabilitada | Sí | Sí | Sí |
| Océano | ocean | Deshabilitada | Sí | Sí | Sí |
| Terracota | terracotta | Deshabilitada | Sí | Sí | Sí |
| Rosa | rose | Deshabilitada | Sí | Sí | Sí |
| Violeta | violet | Deshabilitada | Sí | Sí | Sí |
| Grafito | graphite | Deshabilitada | Sí | Sí | Sí |
| Menta noche | night-mint | Sí | Sí | Sí | Sí |
| Ámbar noche | night-amber | Sí | Sí | Sí | Sí |

Las incompatibles siguen visibles con su explicación y `disabled`. Si se cambia
de plantilla, la selección incompatible permanece marcada. Se muestra una
advertencia y se bloquean tanto Guardar como el handler de submit hasta elegir
otra opción compatible o Predeterminado. La API aplica su validación propia.

Elegir no envía solicitudes. El PUT existente guarda la elección y actualiza
la referencia persistida solo tras una respuesta exitosa. "Restablecer colores"
recupera esa referencia sin enviar solicitudes, remontar el formulario, cambiar
la plantilla del borrador ni borrar otros campos. Si el valor restaurado es
incompatible con una plantilla aún no guardada, la advertencia sigue vigente.

El fieldset tiene nombre de grupo, cada radio nombre accesible, estado checked
y descripción de indisponibilidad. Los radios nativos usan Tab, Espacio y
flechas, saltando los deshabilitados. Selección y foco tienen borde y texto
explícitos; las opciones deshabilitadas no reducen su opacidad de texto.

### Agregar una paleta

1. Añadir sus ocho colores base y modo a `lib/catalog-theme.ts`, respetando los
   roles derivados y la exportación de muestras. Añadir nombre/ID a
   `lib/catalog-theme-choice.ts`.
2. Añadir el ID al esquema del servidor `src/schemas/catalog-theme.ts`. Alinear
   la compatibilidad del servidor, del selector y del resolvedor. TECH conserva
   su lista explícita hasta que se autorice y verifique otra combinación.
3. Verificar texto normal ≥4,5:1, texto grande y controles/foco ≥3:1, incluidos
   hover, transparencias, superficies suaves, ofertas y mensajes de estado.
4. Ampliar los fixtures/listas de los verificadores y ejecutar
   `verify-catalog-theme.mjs`, pruebas de API, selector y matriz pública a
   320, 390, 1024 y 1440 px. Habilitar una combinación solo después de pasar el
   navegador. La prueba pura exige que selector y resolvedor coincidan.
5. Mantener intacto el retorno undefined para null, ausente, desconocido o
   incompatible. Repetir la comparación histórica con las excepciones
   autorizadas de WhatsApp/reseña, SEO y medición de JavaScript.

Un ID nuevo no requiere cambiar el esquema String ni aplicar otra migración.
No introducir valores arbitrarios de color ni modificar inventario, fuentes,
portada o extracción del logo dentro de este flujo.

### Diff de 2B por archivo

Respecto al estado aprobado de 2A; se conservaron los cambios locales de esa fase.

| Archivo | Cambio |
|---|---|
| `catalog-api/src/schemas/catalog-theme.ts` | Enum compartido del servidor, validación de compatibilidad y error de dominio seguro |
| `catalog-api/src/schemas/catalog.schema.ts` | Consume el enum compartido, conservando null/omisión |
| `catalog-api/src/repositories/catalog.repository.ts` | Valida creación y el par resultante de actualizaciones bajo bloqueo por propietario |
| `catalog-api/src/controllers/catalog.controller.ts` | Responde 400 a incompatibilidades; factory de actualización para comprobar el controlador por HTTP |
| `catalog-api/src/repositories/catalog-theme.test.ts` | Añade cuatro pruebas de compatibilidad, escrituras parciales, concurrencia y HTTP con persistencia simulada |
| `lib/catalog-theme-choice.ts` | IDs, nombres humanos y compatibilidad ligera para el borrador |
| `lib/catalog-theme.ts` | Exporta las cuatro muestras desde los mismos valores de la paleta |
| `components/catalogs/CatalogSettings.tsx` | Estado borrador/persistido, PUT existente, bloqueo, integración y prevención de doble envío |
| `components/catalogs/CatalogPaletteSelector.tsx` | Radios nativos, muestras, miniaturas, carga/reintento y Restablecer colores |
| `components/catalogs/catalog-palette-selector.module.css` | Estilos limitados al selector, incluidos seleccionado/deshabilitado/hover/foco |
| `components/public/PublicProductDetailPage.tsx` | Corrige únicamente el color de Enviar reseña sin preset |
| `scripts/verify-ui-pilot.mjs` | Modo de selector, fixture privada y guardados simulados |
| `scripts/palette-settings-checks.mjs` | Guardado, restablecimiento, borradores, miniaturas, teclado, AX y contraste |
| `scripts/measure-settings-js.mjs` | Medición reproducible del JS inicial de la ruta de configuración |
| `scripts/public-theme-checks.mjs` | Excepción autorizada de reseña, regresión de sus tres estados y variantes del registro diferido |
| `scripts/public-theme-contrast.mjs` | Permite aislar texto de reseña de controles ajenos a esa corrección |
| `scripts/verify-catalog-theme.mjs` | Exige paridad entre compatibilidad del selector y resolvedor |
| `docs/catalog-themes.md` | Contrato, matriz, ampliación, contrastes, peso y evidencia |

Las rutas del frontend de esta tabla son relativas a `catalog-generator`.
No hubo cambios adicionales en esquema/migración durante 2B.

### Evidencia local de 2B

El selector se verificó con:

```powershell
node scripts/verify-ui-pilot.mjs --https-api --palette-settings
node scripts/measure-settings-js.mjs
```

Se aprobaron 132 PUT simulados en 320/390/1024/1440 px: ocho paletas y
Predeterminado en cada diseño claro, las dos oscuras y Predeterminado en TECH,
y escenarios de recuperación. Se comprobaron también:

- Elegir no envía; Predeterminado envía null; el borrador incompatible conserva
  su selección y bloquea incluso un evento submit forzado.
- Restablecer recupera la última paleta guardada sin perder nombre u otros
  borradores. La identidad DOM del formulario y del campo de nombre se conserva.
- Las cuatro muestras y la miniatura coinciden con fondo/superficie/principal
  resueltos. No hay desbordamiento del documento.
- Tab/Shift+Tab, Espacio, flechas y guardado con Enter; TECH salta los seis
  radios deshabilitados. El foco de opción tiene al menos 2 px y contraste ≥3:1.
- Árbol de accesibilidad de Chromium: grupo nombrado, nueve nombres de radio,
  checked, disabled y descripción de indisponibilidad. **No se ejecutó un lector
  de pantalla real**; esa comprobación manual sigue pendiente.
- Texto del selector: mínimo medido 6,92:1, incluidos seleccionados,
  deshabilitados, hover y foco; no se usa atenuación de texto para deshabilitar.

API: **144/144** (las 140 anteriores y cuatro nuevas). El controlador HTTP real
con propietario de prueba y repositorio simulado devuelve 400 ante ID desconocido,
par completo inválido o actualización parcial incompatible. Se comprueban los
ocho IDs válidos, null, omisión y 404 para otro propietario. Las pruebas de
concurrencia simulan la serialización y comprueban SQL parametrizado con
FOR UPDATE; no acreditan PostgreSQL real.

La matriz pública repitió **112 comparaciones históricas**, **64 fallbacks**,
**416 vistas**, **3.952 estados hover/foco** y las **26 combinaciones compatibles**.
Se añadieron **84 regresiones de reseña**: siete IDs × cuatro anchos × tres
estados. Solo se exceptúan de la comparación histórica los colores autorizados
de WhatsApp y reseña; el resto de estilos calculados conserva la referencia.

| Enviar reseña sin preset | Normal | Hover | Foco |
|---|---:|---:|---:|
| TECH / GRID | 11,33:1 | 14,05:1 | 11,33:1 |
| FASHION / EDITORIAL | 13,74:1 | 10,11:1 | 13,74:1 |
| BEAUTY / BOUTIQUE | 4,76:1 | 6,40:1 | 4,76:1 |
| GLAMOUR | 4,76:1 | 6,40:1 | 4,76:1 |

Artefactos de esta ejecución:

- Público: `$env:TEMP/vitrinaya-ui-pilot-KU5Gz0/theme-results.json` y 26 capturas.
- Selector: `$env:TEMP/vitrinaya-ui-pilot-s4y4az/palette-settings-results.json`
  y cuatro capturas.
- Peso privado: `$env:TEMP/catalog-2b-weight-_8fu6gb7/before.json` y `after.json`.

### Peso de 2B frente a 2A

Mismo método por archivos JS modernos, misma configuración HTTPS loopback.
La medición privada aisló CatalogSettings previo a 2B (estaba sin cambios en
Git al iniciar), y restauró byte a byte su contenido nuevo en un finally con
comprobación SHA-256. Después se reconstruyó y verificó la versión final.

| Recurso | 2A bytes / gzip | 2B bytes / gzip | Diferencia gzip |
|---|---:|---:|---:|
| JS inicial catálogo público | 543.098 / 160.207 | 543.098 / 160.207 | 0 |
| JS inicial ruta privada de configuración | 656.964 / 197.295 | 662.112 / 198.767 | +1.472 (+0,75 %) |
| Registro diferido, carrito | 4.262 / 1.797 | 3.486 / 1.355 | −442 |
| Registro diferido, selector y muestras | — | 4.383 / 1.845 | Nuevo, al abrir configuración |

Turbopack genera dos variantes optimizadas según los exports consumidos.
El carrito usa solo el resolvedor y el selector también las muestras; el
verificador comprueba que un carrito personalizado descarga una sola variante,
no ambas. Ninguna entra en el JS inicial público. Dashboard conserva
562.006 bytes / 170.339 gzip. No se añadieron dependencias.

La opción Predeterminado muestra cuatro muestras de los colores reales del
diseño (incluidos fondo y superficie), manteniendo el retorno undefined del
resolvedor. Las miniaturas de presets usan sus variables directamente.

| Comprobación final de 2B | Resultado |
|---|---|
| API `npm.cmd run build` | Exit 0; TypeScript |
| API `npm.cmd test` | 144/144 |
| Frontend `npm.cmd run lint` | Exit 0; cero errores y ocho avisos img preexistentes |
| Lint específico del selector y nuevos verificadores | Exit 0 |
| Frontend `npm.cmd run build` | Exit 0; HTTP/HTTPS local y TypeScript |
| Frontend `npm.cmd test` | 17/17 |
| `verify-catalog-theme.mjs` | 44 combinaciones con aliases y paridad selector/resolvedor |
| Público actualizado | 112 referencias, 64 fallbacks, 26 combinaciones y 84 regresiones de reseña aprobadas |
| Selector | 132 guardados, identidad DOM, cancelación, teclado, AX y contraste aprobados |
| SEO con su build HTTP específico | Exit 0; luego se restauró el build HTTPS de prueba |

Las primeras ejecuciones de las nuevas pruebas detectaron limitaciones del
fixture: Prisma no ofrece un descriptor para mock.method y Enter en CDP requería
su evento de texto completo. Se usó la factory de controlador con repositorio
simulado y se corrigió el evento del verificador; las ejecuciones finales
anteriores aprobaron. Los bordes/outline que heredan currentColor del botón de
reseña están dentro de su excepción de color autorizada, con fondo y geometría
comparados sin excepciones.

### Antes de migrar y desplegar

Hace falta autorización explícita para el entorno y la base destino, confirmar
respaldo recuperable y ventana de despliegue, y ensayar migración/lectura/escritura
contra PostgreSQL aislado autorizado. Falta la comprobación con lector de
pantalla real. La migración nullable de 2A sigue sin aplicar y no hay variables
nuevas. Orden coordinado: migración → API → frontend, con verificación de sesión,
guardado y catálogo público. Rollback de aplicación: conservar la columna
nullable y sus elecciones; no hace falta eliminarla.
