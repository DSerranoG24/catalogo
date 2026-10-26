# Carga de productos por fotografías

## Alcance y publicación

Desde Productos, «Cargar varias fotos» acepta hasta treinta imágenes. Una fotografía crea un producto distinto: no agrupa vistas de un mismo artículo ni reconoce productos automáticamente. Los productos se crean con `active=false`, `needsCompletion=true`, precio provisional 0, sin categoría y con la fotografía en posición 0. El nombre del archivo solo se conserva si es legible; nombres de cámara, UUID y números largos se sustituyen por «Producto sin completar». El slug incluye el UUID del producto.

La migración `20261025210000_photo_products` añade exclusivamente `products.needsCompletion BOOLEAN NOT NULL DEFAULT false`. Los registros existentes permanecen completos; no se infiere el estado a partir del precio, nombre o categoría. La migración se crea, pero no se aplica desde este trabajo ni desde el arranque.

La vista de completado pide nombre revisado, precio entero en COP y confirmación explícita de revisión. Precio 0 está permitido si el vendedor lo introduce y confirma; categoría y descripción siguen siendo opcionales. «Guardar y siguiente» cambia needsCompletion a false y mantiene active=false. Publicar requiere una acción posterior explícita en el listado. La actualización normal del producto rechaza activar un pendiente, bajo el mismo bloqueo de catálogo usado por Excel. Los filtros públicos y de pedidos existentes exigen active=true: los provisionales no aparecen ni se pueden pedir.

## Contratos privados

Todos pasan por autenticación y propiedad del catálogo o producto; las respuestas son no-store.

| Ruta | Contrato |
|---|---|
| POST /api/products/catalog/:catalogId/photos/plan | JSON estricto `{count: 1..30}`; devuelve token firmado y count |
| POST /api/products/catalog/:catalogId/photos/item | Multipart con un campo image, token e index (0..29 y menor que count del plan); devuelve producto mínimo |
| GET /api/products/catalog/:catalogId/photos/pending?page=1 | Pendientes del propietario, página de 24, count global, page y pages; firma únicamente las imágenes de esa página |
| PUT /api/products/:id/complete | JSON estricto con name, price, reviewed:true, categoryId opcional/null y description opcional; conserva el producto inactivo |
| PUT /api/products/:id | Publicación posterior con active:true; rechaza PRODUCT_INCOMPLETE si sigue pendiente |

El plan HMAC SHA-256 usa el secreto JWT existente y un propósito separado PRODUCT_PHOTOS. Vincula propietario, catálogo, vencimiento de treinta minutos y hasta treinta UUID generados en servidor. La firma se compara en tiempo constante. El cliente no elige los UUID ni puede ampliar el plan a 31 posiciones. Cada UUID es también la identidad de la operación sobre esa foto: repetir la misma posición recupera el producto existente. Dos peticiones concurrentes que compitan por esa posición solo pueden crear una fila; la perdedora elimina exclusivamente el objeto distinto que acababa de subir. No hay tabla de operaciones, dependencia nueva ni variable de despliegue adicional.

Una operación nueva puede crear otros productos: el límite de treinta es por plan, no una cuota acumulada de almacenamiento por vendedor. No se implementa deduplicación de fotos entre operaciones. No reutilizar un token de plan después de borrar deliberadamente sus productos; no existe un recibo durable de una posición eliminada.

## Preparación y límites

Canvas nativo, sin dependencia adicional. El navegador procesa una imagen cada vez: JPEG, PNG o WebP; original hasta 20 MiB y cuarenta megapíxeles, con orientación aplicada por createImageBitmap. Se limita el lado mayor a 1.800 px, sin ampliar originales pequeños, y se intenta llegar a aproximadamente 300 KiB reduciendo calidad WebP. El límite duro de salida es 2 MiB: si no puede cumplirlo, esa foto falla y las otras continúan. WebP conserva transparencia; si el navegador no codifica WebP, Canvas puede devolver PNG, que también debe cumplir el límite. No se fuerza JPEG. Se liberan ImageBitmap y superficie Canvas tras cada archivo. El límite de píxeles se comprueba al decodificar: no garantiza evitar toda asignación temporal del decodificador del navegador.

El servidor no confía en esa compresión: Multer limita a un archivo, 2 MiB, dos campos de texto, tres partes y 4 KiB por campo; el servicio exige un MIME permitido y firma coincidente. Es detección de cabeceras, no un decodificador completo de imágenes ni una comprobación de dimensiones en servidor. El proxy limita exclusivamente esta ruta a 2 MiB + 16 KiB de envelope; no aumenta límites generales ni modifica el upload individual de 5 MiB.

