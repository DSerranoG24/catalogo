# Guardar un comprador como cliente: acción privada y explícita

No hay alta automática al recibir un pedido. Este flujo no cambia el catálogo
público, snapshots históricos, precios, stock, estados ni facturación; tampoco
fusiona fichas ni rellena datos inexistentes desde otras fuentes.

## Previsualización y confirmación

Dos endpoints protegidos por el middleware de autenticación existente:

1. `POST /api/orders/:orderId/customer-preview`, cuerpo `{}`. Lee exclusivamente
   nombre, teléfono, correo, dirección y notas de ese pedido para `result.fields`.
   No escribe, no normaliza el pedido y no crea clientes. Devuelve también
   `invalidFields`, las coincidencias activas (`matches`, máximo 25, `hasMore`),
   `customerId`, ficha previamente guardada `existingCustomer` y venta actual
   mínima `sale: {id,customerId} | null`. Las fichas son información separada,
   nunca reemplazan los datos propuestos del pedido.
2. `POST /api/orders/:orderId/customer-confirm`, respuesta 200
   `{success:true,result:{customer,orderId,associatedSaleId,idempotent}}`.

Lectura auxiliar protegida: `GET /api/orders/:orderId/customer-matches?phone=...&page=1`
devuelve `{success,result:{matches,hasMore,page}}`. Verifica el mismo pedido propio
y su estado; valida el teléfono con el contrato Customer y pagina coincidencias
exactas activas, 25 por página (1–10000). Permite revisar todas las coincidencias
sin cargar una lista ilimitada, también tras corregir el teléfono en el formulario.
Los datos del formulario inicial siguen procediendo solo del pedido.

Crear después de revisar:

```json
{
  "operationId": "UUID",
  "action": "CREATE",
  "customer": {"fullName":"Nombre revisado","phone":"3000000000","email":null,"address":null,"notes":null},
  "associateSale": false
}
```

Usar una ficha coincidente mediante otra acción explícita:

```json
{
  "operationId": "UUID",
  "action": "USE_EXISTING",
  "customerId": "UUID de cliente mostrado",
  "phone": "3000000000",
  "associateSale": true
}
```

`CREATE` reutiliza íntegramente el esquema de clientes: nombre obligatorio y
espacios colapsados, teléfono obligatorio normalizado a 7–15 dígitos, correo
válido si existe, dirección/notas opcionales recortadas. El vendedor puede
corregir datos que el pedido tenía incompletos. Sus cambios solo van a Customer;
no se actualizan nombre, contacto, dirección, notas ni snapshots del pedido.
`USE_EXISTING` no modifica la ficha seleccionada con los valores del formulario.

No se admiten ownerId, userId, orderId en el cuerpo, saleId, snapshots o IDs
arbitrarios dentro de los datos Customer. El propietario procede solo de la
sesión. El ID del cliente solo se admite en USE_EXISTING, debe existir, ser propio,
estar activo y conservar el teléfono mostrado. La venta se obtiene por pedido
y propietario, no por un ID proporcionado por el navegador.

## Estados y coincidencias

Pedidos PENDING, CONFIRMED o COMPLETED permiten revisión y confirmación. CANCELLED
siempre se rechaza, incluso al reintentar una confirmación previa; los pedidos
anonimizados también se rechazan. Un pedido ajeno se comporta como inexistente.
Datos obligatorios faltantes no impiden previsualizar: se señalan para corregir
y la confirmación falla hasta superar el contrato Customer.

Si CREATE encuentra uno o más clientes activos propios con el mismo teléfono
normalizado, devuelve HTTP 409 CUSTOMER_PHONE_MATCH con matches/hasMore. No crea,
asocia ni persiste la confirmación fallida. El operador debe cancelar, corregir
el teléfono o pulsar Usar cliente existente. Las coincidencias son exactas tras
normalizar, sin inferir países, prefijos, similitud de nombres ni correos.
Clientes archivados y clientes de otros propietarios no bloquean un nuevo alta.

