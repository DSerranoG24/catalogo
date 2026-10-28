# Gestión de datos personales

Implementación local del 27 de octubre de 2026. No se han aplicado migraciones
ni realizado operaciones de Git o contra servicios remotos.

## Contrato y consentimiento

El checkbox conserva su texto. El frontend muestra el registro inmutable
`catalog-generator/lib/customer-consent.ts` y envía `customerConsentVersion`.
La API admite las versiones publicadas de
`catalog-api/src/services/customer-consent.ts`, nunca una versión inventada.
La versión inicial es `2026-10-27.v1`, fecha `2026-10-27`.

Esta versión identifica el texto del consentimiento, no una aceptación
versionada de todo el contenido de la política de privacidad o de los términos.
Ambos registros se contrastan en una prueba. Para cambiar el texto, añadir una
entrada nueva en la API, conservar las anteriores y seleccionar la nueva en el
frontend. Durante la transición se aceptan omisión o null, guardando null. No
hay fecha de corte inventada; exigir versión requerirá otro despliegue coordinado.
Recuperar un pedido por idempotencia no modifica su fecha ni su versión.

## Anonimizar un pedido

`POST /api/orders/:orderId/anonymize`, con sesión y filtro
`Order → Catalog → userId`. Solo COMPLETED o CANCELLED.

El cuerpo exige `confirmation: "ANONIMIZAR"`, `clientDataReviewed: true`,
`redactProductNames: boolean` y `redactSellerFields: string[]` (lista cerrada).
El panel muestra las líneas y la instantánea para su revisión explícita.
La lista privada conserva lotes de hasta 100 pedidos y añade navegación por
cursor (creación e id como desempate), validado contra el propietario. Así los
pedidos antiguos también pueden revisarse antes de cerrar una cuenta.

- Nombre: `Cliente anonimizado`; teléfono: cadena vacía.
- Correo, dirección y notas: null.
- `anonymizedAt`: primera fecha de la operación; repetir conserva esa fecha.
- Importes, cantidades, líneas y fechas comerciales se conservan. Prisma cambia
  updatedAt. Fecha y versión del consentimiento se conservan.
- La instantánea proviene exclusivamente de los campos comerciales del catálogo
  al emitir. No incluye campos del comprador por construcción. Sin embargo,
  el vendedor pudo incluir datos del cliente en esos textos libres.
- No se intenta adivinar la identidad por coincidencias de nombre. El vendedor
  señala los campos que contienen datos del CLIENTE; se vacían esos campos
  (nombre sustituido por marcador). Puede sustituir los nombres de todas las
  líneas por un marcador si contienen datos del cliente. Los demás campos del
  VENDEDOR se conservan. No se recalculan los importes ni se eliminan líneas.

La revisión es humana: una confirmación incorrecta no permite garantizar que
ningún texto restante identifique a una persona. No es un detector automático
de información personal ni una garantía de anonimización de otros sistemas.

Bloqueo de fila del pedido antes de cualquier escritura, con filtro de
propietario en SQL y en la lectura. No toma primero el catálogo: conserva el
orden pedido → catálogo de la emisión. Estado y primera fecha se revisan dentro
de la transacción. Lectura pública, comprobación final del PDF, emisión nueva
y recuperación de una emisión existente exigen `anonymizedAt IS NULL`.
No se pueden retirar PDFs descargados, mensajes de WhatsApp ni copias externas.

## Eliminar un pedido pendiente

`DELETE /api/orders/:orderId`. Exige `confirmation: "ELIMINAR"` y
`customerName` exactamente igual al persistido, comprobados bajo bloqueo.
Solo PENDING; CONFIRMED, COMPLETED y CANCELLED se rechazan.

Se bloquea pedido → catálogo, se registra la marca y se borra el pedido en una
transacción. Las líneas desaparecen por la FK CASCADE existente; los campos de
cotización desaparecen con el pedido. No se decrementa quotationCounter.