El router limita noventa peticiones por usuario cada quince minutos y admite una petición activa por usuario y cuatro por proceso. La admisión ocurre antes de Multer. Durante una subida conserva la plaza hasta terminar el trabajo, incluso si el cliente desconecta. Estos límites en memoria son por instancia; no constituyen una cuota persistente global entre réplicas. Sigue aplicando además el límite general por IP de la API. No se han consultado ni modificado cuotas o configuración de Supabase.

## Integridad, fallos y detención

Se valida propiedad antes de usar Storage; después de subir se bloquea y revalida catálogo/propietario/archivado dentro de la transacción que crea Product y ProductImage juntos. Ante un error, se comprueba primero si la base llegó a confirmar la referencia al mismo objeto: una respuesta de commit perdida no debe borrar una imagen ya referenciada. Si la creación falló y no hay esa referencia, se intenta borrar el objeto propio. Si tampoco puede consultarse la base, se conserva el objeto para reconciliar antes que borrar una referencia posiblemente confirmada. Si el borrado falla, se emite únicamente un evento fijo photo_cleanup_failed, sin respuesta del proveedor, archivo, destinatario ni token. No hay transacción distribuida entre Storage y PostgreSQL: un reinicio, una respuesta perdida de Storage o una compensación fallida todavía pueden dejar un objeto huérfano. La reconciliación periódica de objetos sin referencia queda pendiente.

El navegador espera cada respuesta antes de preparar/enviar la siguiente foto; no hay reintentos automáticos. «Detener después de la foto actual» espera el envío iniciado y deja los siguientes sin procesar. Si se pide detener durante la compresión, no inicia esa petición. Un error de preparación no impide las demás; un error de sesión, permiso, catálogo o rate limit detiene las siguientes. Una respuesta perdida queda como resultado desconocido: podría existir un producto guardado, por lo que se indica refrescar y comprobar el listado antes de repetir.

El reporte vive solo en memoria y no se reanuda tras recargar. Los productos ya guardados permanecen y se recuperan mediante el listado de pendientes del servidor. El refresco del listado no borra el reporte ni el borrador del editor manual; Excel y carga por fotos no pueden ejecutarse simultáneamente desde la interfaz.

## Interfaz y accesibilidad

Contador global desde la API, distintivo «Sin completar», foto grande, formulario etiquetado y controles nativos de teclado. Guardar avanza en la cola local de la página; Anterior y Omitir por ahora permiten recorrerla sin interceptar flechas dentro de campos. Cerrar, actualizar o cambiar de producto/página comprueban cambios sin guardar; se avisa también al recargar/cerrar y se protegen los enlaces durante trabajo/edición. El cambio de pestaña conserva el panel montado. No hay recuperación durable del borrador tras una navegación forzada.

## Comprobaciones

- API: npm.cmd run build y npm.cmd test. Las pruebas de fotos usan HTTP real en loopback y dobles de PostgreSQL/Storage: límites, propiedad, firma, idempotencia, compensación, creación inactiva, exclusión de catálogo/pedidos, bloqueo de activación y completado sin publicación.
- Frontend: npm.cmd run lint y npm.cmd run build.
- Flujo: node scripts/verify-product-photos.mjs; errores independientes, respuesta desconocida, detención, autenticación, secuencia y límites de cliente/proxy.
- Navegador: npm.cmd run test:import-browser; añade Canvas/WebP real y transparencia, foto corrupta, completado por teclado, publicación separada, detención y anchos 320/390/1024/1440, usando API local simulada. No contacta Storage ni una base real.

Orden de despliegue pendiente de autorización: respaldo y migración por separado → Prisma/API → frontend. La columna aditiva puede conservarse al volver a una versión anterior, pero no debe usarse una API antigua para gestionar provisionales: no conoce el bloqueo de activación. No hay personalización de temas, portada ni fuentes en este bloque. Glamour sustituye la marca ajena fijada en código por «Tu momento de belleza».

## Archivos del cambio

