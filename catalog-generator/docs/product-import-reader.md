# Importación de productos: fase 3A

Este módulo aporta lector local, plantilla y excepción del proxy. La interfaz y confirmación se describen en [flujo UI](product-import-ui.md); el [contrato del backend](../../docs/product-import.md) recibe solo JSON.

## Uso del lector

```ts
import { readProductImport } from "@/lib/product-import/reader";
import { createProductImportTemplate } from "@/lib/product-import/template";

const controller = new AbortController();
const result = await readProductImport(file, { signal: controller.signal });
// controller.abort() cancela realmente el worker, no solo la espera del consumidor.
const templateBytes = createProductImportTemplate();
```

No hay efectos automáticos de descarga, red ni persistencia. El archivo generado también está disponible en `public/templates/productos.xlsx`. Se regenera con `node scripts/verify-product-import.mjs --write-template`.

`result` devuelve:

- `totalRows`: filas de datos no vacías, incluidas las rechazadas localmente.
- `rows`: solo filas normalizadas sin errores locales, con su `rowNumber` original. Cadenas recortadas/NFC, vacíos omitidos, números sin coerción y Sí/No convertido a booleano.
- `errors`: número de fila, campo y código. No se devuelve ni registra la excepción original del parser.
- `rejectedRows`: identificación parcial de las filas con error, exclusivamente para el reporte; véase la sección final.
- `bytes`: bytes comprimidos, realmente expandidos y número de entradas.

El flujo agrupa las filas elegibles en lotes de hasta 50 y usa su total como `totalRows` del plan del backend, excluyendo rechazos locales y filas demasiado grandes para JSON. Combina los reportes con los errores locales. Una fila rechazada nunca se envía con SKU vacío como sustituto. Si no hay filas válidas, no hay solicitud al backend. Nombre/precio requeridos, límites comerciales, categorías, promociones, propiedad y emparejamiento se validan de nuevo en la API; el lector no sustituye esas reglas.

SKU numérico (también con formato visual 00000), fecha numérica/regional, booleanos diferentes de Sí/No y texto donde corresponde un número producen errores locales de tipo. No se reconstruyen ceros, fechas o códigos perdidos. Las fórmulas con resultado legible se reportan como error de fila; fórmulas sin resultado almacenado pueden hacer que el lector rechace el libro completo. Las cabeceras deben coincidir exactamente con las 12 de la plantilla y la hoja se llama `Productos`.

## Límites y descompresión

Dependencias directas exactas: `read-excel-file: 9.3.12`, `fflate: 0.8.3`. No se usa un generador de hojas adicional.

| Recurso | Límite |
|---|---|
| Archivo .xlsx antes de leerlo | 5 MiB |
| Entradas ZIP | 64 |
| Cada entrada expandida | 8 MiB |
| Todas las entradas expandidas | 20 MiB |
| Hoja Productos | 500 filas de datos, 12 columnas, 6012 celdas contando cabecera |
| Procesamiento | watchdog de 10 segundos desde el hilo principal |

El ZIP se inspecciona antes de inflar: directorio central, cabeceras locales, nombres, offsets, solapamientos, descriptor de datos, CRC y métodos STORE/DEFLATE. Se rechazan ZIP64, cifrado, rutas peligrosas, nombres repetidos, macros y estructuras inconsistentes. El tamaño declarado sirve para rechazo temprano.

La descompresión usa `Inflate` síncrono de fflate dentro del worker, con bloques comprimidos de 512 bytes. Cada callback comprueba bytes reales por entrada y acumulados **antes** de retener la salida. Se rechazan discrepancias de longitud/CRC. No se reserva memoria de salida basándose en una longitud ZIP no fiable. Estas cuotas son de contenido, no un límite absoluto de RAM: hay buffers y estructuras adicionales.

Solo tras validar todas las entradas se inspeccionan XML, relaciones y coordenadas. Un scanner estructural acotado rechaza DTD/entidades externas, CDATA, etiquetas/atributos malformados, profundidad mayor de 32 y más de 100000 etiquetas por documento. No construye matrices. Productos limita filas a 1–501 y columnas A–L, rechaza coordenadas repetidas y dimensiones enormes. El libro con otras hojas no hace que se importen esas hojas. Relaciones externas, VBA y ActiveX se rechazan.