Order.customerId conserva el cliente elegido. Si el pedido ya tiene uno, CREATE
devuelve ORDER_CUSTOMER_ALREADY_SAVED; seleccionar otro da ORDER_CUSTOMER_CONFLICT.
No se implementa reemplazo ni fusión. Se puede seleccionar explícitamente la
misma ficha guardada para asociar una venta que apareció después.

`associateSale` es falso por defecto y requiere una casilla explícita en UI.
Si es verdadero, la venta debe existir y pertenecer al mismo propietario y
pedido. Se permite enlazar en DRAFT, CONFIRMED, DELIVERED, CANCELLED o RETURNED:
esta acción es la excepción explícita para el vínculo operativo, no una edición
de la venta. Solo cambia customerId y, si cambia el vínculo, incrementa version.
Todos los snapshots, campos históricos libres, importes y estados quedan intactos.
No se puede sustituir un cliente distinto ya vinculado: SALE_CUSTOMER_CONFLICT.
Una venta creada posteriormente no se enlaza automáticamente; requiere esta
misma acción explícita de selección y la casilla de asociación.

El formulario privado de pedidos separa Crear cliente, Usar cliente existente
y Cancelar. Cancelar no llama al endpoint de confirmación. La UI mantiene el UUID
de operación ante fallo o respuesta inválida y evita dobles envíos. Nunca guarda
contactos, notas ni comandos en localStorage/sessionStorage.

## Idempotencia, concurrencia y atomicidad

`OrderCustomerOperation` tiene clave `(ownerId,operationId)`, hash del comando
normalizado incluyendo orderId, ID del cliente y el ID de venta enlazada si hubo.
No copia los datos personales del formulario al registro de idempotencia.
Un reintento idéntico recupera la ficha actual del mismo cliente y el resultado
de asociación original sin crear fichas, incrementar versiones ni volver a enlazar.
Si cambian pedido o comando con ese UUID, devuelve IDEMPOTENCY_CONFLICT.
Reabrir la revisión tras una respuesta perdida sigue detectando Order.customerId;
no permite duplicar el alta con otro UUID.

En una transacción se bloquean el pedido propio, el propietario activo, la clave
de operación y el teléfono normalizado. El bloqueo asesor de teléfono comparte
namespace con altas/ediciones ordinarias de clientes. La ficha existente y la venta
se bloquean al asociar. Crear Customer, enlazar Order/Sale y registrar la operación
son atómicos; un fallo revierte todos esos cambios. Estado cancelado y ownership
se comprueban otra vez dentro del bloqueo del pedido.

La protección estricta contra duplicados se aplica a este flujo. El módulo de
clientes general conserva su regla anterior de advertir sin prohibir duplicados;
no se añade unicidad global de teléfono ni se cambia la reactivación de fichas.
Las carreras de dos confirmaciones de este flujo se serializan por teléfono y
pedido. La política global sobre altas o reactivaciones desde otros flujos no
se redefine aquí; no se promete unicidad entre todos los escritores posibles.

Los conflictos no completan el UUID: tras CUSTOMER_PHONE_MATCH el operador puede
usar una nueva acción explícita. No hay reintento automático que cree o seleccione
otra ficha. El servidor no guarda una sesión de previsualización: recibir el comando
confirmado del vendedor autenticado es la autorización de los datos editados.

## Privacidad y errores

Las respuestas del controlador son private/no-store. La API usa Bearer; el proxy
same-origin existente conserva la cookie HttpOnly y la comprobación de Origin.
No se imprimen cuerpos, teléfonos, direcciones, emails, notas ni errores internos.
La anonimización existente elimina Order.customerId y sus operaciones en la misma
transacción para no dejar un enlace de reidentificación. No elimina la ficha
Customer independiente ni los snapshots de ventas. Borrar un pedido elimina sus
operaciones por FK CASCADE y conserva Customer; un pedido borrado devuelve 404
en cualquier reintento. No se implementa borrado físico de clientes.

