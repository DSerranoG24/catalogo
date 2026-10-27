# Paleta sugerida desde el logo

Fase 2B-4, implementación y comprobaciones locales. No hay cambios de API,
endpoints, esquema, migraciones, dependencias, catálogo público ni pedidos.
No se ejecutan operaciones de Git o acciones contra servicios externos.

## Confirmación y estado

La sugerencia es efímera. `CatalogSettings` conserva el borrador themePreset y
persistedThemePreset existentes. El componente de sugerencia solo recibe un
callback para cambiar el borrador: no importa apiRequest ni tiene acceso al
guardado. «Usar esta paleta» actualiza el selector y lleva el foco al radio;
solo «Guardar cambios» ejecuta el PUT existente. «Elegir otra» enfoca el selector
sin modificar la paleta ni guardar. «Restablecer colores» conserva su función
de recuperar el valor persistido.

El logo se sube con el flujo existente. Solo tras la respuesta satisfactoria se
entrega su File local al análisis; no se vuelve a descargar para analizarlo.
La vista del logo puede hacer su petición normal de imagen, independiente de
la extracción. Si ya existe paleta persistida o elegida en el borrador, no se
analiza automáticamente, incluso al subir otro logo. El botón manual permite
recalcular sin aplicar ni sobrescribir esa elección.

Al abrir Configuración con logo y paleta null se analiza automáticamente.
Se acepta la limitación del modelo: null también puede significar una elección
anterior de Predeterminado. Mostrar una sugerencia nunca modifica esa elección.
Sin logo no hay sugerencia; el botón manual permanece visible y deshabilitado.

Cada ejecución tiene AbortController, límite temporal de ocho segundos y una
marca de vigencia en la clausura del efecto. Cambiar fuente, plantilla, paleta,
valor persistido o estado de guardado/subida cancela la ejecución anterior.
Además, el resultado renderizado debe coincidir con fuente, plantilla, borrador
y solicitud actuales. Una solicitud manual se consume una sola vez, por lo que
cambiar de plantilla después no dispara automáticamente otra si hay paleta
persistida. El desmontaje también aborta y descarta el resultado.

## Lectura y privacidad

El módulo privado reutiliza el patrón de compress-product-photo.ts, sin
comprimir ni volver a codificar la imagen. Usa createImageBitmap, un Canvas
transparente de lado mayor hasta 100 px, conserva proporciones y no amplía.
Al terminar libera bitmap y Canvas. Aplica límites de 5 MiB y 40 megapíxeles;
el límite de megapíxeles se comprueba después de decodificar, igual que en el
patrón existente, por lo que no elimina el coste inicial de decodificación.

Para logos existentes usa fetch CORS, credentials omit, sin redirects y con
límite de bytes también durante streaming. Solo admite HTTP/HTTPS sin usuario
o contraseña y PNG/JPEG/WebP. No registra URLs firmadas ni errores de imagen.
URL caducada, CORS denegado, decodificación fallida, timeout o navegador sin
soporte producen ausencia de sugerencia, sin alerta ni proxy nuevo.

Los píxeles no se envían a ningún servicio de análisis y el color extraído no
se persiste. La API y el selector normal siguen validando la compatibilidad.

## Color y umbrales

Se usa distancia RGB ponderada redmean, simétrica y pequeña, sin Lab ni
dependencias. Se cuantiza a bins de 16 niveles por canal y se agrupan colores
próximos. Se ordenan por frecuencia y clave para resolver empates de forma
determinista. Gana el grupo con más píxeles; su media se compara con el primary
de las paletas compatibles del registro existente, sin duplicar colores en
el código de aplicación. TECH/GRID solo consideran night-mint y night-amber.
Predeterminado sigue siendo una elección manual, no un candidato cromático.

| Umbral | Valor |
| --- | --- |
| Alpha mínimo | 240/255 |
| Saturación HSL mínima | 0,20 |
| Luminosidad HSL admitida | 0,06 a 0,94 |
| Píxeles cromáticos mínimos | 3 |
| Proporción cromática entre píxeles opacos admitidos | 2 % |
| Cobertura cromática del Canvas completo | 1 % |
| Distancia redmean máxima para agrupar | 70 |
| Distancia redmean máxima al preset | 180 |

Estos valores están ajustados y comprobados con fixtures sintéticos, no
validados con una colección representativa de marcas reales. No son Delta E.
Los neutros y blancos/negros se eliminan usando saturación y luminosidad; los
bordes de alpha menor que 240 no votan. Un logo 1×1 no falla, pero se abstiene
por el mínimo de tres píxeles; uno 2×2 cromático sí puede sugerir.