Es un subconjunto deliberado de XLSX para importar tablas, no un lector universal de libros con macros, enlaces externos, XML arbitrario o filas de formato fuera del área de la plantilla. Un rechazo estructural detiene todo el archivo; un error local de tipo excluye solo esa fila.

Se reconstruye un ZIP nuevo con `zipSync(..., {level: 0})`. `readSheet()` recibe exclusivamente ese ZIP STORE y el nombre Productos, **nunca** el original. STORE evita una segunda inflación y el uso de workers de descompresión dentro del lector.

## Cancelación

El hilo principal comprueba extensión/tamaño sin llamar a `arrayBuffer()`, crea un worker módulo y arma un temporizador de 10000 ms. El archivo se lee dentro del worker. AbortSignal, timeout, fallo o éxito pasan por el mismo cierre: limpiar temporizador/listener, terminar worker y resolver/rechazar una sola vez.

El worker deshabilita `Worker` para impedir trabajadores auxiliares no controlados; si una dependencia futura intenta crearlos, la lectura falla de forma segura. La versión fijada procesa XML en el propio worker, y STORE no crea workers de inflación. Por ello `terminate()` abarca todo el trabajo. También se bloquea `fetch` dentro del worker; no hay red en este módulo. No se usa Promise.race para simular cancelación.

## Plantilla

Dos hojas: Productos primero/activa e Instrucciones. Columnas: Nombre, SKU, Categoría, Marca, Modelo, Descripción, Precio, Inventario, Programar descuento, Precio de oferta, Inicio de oferta, Fin de oferta.

Filas 2–501 realmente vacías, con formato explícito por celda. SKU y fechas usan `numFmtId=49` (Texto/@); precio, inventario y precio de oferta usan `numFmtId=1` (0). Validaciones Excel para enteros 0–2147483647 y lista Sí/No con vacío permitido. Las 12 cabeceras tienen notas clásicas con sus partes comments/VML. Los ejemplos solo existen en Instrucciones. No hay fórmulas ni productos de ejemplo en Productos.

Las fechas son texto ISO 8601 con zona, por ejemplo `2026-11-01T09:00:00-05:00`. La guía explica `'00123`, formato Texto previo, celdas vacías, categorías existentes y que No no elimina promociones existentes. La validación Excel ayuda al vendedor, pero no constituye una defensa de seguridad.

## Proxy y pruebas

Solo POST JSON de `products/catalog/<UUID>/import/preview` y `.../confirm`, con exactamente cinco segmentos, reciben 2 MiB. El resto de JSON conserva 64 KiB y multipart conserva su límite anterior. Origin se comprueba antes de leer; Content-Length y el conteo del stream aplican el mismo límite seleccionado.

`npm.cmd test` ejecuta 17 grupos de comprobaciones con el runner local y TypeScript ya instalado: plantilla/roundtrip real con read-excel-file, formatos/notas, SKU numérico, identificación parcial sin coerción, filas válidas junto a inválidas, cuotas con longitudes ZIP falsificadas, coordenadas enormes, ZIP inválido/cifrado/ZIP64, CRC, descriptores, límite previo a lectura, terminación real de workers ocupados (manual y a 10 segundos), y handler real de Next con Origin y ambos límites de cuerpo. El bloque inicial tenía 16 grupos; la identificación parcial añadió uno. El transporte de cancelación se prueba con worker_threads; la integración interactiva de navegador se documenta en [product-import-ui.md](product-import-ui.md).

La comprobacion independiente anterior de la plantilla se conserva en el [historial](../../docs/historial/2026-10-25-verificaciones.md).

La interfaz conecta selector y descarga, cancelación accesible, presentación de errores/resumen, lotes de vista previa, invalidatedRows, confirmación, reportes parciales, sesión expirada y reintentos. Su contrato y verificación interactiva se describen en [product-import-ui.md](product-import-ui.md). La mejora posterior amplió el contrato local con `rejectedRows`; no cambió el contrato de la API ni añadió variables o migraciones.

## Mejora de identificación de errores

`ImportReadResult.rejectedRows` contiene únicamente `rowNumber` y los campos `name`/`sku` legibles de las filas rechazadas. Un texto vacío se conserva como cadena vacía; un campo con error de tipo o fórmula se omite. Esta colección es solo de presentación: `rows` sigue conteniendo exclusivamente filas sin errores locales. El worker transmite el resultado completo sin cambios de protocolo o lógica.