Errores: 400 INVALID_CUSTOMER_INPUT; 401 AUTH_REQUIRED; 404 ORDER_NOT_FOUND o
CUSTOMER_NOT_FOUND; 409 CUSTOMER_PHONE_MATCH, ORDER_CANCELLED, ORDER_ANONYMIZED,
CUSTOMER_ARCHIVED, CUSTOMER_MATCH_CHANGED, ORDER_CUSTOMER_ALREADY_SAVED,
ORDER_CUSTOMER_CONFLICT, ORDER_SALE_NOT_FOUND, SALE_CUSTOMER_CONFLICT o
IDEMPOTENCY_CONFLICT; 500 ORDER_CUSTOMER_FAILED sin detalles de infraestructura.

## Migración pendiente y aplicación

`prisma/migrations/20261123020000_order_customers/migration.sql` se preparó offline
comparando el schema anterior de Git con el nuevo, sin datasource ni shadow DB.
Agrega Order.customerId nullable, índices, tabla de operaciones y FKs. No ejecuta
backfill, UPDATE ni modificación de datos existentes. Requiere las fases previas
de Customer y Sale. La FK de operaciones a Customer es compuesta con propietario;
Order se autoriza por catálogo en cada acceso de aplicación.

Orden manual: revisar SQL y ensayarlo en PostgreSQL desechable, aplicar las
migraciones previas pendientes en orden, aplicar esta migración, verificar FK,
desplegar backend y después frontend. El arranque/build no aplica migraciones.
Planificar el bloqueo DDL de ALTER TABLE. Para rollback de código conservar la
columna, tabla y datos; no borrar clientes ni el registro de operaciones. No hay
dependencias ni variables nuevas. Prisma Client se regenera localmente para
compilar; no se ejecutó ninguna migración contra una base.

## Pruebas y límites

`src/repositories/order-customer.test.ts` recorre repositorio, servicio y HTTP
local con persistencia simulada que rechaza delegados inesperados (no existen
escritores de precios, stock o snapshots). Verifica previsualización sin writes,
normalización, coincidencias/selección, ownership, estados, missing fields,
asociaciones opcionales, idempotencia y rollback. Serializa llamadas concurrentes
en el doble: no certifica bloqueos reales de PostgreSQL.
`order-privacy.test.ts` comprueba retirar vínculos al anonimizar y `app.test.ts`
verifica autenticación real de las rutas montadas con JWT ausente/inválido.
`verify-order-customer-review.mjs` valida respuestas, selección explícita y lista
permitida de campos; no sustituye una prueba de interacción en navegador.

Comprobación local: 14 pruebas nuevas y 22 con las regresiones de privacidad,
suite backend completa 317/317. Tests frontend y builds de ambos paquetes
correctos. Lint frontend sin errores y con las cuatro advertencias previas de img.
Schema Prisma validado y cliente generado localmente; no hay scripts separados
de typecheck ni lint backend. Los builds verifican TypeScript.

Comandos desde catalog-api:

```text
node --require ./scripts/test.cjs --import tsx --test src/repositories/order-customer.test.ts src/repositories/order-privacy.test.ts
npm.cmd test
npm.cmd run build
node node_modules/prisma/build/index.js validate
```

Desde catalog-generator: `npm.cmd test`, `npm.cmd run build`, `npm.cmd run lint`.
Desde raíz: `git diff --check`. OpenAPI registra solo las operaciones/esquemas
nuevos; se preservaron los esquemas ajenos desincronizados previamente, tal como
se documentó en las fases anteriores.

Pendientes: ensayo de SQL, carreras con todos los escritores en PostgreSQL
desechable, revisión en navegador/lector de pantalla y política global de
duplicados/retención. Crear o fusionar clientes por coincidencias probabilísticas
queda fuera de alcance; jamás ocurre automáticamente al recibir pedidos.