`order_deletion_markers` guarda únicamente `(catalogId, SHA-256(clave))`, con
clave primaria compuesta y CHECK hexadecimal. No guarda nombre, contacto,
pedido, cuerpo ni clave en claro. Es una huella técnica para reconocer
reintentos, no una prueba de que cualquier entrada arbitraria sea anónima.
Los clientes deben usar claves aleatorias, como el UUID del frontend actual.

La creación con clave toma el mismo bloqueo de catálogo y comprueba la marca
ANTES de recuperar o crear. Un reintento de una clave eliminada devuelve 409.
Una compra nueva requiere una clave nueva. Sin clave no puede distinguirse un
reintento de una compra nueva: se conserva el contrato anterior por solicitud.
La marca dura mientras exista su catálogo; no hay purga por antigüedad.

## Cerrar una cuenta

`POST /api/auth/close`, con sesión, límite de intentos, confirmación
`CERRAR CUENTA` y reautenticación. Contraseña actual si la cuenta tiene
contraseña local, aunque también tenga Google. En las demás, token de Google:
firma y audiencia verificadas por google-auth-library, sujeto vinculado,
correo verificado, emisor permitido, vigencia e iat en los últimos cinco
minutos (30 segundos de tolerancia futura). No se usa el correo escrito como
prueba ni se guarda contraseña/token en el trabajo.

Decisiones adicionales aprobadas durante esta implementación:

1. Si hay PENDING o CONFIRMED, se bloquea el cierre. El vendedor debe resolverlos;
   no se borran ni se cambian de estado automáticamente.
2. Todos los COMPLETED/CANCELLED deben haber pasado primero por la revisión de
   anonimización. El cierre se bloquea si falta alguno. Evita una supuesta
   anonimización masiva sin revisar textos libres.
3. Se conservan las instantáneas comerciales del VENDEDOR. Por tanto, el historial
   no es anónimo respecto al vendedor. Esta limitación aparece en la interfaz.

En una transacción se bloquean pedidos, catálogos y usuario, se revalida la
credencial frente a cambios concurrentes, se retiran los catálogos, se asigna
User.closedAt, se incrementa sessionVersion, se eliminan tokens de recuperación
y se crea un único AccountClosureJob por usuario. No se borra físicamente User.
Una repetición ya reautenticada recupera el trabajo existente.

El proxy elimina la cookie HttpOnly al recibir el éxito 202; la interfaz elimina
la metadata visual y muestra `/cuenta-cerrada` (noindex). La API rechaza sesiones,
nuevos inicios de sesión y recuperación de cuentas cerradas. Si se pierde la
respuesta tras el commit, el trabajo sigue; la sesión ya está invalidada y una
petición posterior elimina la cookie al recibir 401.

Los triggers de base de datos bloquean INSERT/UPDATE/DELETE sobre catálogo y
descendientes cuando existe el trabajo, incluidas peticiones autenticadas antes
del cierre. Toman bloqueos compartidos de catálogo/usuario para serializar con
el cierre. Solo el proceso interno de limpieza usa el ajuste LOCAL de transacción
`app.account_closure_worker`; no existe una entrada HTTP para habilitarlo.
Las transacciones pueden ser abortadas por PostgreSQL ante un interbloqueo:
se revierten, se informa fallo y se puede reintentar, sin continuar parcialmente.

## Limpieza persistente y reanudación

AccountClosureJob guarda usuario técnico, fase, intentos, prefijos propios,
cola de carpetas, offset de listado y rutas pendientes. No guarda credenciales.
Un índice único impide trabajos duplicados. `FOR UPDATE SKIP LOCKED` evita que
dos instancias procesen simultáneamente el mismo lote.

El servidor inicia un worker con un tick cada 30 segundos. Es un intervalo de
procesamiento, no una política de retención. Cada lote:

1. PENDING: lista hasta 100 entradas de una carpeta del bucket actual
   `product-images`, ordenadas por nombre, y persiste progreso y rutas ANTES de
   borrarlas. Recorre recursivamente solo los prefijos exactos de sus catálogos:
   logos, productos, categorías, banners y objetos sin referencias.