Limitaciones: un fondo cromático grande puede dominar al símbolo; la frecuencia
no demuestra identidad de marca. Los grises neutros se abstienen, por lo que
Grafito no se recomienda a partir de un logo puramente gris. Comparar con las
primarias claras de TECH puede descartar logos oscuros del mismo tono. La
abstención y la elección humana son deliberadas.

## Diff resumido

| Archivo | Cambio |
| --- | --- |
| `components/catalogs/CatalogSettings.tsx` | Guarda temporalmente el File tras subir; monta la sugerencia de forma diferida y conecta borrador/foco. |
| `components/catalogs/CatalogLogoPaletteSuggestion.tsx` | UI, ejecución automática/manual, cancelación y protección contra resultados obsoletos. |
| `lib/logo-palette-analysis.ts` | Lectura acotada, filtros, agrupación, redmean y abstención. Solo importado por el componente privado. |
| `scripts/verify-logo-palette.mjs` | Quince pruebas puras con fixtures sintéticos. |
| `scripts/verify-logo-palette-browser.mjs` | Integración con API/imágenes locales, CORS, confirmación, foco, carreras y pesos. |
| `docs/logo-palette-suggestion.md` | Contrato, umbrales, límites y evidencia. |
| `docs/catalog-themes.md` | Enlace a este bloque. |

## Peso medido

Gzip sumado por script cargado, mismo método antes y después:

| Medición | Antes | Después | Cambio |
| --- | ---: | ---: | ---: |
| Catálogo público inicial | 162.608 B | 162.608 B | 0 B |
| Panel privado inicial | 210.510 B | 210.820 B | +310 B |
| Panel tras abrir Configuración, sin análisis | 211.865 B | 213.444 B | +1.579 B |
| Panel tras analizar | 211.865 B | 215.121 B | +3.256 B |
| Registro diferido de paletas del selector | 1.355 B | 1.355 B | 0 B |
| Nuevo componente diferido de sugerencia | — | 1.269 B | +1.269 B |
| Nuevo módulo diferido de análisis | — | 1.677 B | +1.677 B |

El selector existente sigue importado estáticamente en el panel: no tiene un
chunk exclusivo para su UI. Su registro/resolvedor sí estaba diferido y permanece
idéntico. El nuevo componente se descarga al abrir Configuración; el análisis,
solo cuando hay ejecución. No se importa nada de este bloque desde componentes
públicos. Los scripts públicos siguen siendo 11, con 549.221 bytes sin comprimir.

## Comprobaciones reales

- Frontend lint sin errores, con las cuatro advertencias img previas; build
  correcto con TypeScript. No hay script typecheck independiente.
- Frontend test: 17/17. API test: 163/163, sin modificaciones del backend.
- `node scripts/verify-logo-palette.mjs`: 15/15. Fondo claro, transparencia,
  casi transparente, blanco, negro, gris, multicolor, agrupación, empates,
  tamaño pequeño sin ampliación, compatibilidad y abstención.
- `node scripts/verify-logo-palette-browser.mjs`: correcto en Chromium.
  File local sin petición extra de análisis, lectura remota simulada CORS sin
  credenciales, ningún PUT por sugerir/aceptar/elegir otra, PUT solo del formulario,
  restablecimiento, foco, elección persistida protegida, nuevo logo con paleta
  persistida, carreras al cambiar logo/plantilla/paleta, TECH, CORS denegado y
  PNG inválido silenciosos. Sin errores de ejecución del navegador.
- `node scripts/verify-public-cart-browser.mjs --baseline`: peso público idéntico
  y sin registro de paletas en los scripts iniciales.

El navegador usa API e imágenes HTTPS simuladas en loopback 4339 y Next en
4338. El JSON queda en el directorio temporal como logo-palette-result.json.
El build usa la API pública simulada en 4347, solo mediante variable del proceso;
se debe recompilar para publicar con la configuración real.

No comprobado: CORS real de Supabase, URLs firmadas reales, Safari/Firefox,
dispositivo físico, lector de pantalla humano ni calibración con logos reales.
No se accedió a Supabase/Render/Vercel. No hacen falta migraciones, endpoints ni
variables nuevas. Antes de desplegar conviene revisar ejemplos reales y validar
el CORS del destino; si falla, el selector normal sigue funcionando.