| Archivo | Cambio |
|---|---|
| catalog-api/prisma/schema.prisma | Campo explícito needsCompletion en Product |
| catalog-api/prisma/migrations/20261025210000_photo_products/migration.sql | Columna aditiva con false para productos existentes; sin aplicar |
| catalog-api/src/schemas/product-photo.schema.ts | Contratos estrictos de plan, posición y completado |
| catalog-api/src/services/product-photo.service.ts | Plan firmado, nombres provisionales, validación, idempotencia y compensación |
| catalog-api/src/repositories/product-photo.repository.ts | Creación atómica con imagen, pendientes paginados y completado sin publicación |
| catalog-api/src/routes/product-photo.routes.ts | HTTP privado, límite de archivo, frecuencia y admisión de concurrencia |
| catalog-api/src/routes/product.routes.ts | Montaje de rutas y composición con Storage existente |
| catalog-api/src/repositories/product.repository.ts | Rechaza activación de un pendiente bajo bloqueo de catálogo |
| catalog-api/src/controllers/product.controller.ts | Mensaje 409 comprensible al intentar publicar un pendiente |
| catalog-api/src/repositories/product-list.repository.ts | Contador global needsCompletionCount desde PostgreSQL |
| catalog-api/src/repositories/catalog.repository.ts | Permite inyectar cliente para probar exclusión pública; consulta pública sin cambio de comportamiento |
| catalog-api/src/services/product-photo.test.ts | Nueve grupos de pruebas, incluidos HTTP multipart válido/31 archivos/2 MiB, commit incierto y pruebas obligatorias |
| catalog-api/src/routes/product-list.routes.test.ts | Fixture con campo nuevo y comprobación de contador independiente de página/filtros |
| catalog-api/scripts/test.cjs | Registra pruebas nuevas |
| catalog-api/src/scripts/verify-platform-metrics-postgres.ts | Fija el verificador previo hasta su migración objetivo para no romperlo al añadir la migración de fotos; no ejecutado contra PostgreSQL en este bloque |
| catalog-generator/lib/compress-product-photo.ts | Canvas nativo con transparencia, dimensiones, bytes y liberación de recursos |
| catalog-generator/lib/product-photo-flow.ts | Cola secuencial, resultados por foto y detención |
| catalog-generator/components/products/ProductPhotoPanel.tsx | Selector múltiple, reporte, progreso, revisión y navegación de pendientes |
| catalog-generator/components/products/CatalogProductList.tsx | Disparador, contador del servidor, distintivo y publicación posterior |
| catalog-generator/components/catalogs/CatalogWorkspace.tsx | Integración con refresco, exclusión mutua de paneles y sesión expirada sin perder el reporte abierto |
| catalog-generator/lib/api.ts | Tipos Product.needsCompletion y ProductPage.needsCompletionCount |
| catalog-generator/lib/backend-proxy-limits.ts | Tope específico de multipart de fotos |
| catalog-generator/components/public/GlamourTemplate.tsx | Sustituye ambas apariciones de Miley Beauty por textos neutros |
| catalog-generator/scripts/verify-product-photos.mjs | Siete grupos de flujo y proxy sin navegador ni red |
| catalog-generator/scripts/verify-product-import-browser.mjs | Escenarios de fotos reales en navegador sobre API simulada, manteniendo regresión Excel |
| README.md | Enlace a este bloque |
| docs/product-photos.md | Contratos, garantías, límites y comprobaciones |

Hallazgo anterior que no se incorpora silenciosamente: el borrado general de productos elimina filas e imágenes relacionadas en PostgreSQL, pero no borra sus objetos de Storage. La compensación nueva cubre la creación fallida; la limpieza general y la reconciliación de objetos requieren otro cambio acotado.

## Propuesta de personalización, pendiente de autorización

Paletas completas mediante themePreset; no dos colores libres. Cada preset debe contener fondo, texto, principal, texto sobre principal, secundario, bordes y estados interactivos compatibles con cada plantilla. Contraste mínimo 4,5:1 en texto normal, 3:1 en texto grande y controles/estados; comprobar hover, foco y selección. Los colores semánticos de error y advertencia quedan fuera de la personalización.

Portada: ocupar el área visual del hero de cada diseño, sustituyendo la decoración actual cuando exista imagen; en móvil se apila con su área reservada. Nombre, logo y controles permanecen en superficies controladas, sin texto sobre fotografía. Sin portada, se conserva la composición existente.

Tipografía: presets Inter (actual), Source Serif 4 para títulos con cuerpo Inter, y Nunito Sans para una alternativa sans. Las fuentes nuevas se incorporarían localmente con licencia y revisión de caracteres españoles, tamaños y saltos de línea; no se han descargado ni añadido. El futuro cambio requeriría tres campos opcionales Catalog.themePreset, coverImagePath y fontPreset, con NULL conservando los diseños actuales. No se implementó ninguno.