2. CLEANING: elimina hasta 100 rutas persistidas y confirma su retirada del
   manifiesto después del éxito. Si falla Storage, siguen pendientes. Si falla
   el commit después de eliminar, repetir la eliminación es seguro.
3. Sin rutas pendientes, elimina productos/categorías/banners y catálogos SIN
   pedidos. Conserva los catálogos técnicos con pedidos y las líneas históricas;
   productId pasa a null por la FK existente. Limpia el perfil actual de los
   catálogos y el usuario: email técnico `id@closed.invalid`, sin nombre,
   contraseña ni Google. Conserva closedAt e historial autorizado.
4. COMPLETE significa que terminó ese ciclo. Se reabre el escaneo tras cinco
   minutos para recoger finalizaciones remotas tardías de subidas o huérfanos
   que aparezcan tras un timeout o reinicio. No certifica la eliminación de
   respaldos, copias descargadas o datos externos.

Las subidas toman un bloqueo compartido del catálogo y rechazan cuentas en
cierre. El cierre espera las subidas ordinarias en vuelo. Se intenta compensar
un objeto si falla la transacción de bloqueo después de subir; la reconciliación
persistente cubre huérfanos y resultados remotos inciertos. No hay transacción
distribuida entre Storage y PostgreSQL. La interfaz nunca anuncia «todo eliminado».

No se borran buckets completos ni prefijos de otro propietario. Se rechazan
componentes `..`, vacíos, barras inversas y entradas de listado con separadores.
No se registran rutas, contraseñas, tokens ni errores detallados del proveedor.
`attempts` cuenta lotes/intentos, no solo errores. La cola requiere que al menos
una instancia API esté activa; se reanuda desde la base al arrancar de nuevo.

Consulta operativa sin datos personales:

```sql
SELECT phase, COUNT(*) AS jobs, SUM(cardinality("pendingPaths")) AS pending_files
FROM account_closure_jobs GROUP BY phase;
```

## Migraciones y despliegue pendiente

No se modifica ninguna migración anterior ni ninguna FK existente.

- `20261027200000_order_privacy/migration.sql`: añade TEXT nullable
  customerConsentVersion y TIMESTAMP(3) nullable anonymizedAt a orders. Todos
  los pedidos existentes quedan con ambas columnas NULL; no se atribuye una
  aceptación ni una anonimización retrospectiva.
- `20261027201000_privacy_lifecycle/migration.sql`: añade User.closedAt nullable,
  crea ambas tablas técnicas con sus claves/CHECK y las nuevas relaciones de
  esas tablas, y crea los triggers de congelación. No crea trabajos ni marcas
  para datos existentes y no elimina nada al aplicarse.

El SQL completo está en esos dos archivos. No ejecutarlo desde el arranque.
Antes de publicar código dependiente: ensayo de ambas migraciones y sus bloqueos
en PostgreSQL local, migración coordinada por el responsable, API y frontend.
La API antigua no debe seguir escribiendo mientras se activa el cierre con los
triggers nuevos: coordinar la actualización. Revertir el código no revierte
anonimizaciones, borrados ni cierres. Conservar tablas/columnas al retirar código;
no destruir manifiestos pendientes como supuesto rollback.

## Verificación local

Archivos del cambio, agrupados por responsabilidad (sin operaciones de Git):

