# Acceso superior al carrito

Una única franja sticky se renderiza desde `PublicCatalogPage`, antes de la
plantilla y fuera de las cabeceras y columnas laterales. Sustituye la función
sticky de la antigua barra de categorías. Las categorías permanecen en su lugar
pero dejan de ser sticky en todas las distribuciones.

`PublicCatalogCartLink` solo recibe publicId, plantilla normalizada, cartCount y
cartTotal. No tiene estado, efectos, lecturas de almacenamiento ni consultas.
Las cantidades siguen en PublicCatalogPage, con la persistencia existente en
sessionStorage. El contador suma unidades, conserva el número completo en el
nombre accesible y muestra 99+ visualmente a partir de cien.
El enlace desactiva prefetch: su presencia permanente no adelanta la carga del
carrito de destino. La navegación actual se conserva al activarlo.

Existe un único enlace, contador y anuncio de cantidades `aria-live="polite"`.
El destino sigue siendo `/c/PUBLIC_ID/carrito`. No se cambia el carrito de
destino, el cálculo de pedidos ni la API.

La franja usa una superficie opaca con roles `--catalog-*` y fallbacks locales
por plantilla. TECH mantiene su superficie oscura. El hover subraya el enlace;
no introduce transparencias ni movimiento. El foco tiene contorno de 2 px y
offset de 3 px. El registro de paletas sigue fuera del JavaScript inicial.

El contenido de la franja reserva 64 px desde el HTML inicial, más borde y área
segura superior. El enlace mide al menos 44 × 44 px, el contador reserva 40 px y
el total se oculta por debajo de 768 px. Los laterales respetan áreas seguras.

Sin JavaScript se conservan la franja sticky y el enlace nativo. El contador
inicial es cero: el servidor no puede recuperar sessionStorage y esta fase no
implementa actualización de cantidades ni compra sin JavaScript.

## Archivos de este bloque

| Archivo | Cambio |
| --- | --- |
| `components/public/PublicCatalogCartLink.tsx` | Único enlace, contador y anuncio; sin estado propio. |
| `components/public/PublicCatalogCartLink.module.css` | Sticky, fallbacks, foco, tamaño táctil, áreas seguras y responsive. |
| `components/public/PublicCatalogPage.tsx` | Render común antes de la plantilla; conserva el cálculo existente. |
| `components/public/PublicCategoryFilter.tsx` | Retira enlace, contador, total, imports y sticky anteriores. |
| `components/public/PublicCatalogTemplateProps.ts` | Retira las props de contador y total. |
| `components/public/TechnologyTemplate.tsx` | Retira la propagación de contador y total. |
| `components/public/FashionTemplate.tsx` | Mismo ajuste. |
| `components/public/BeautyTemplate.tsx` | Mismo ajuste. |
| `components/public/GlamourTemplate.tsx` | Mismo ajuste. |
| `components/public/EditorialTemplate.tsx` | Ajusta consumidor antiguo sin eliminarlo. |
| `components/public/GridTemplate.tsx` | Ajusta consumidor antiguo sin eliminarlo. |
| `components/public/BoutiqueTemplate.tsx` | Ajusta consumidor antiguo sin eliminarlo. |
| `components/public/PublicCatalogLayout.module.css` | Retira reglas de reposicionamiento del antiguo enlace. |
| `components/public/catalog-theme.module.css` | Espacio de desplazamiento para anclas y controles enfocados. |
| `scripts/verify-public-cart-browser.mjs` | Regresión pública con fixtures locales. |
| `scripts/verify-public-layouts-browser.mjs` | Adapta selector de carrito y descuenta el desplazamiento autorizado de la nueva franja al comparar referencias. Conserva los hashes originales. |
| `scripts/fixtures/public-layout-classic-content.json` | Huellas derivadas de la captura histórica original: conservan estilos y geometría HTML y excluyen solo coordenadas internas SVG sensibles al redondeo al trasladar la página. La referencia anterior permanece intacta. |
| `docs/catalog-layouts.md` | Actualiza la ubicación del carrito y la comparación histórica. |
| `docs/public-highlights.md` | Documenta el nuevo orden y categorías sin sticky. |
| `docs/public-cart-access.md` | Contrato, inventario y evidencia del bloque. |

## Verificación reproducible

