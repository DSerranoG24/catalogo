# Destacados y banners: fase 2A

Implementación de modelo/API; no incluye interfaz ni carrusel. La migración
`20261026180000_catalog_featured_banners` está creada, no aplicada.

## Destacados

Los POST/PUT existentes de productos aceptan `featured: boolean`. Omitirlo
conserva el valor; `false` desmarca. El máximo de cinco incluye selecciones
inactivas/borradores. Se permite persistir uno o dos seleccionados.

Creación y actualización bloquean la fila del catálogo del propietario con
`FOR UPDATE`, cuentan las otras selecciones y escriben dentro de la misma
transacción. Repetir `true` en un producto ya seleccionado no consume otra
plaza. Una sexta selección devuelve 409; desmarcar no comprueba el límite.

`GET /api/catalogs/:id/featured` requiere al propietario y devuelve `products`,
`selectedCount`, `validCount`, `visible` (quórum de tres a cinco activos) y
`warning`. Permite que la fase 2B muestre el aviso aunque el listado privado
esté paginado. Un catálogo no publicado sigue sin ser accesible públicamente.

La lectura pública solo consulta catálogos activos/no archivados y sus
productos activos. Resuelve `featuredProducts` desde la colección completa,
antes de cualquier paginación del frontend. Devuelve cero o entre tres y cinco.
Desactivar/eliminar un seleccionado reduce el quórum en la siguiente lectura.
Las imágenes firmadas y los precios vigentes se reutilizan del listado público.

## Banners

Rutas autenticadas bajo `/api/catalogs/:id/banners`:

| Método | Ruta | Entrada |
| --- | --- | --- |
| GET | `/` | Lista del propietario con `imageUrl` firmada |
| POST | `/` | Multipart: `image`, `title`, `subtitle?`, `linkType`, `linkValue`, `position?`, `active?` |
| PUT | `/:bannerId` | JSON parcial o multipart con reemplazo opcional de `image` |
| PUT | `/order` | JSON `{ "ids": ["uuid", "..."] }`, todos los banners una vez |
| DELETE | `/:bannerId` | Elimina su registro y después su imagen |

`linkType`: PRODUCT, CATEGORY o EXTERNAL. Título: 1–150 caracteres;
subtítulo: hasta 300, admite null; enlace: hasta 2048. En multipart, `active`
usa `true`/`false`, `position` usa 0/1/2 y subtítulo vacío elimina el subtítulo.
Sin posición se ocupa la primera plaza libre. En PUT la omisión conserva.

Las escrituras bloquean el catálogo del propietario antes de leer, validar y
escribir. Máximo tres registros en total, incluidos los inactivos. La base
refuerza el límite con CHECK de posiciones 0..2 más UNIQUE(catalogId, position).
La unicidad es diferible para intercambiar posiciones dentro de una transacción;
no usar upsert/ON CONFLICT sobre esa restricción. El índice solicitado se mantiene.

PRODUCT y CATEGORY deben existir, estar activos y pertenecer al mismo catálogo.
EXTERNAL solo admite http/https sin credenciales incrustadas. No se hacen
solicitudes al destino. `imagePath` no es una entrada admitida del cliente.

La lectura pública incluye `banners` activos ordenados por posición y omite
individualmente destinos eliminados, inactivos, ajenos o de protocolo inválido.
Los enlaces internos usan IDs, no URLs arbitrarias. La ruta de Storage se
resuelve a `imageUrl` firmada al responder. Si falla la firma de un banner,
se omite únicamente ese banner. La interfaz futura debe usar `imageUrl`.

## Imágenes y despliegue

Bucket existente `product-images`; ruta generada por servidor
`catalogId/banners/uuid.ext`; firma de una hora. JPEG/PNG/WebP, máximo 5 MiB,
MIME coincidente con firma y lado mayor de hasta 2400 px. El lector de dimensiones
inspecciona cabeceras JPEG y chunks PNG/WebP, incluidas dimensiones de frames WebP;
no decodifica píxeles. Este límite adicional se aplica a banners, conservando
los límites actuales de otros flujos de imágenes.

Un fallo de escritura intenta borrar el objeto recién subido. Reemplazar guarda
primero y después intenta borrar el anterior. Un fallo de limpieza se registra
con código fijo, sin rutas ni errores internos, y no convierte un commit exitoso
en fallo HTTP. Puede requerir limpieza operativa posterior de objetos huérfanos.

La migración es aditiva: productos existentes quedan con `featured=false` y la
tabla nueva comienza vacía. No altera precios, disponibilidad ni paletas.
Antes de desplegar esta API se debe aplicar la migración de forma autorizada:
Prisma pasa a consultar la columna y la relación nuevas. Orden: migración,
API y luego interfaz. Para volver a la API anterior se pueden conservar columna
y tabla; no se propone borrarlas ni perder contenido creado.

Las pruebas automatizadas usan dobles de Prisma/Storage y HTTP en loopback.
La simulación concurrente verifica el protocolo de bloqueo; no sustituye un
ensayo PostgreSQL de restricciones y concurrencia, pendiente sin aplicar la
migración. La fase 2B deberá comprobar teclado, swipe, contraste real y los
anchos 320, 390, 1024 y 1440 px.

## Ensayo PostgreSQL local

Desde la raíz del repositorio, ejecutar en una PowerShell interactiva:

```powershell
& .\catalog-api\scripts\verify-catalog-highlights-postgres.ps1
```

La URI se solicita con `Read-Host -AsSecureString` y se pasa por stdin, nunca
por argumentos ni archivos. El verificador rechaza destinos distintos de
`catalogo_test` en localhost/127.0.0.1/::1, opciones de URI ambiguas y direcciones
DNS no loopback. Comprueba también nombre de base y dirección del servidor.
No usar túneles a bases remotas.

Crea un esquema aleatorio propio, aplica las 18 migraciones anteriores,
siembra un producto previo y aplica la migración 19. Comprueba ledger, tipos,
defaults, restricciones, índice, concurrencia real de las escrituras de la API,
intercambio de posiciones y omisión independiente de enlaces eliminados.
Finalmente elimina solo su esquema y copias temporales de las migraciones.

El JSON saneado se escribe por defecto en
`$env:TEMP\catalog-highlights-postgres-results.json`; `-ReportPath` permite
elegir otro directorio conservando ese nombre. No contiene URI ni credenciales.
Exigir `success=true` y `cleanup=true`. Ante cualquier fallo detenerse: no hacer
commit/push ni aplicar a Supabase hasta revisar el resultado.