| Archivos | Cambio |
| --- | --- |
| `catalog-api/prisma/schema.prisma` y las dos migraciones citadas | Campos, marcas, trabajos persistentes y congelación de escrituras. |
| `catalog-api/src/services/customer-consent.ts`, `src/schemas/order.schema.ts` | Registro de textos admitidos y validación de la versión. |
| `catalog-api/src/repositories/order.repository.ts`, `src/services/order.service.ts`, `src/controllers/order.controller.ts` | Persistencia de versión, marca anti-reintento, selección privada y paginación. |
| `catalog-api/src/schemas/order-privacy.schema.ts`, `src/repositories/order-privacy.repository.ts`, `src/controllers/order-privacy.controller.ts`, `src/routes/order.routes.ts` | Confirmaciones, propiedad, transacciones de anonimización/borrado. |
| `catalog-api/src/repositories/quotation.repository.ts`, `quotation-issue.repository.ts`, `src/controllers/quotation.controller.ts` | Revocación por anonimización en todas las etapas del PDF. |
| `catalog-api/src/services/account-closure.service.ts`, `account-closure-worker.ts`, `src/routes/account-closure.routes.ts`, `auth.routes.ts`, `src/server.ts` | Reautenticación, cierre persistente y worker reanudable. |
| `catalog-api/src/services/auth.service.ts`, `src/middlewares/auth.middleware.ts`, `src/repositories/account-action.repository.ts` | Rechazo de acceso y recuperación tras el cierre. |
| `catalog-api/src/services/storage.service.ts` | Bloqueo de subidas frente al cierre, compensación y adaptador de limpieza. |
| `catalog-api/scripts/test.cjs`, `src/repositories/order-privacy.test.ts`, `src/services/account-closure.test.ts` | Registro y pruebas nuevas de privacidad, cola y reautenticación. |
| `catalog-api/src/repositories/quotation-issue.test.ts`, `src/controllers/quotation.controller.test.ts` | Regresiones específicas de revocación, incluida la comprobación final. |
| `catalog-api/src/repositories/order-quotation.test.ts`, `src/controllers/public-order-resilience.test.ts` | Dobles actualizados para la comprobación de marcas y filtro del PDF. |
| `catalog-api/src/repositories/admin-metrics.test.ts`, `src/routes/admin.routes.test.ts`, `src/services/account-action.test.ts` | Añade closedAt null a los usuarios sintéticos existentes. |
| `catalog-api/src/controllers/public-catalog.controller.ts` | Respuesta 409 comprensible ante una clave eliminada. |
| `catalog-generator/lib/customer-consent.ts`, `components/public/PublicShoppingCartPage.tsx` | Mismo texto mostrado y versión enviada al crear. |
| `catalog-generator/components/catalogs/OrdersPanel.tsx`, `OrderPrivacyActions.tsx` | Acciones por estado, revisión/confirmaciones, información de consentimiento y navegación histórica. |
| `catalog-generator/components/auth/CloseAccountForm.tsx`, `app/dashboard/cuenta/page.tsx`, `app/dashboard/layout.tsx` | Configuración de cuenta, reautenticación y acceso desde el panel. |
| `catalog-generator/app/api/backend/[...path]/route.ts`, `app/cuenta-cerrada/page.tsx` | Cookie eliminada desde el servidor y mensaje de limpieza pendiente. |
| `catalog-generator/scripts/verify-order-privacy-browser.mjs` | Interacciones y sesión real del proxy con API simulada, a cuatro anchos. |
| `docs/personal-data-management.md`, `docs/personal-data-checks.json` | Contrato, límites, migraciones, archivos y evidencia local. |

Resultados y límites se registran en `docs/personal-data-checks.json`.
Las pruebas de repositorio utilizan dobles transaccionales sin conexión real;
la restauración del trabajo simula reinicio mediante serialización del estado
persistido. No acredita un reinicio real con PostgreSQL ni el motor de bloqueos.
El navegador usa API HTTPS simulada en loopback y un perfil temporal; comprueba
la cookie real del proxy, no una cuenta remota. Google se valida con pruebas de
reglas y biblioteca instalada, sin un inicio de sesión real con Google.

No se han probado en este bloque: aplicar/revertir SQL, concurrencia real de
PostgreSQL, limpieza real de Supabase, caída de un proceso durante una llamada
remota, Google real, lector de pantalla humano ni revisión jurídica. Esos ensayos
siguen pendientes antes de desplegar. No hay dependencias o variables nuevas.
Las páginas legales y el sitemap se conservan sin cambios.