Construir con `NEXT_PUBLIC_CATALOG_API_URL=http://127.0.0.1:4347/api` solo en el
proceso. Ejecutar `node scripts/verify-public-cart-browser.mjs`: API simulada en
loopback 4347, Next en 4348 y Chromium con perfil descartable. El resultado JSON
se guarda en el directorio temporal como `catalog-cart-result.json`.
`--baseline` mide scripts sin iniciar navegador; `--interactions-only` ejecuta
las interacciones sin repetir la matriz completa.

La referencia anterior es 549.481 bytes sin comprimir, 162.587 bytes gzip y 11
scripts iniciales. El límite de este bloque es +15.000 bytes gzip. Ese build es
de pruebas locales y debe recompilarse para publicar con la configuración real.

No se ejecutan operaciones de Git, migraciones ni acciones contra servicios
externos. No hay dependencias ni variables nuevas de aplicación.

## Evidencia local

- Build frontend correcto con TypeScript. Lint sin errores y con las cuatro
  advertencias previas de img. Importador 17/17 y API 163/163.
- 450 casos: 30 combinaciones compatibles de plantilla/paleta, tres
  distribuciones y cinco anchos (320, 390, 768, 1024, 1440).
- En cada caso: un enlace, contador y anuncio; categorías no sticky; logo sin
  solapamiento; fondo opaco y zona táctil mínima. Visibilidad comprobada al
  0 %, 25 %, 50 %, 75 % y 100 % del recorrido vertical: 2.250 posiciones.
- Quince casos de anclas #productos/#contacto, foco y categorías. Se incluye
  enfocar un control situado inicialmente detrás de la franja. El margen de
  desplazamiento es 80 px más safe-area superior; solo se aplica al main que
  contiene la franja, sin afectar detalle ni carrito de destino.
- Se restauran dos productos con 2 y 3 unidades: el contador muestra 5.
  Añadir dos veces el mismo producto muestra 7 y actualiza el único anuncio.
  Con 101 unidades muestra 99+ y anuncia el número completo; no cambia la
  altura de franja ni el ancho del contador.
- Enter abre la ruta existente del carrito con movimiento reducido activo.
- Sesenta casos sin JavaScript: franja visible y contador inicial cero;
  el enlace nativo navega. No se verifica compra sin JavaScript.
- Ciento cincuenta comparaciones históricas del resto de Clásica pasan con
  el desplazamiento autorizado descontado y las salvedades SVG documentadas.

Peso inicial, sumando gzip por recurso:

| | Antes | Después | Cambio |
| --- | ---: | ---: | ---: |
| JavaScript sin comprimir | 549.481 B | 549.221 B | −260 B |
| JavaScript gzip | 162.587 B | 162.608 B | +21 B |
| Scripts | 11 | 11 | 0 |

Contraste mínimo de texto/contador medido en Chromium sobre estilos computados
a 390 px, incluyendo las tres distribuciones y las plantillas compatibles:

| Paleta / fallback | Normal | Hover | Foco |
| --- | ---: | ---: | ---: |
| TECH sin paleta | 11,33 | 11,33 | 11,33 |
| FASHION sin paleta | 13,54 | 13,54 | 13,54 |
| BEAUTY sin paleta | 4,76 | 4,76 | 4,76 |
| GLAMOUR sin paleta | 5,57 | 5,57 | 5,57 |
| Bosque | 7,13 | 7,13 | 7,13 |
| Océano | 6,70 | 6,70 | 6,70 |
| Terracota | 7,31 | 7,31 | 7,31 |
| Rosa | 7,88 | 7,88 | 7,88 |
| Violeta | 7,10 | 7,10 | 7,10 |
| Grafito | 10,35 | 10,35 | 10,35 |
| Menta noche | 12,07 | 12,07 | 12,07 |
| Ámbar noche | 12,38 | 12,38 | 12,38 |

Las cifras iguales son deliberadas: hover subraya y foco añade contorno sin
cambiar texto ni superficie. El contorno se verifica por separado con mínimo
3:1 contra el fondo, sin fallos. No se cargan las paletas en el JS inicial.

No verificado: lector de pantalla humano, dispositivo físico con notch,
Safari/Firefox, producción, persistencia remota ni flujo completo de compra.
La interacción y la accesibilidad se comprobaron mediante Chromium y DOM;
no se modificó el flujo de pedidos ni se generaron pedidos de prueba.
