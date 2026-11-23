# Clientes en ventas internas: segunda fase

No asocia Customer con Order, no crea clientes al convertir pedidos y no cambia
inventario, precios, pagos ni documentos fiscales. El catálogo público no cambia.

## Esquema y datos históricos

Sale agrega cuatro columnas nullable, sin defaults ni backfill:

- `customerId`: relación operativa opcional a Customer.
- `customerNameSnapshot`, `customerPhoneSnapshot`, `customerEmailSnapshot`:
  valores históricos obtenidos en servidor al asignar el cliente.

La FK compuesta `(customerId, userId)` referencia `Customer(id, ownerId)` con
`ON DELETE RESTRICT / ON UPDATE RESTRICT`. Impide enlazar propietarios distintos
también en PostgreSQL y evita borrar clientes con ventas asociadas. No existe
borrado físico por API. Cuando customerId es null la FK opcional permite la venta
sin cliente. Un índice `(customerId, userId)` cubre la relación inversa.

Las ventas anteriores quedan con los cuatro campos nuevos en null. Se conservan
los campos existentes `customerName` y `customerPhone`: siguen aceptando datos
libres en ventas sin relación y conservan los datos de pedidos convertidos.
Cuando se asigna Customer esos dos campos también se rellenan desde servidor
para que consumidores anteriores sigan mostrando el comprador original.

Editar o archivar Customer no actualiza Sale. Los snapshots son la fuente histórica;
la ficha actual se devuelve en un objeto separado `customer`, con `id`, `fullName`,
`phone`, `email`, `archivedAt`. No se incluyen dirección ni notas de la ficha.
El include filtra por propietario y la venta se consulta siempre por userId.
Archivar un cliente no rompe la lectura de sus ventas anteriores.

## API

Se conservan autenticación Bearer y proxy same-origin existentes. Rutas:

- `POST /api/sales`: `operationId`, `requestId`, `customerId?: UUID | null`;
  siguen aceptándose `customerName?` y `customerPhone?` para el flujo sin cliente.
  Si hay customerId estos textos se ignoran y se capturan los datos de Customer
  dentro de la misma transacción, tras bloquear la fila con FOR SHARE.
- `GET /api/sales` y `GET /api/sales/:id`: devuelven snapshots y ficha actual
  por separado. El listado conserva su límite actual de 50 ventas.
- `PATCH /api/sales/:id`: conserva `operationId`, `expectedVersion`, `lines`
  obligatorios y acepta `customerId?: UUID | null` además de los campos libres
  previos. Solo se modifica una venta DRAFT, con versión coincidente.

El contrato de respuesta sigue siendo `{ result: Sale }` o `{ result: Sale[] }`;
crear conserva HTTP 200. Los importes BigInt se serializan como strings decimales,
sin convertir a Number ni perder precisión. Las respuestas usan no-store.

Semántica de PATCH:

- customerId omitido: conserva relación y snapshots. Si está vinculada, ignora
  nombres/teléfonos libres que intenten sustituir el comprador histórico.
- El mismo customerId: no vuelve a capturar ni refresca snapshots, aunque el
  cliente haya cambiado o esté archivado. Es conservar una asignación existente.
- customerId distinto: exige cliente activo propio y captura una nueva instantánea.
- customerId null explícito en una venta vinculada: desvincula y limpia los tres
  snapshots; limpia también los campos libres salvo que se envíen expresamente.
- Si ya era una venta sin relación, se conserva la edición libre previa.

No se puede asignar, cambiar o quitar cliente en CONFIRMED, DELIVERED, CANCELLED
o RETURNED. No se agregan excepciones a las transiciones. Una repetición idempotente
de una edición ya aplicada solo devuelve la venta; no realiza otra mutación.

Los esquemas estrictos rechazan snapshots o correo de comprador enviados por
el cliente, owner/userId y UUID inválidos. Los campos nuevos no se admiten en
confirmar, entregar, cancelar o devolver. La conversión acepta solo customerId
como vínculo operativo privado, además de sus parámetros anteriores.

Errores identificables de la API de ventas:

- 404 `CUSTOMER_NOT_FOUND`: cliente inexistente o de otro propietario, mismo mensaje.
- 409 `CUSTOMER_ARCHIVED`: nueva asignación a cliente archivado.
- 409 `INVALID_TRANSITION`, `VERSION_CONFLICT`, `IDEMPOTENCY_CONFLICT`: políticas
  existentes de estado, versión y comando. Una colisión UNIQUE se traduce a conflicto.
- 400 `INVALID_SALE_INPUT`: entrada inválida sin incluir contenido del cuerpo.
- 404 `NOT_FOUND`: venta no accesible por el propietario.
- 500 `SALE_OPERATION_FAILED`: fallo inesperado; no se exponen mensajes Prisma,
  detalles de infraestructura ni datos personales.

## Idempotencia y atomicidad

Se corrigió el alta de borradores: antes insertaba Sale antes de buscar una
operación previa. Ahora un bloqueo asesor transaccional por propietario serializa
altas; se comprueban operationId/requestId antes de crear. Un reintento idéntico
recupera la misma venta y sus snapshots originales, aunque Customer haya cambiado.
Cambiar el comando con esos identificadores genera conflicto. Se mantiene el hash
de comando existente; no se promete equivalencia entre payloads distintos.

La edición de borrador bloquea Sale, valida propietario/estado/versión y repite
esa política de recuperación. Cliente, líneas, importes, incremento de versión
y operación se escriben en una transacción. Un fallo revierte todos esos cambios.
No se refrescan snapshots al confirmar o entregar. Los reintentos muestran la
ficha actual por separado, no sustituyen la instantánea histórica.

No se rediseña la idempotencia de las demás transiciones del servicio anterior.
La conversión conserva el contacto libre de Order, sus precios congelados y sus
reglas de stock. Además captura nombre, teléfono y correo del pedido en los tres
snapshots, incluso sin Customer. Ver el contrato de [comprador del pedido](order-sale-buyer.md).

## Frontend

El panel existente de ventas incorpora un formulario mínimo de creación de
borrador con búsqueda privada de clientes activos y opción Sin cliente.
Envía solo customerId y los identificadores de operación, nunca snapshots.
Conserva esos identificadores para reintentar un alta fallida y evita dobles envíos.
Las búsquedas tardías se descartan; un error de clientes no impide crear sin cliente.
La búsqueda usa los 25 resultados de la página actual y pide afinar si hay más.
No se agregó editor completo de líneas ni se rediseñó el panel/devoluciones.

El detalle muestra Comprador registrado usando snapshots (o campos históricos
previos para ventas antiguas), y Ficha actual como información independiente.
No utiliza la ficha actual como fallback del comprador registrado.

## Migración pendiente y verificación

`prisma/migrations/20261123000000_sale_customer/migration.sql` se genera offline
comparando el schema de Git anterior con el nuevo; no se conecta a datasource ni
shadow database. Agrega cuatro columnas nullable, índice y FK. Requiere la primera
fase de Customer y su clave `(id, ownerId)`. No ejecuta UPDATE ni cambia ventas
históricas; la tabla Sale toma bloqueos DDL al aplicar, por lo que el operador debe
elegir la ventana adecuada. No se ejecutó ninguna migración ni operación sobre datos.

Aplicar primero en entorno aislado, verificar ventas antiguas con null, rechazo
de FK entre propietarios y bloqueo de edición/archivado de Customer mientras se
captura la instantánea. Después el operador puede aplicar la migración autorizada
antes de publicar la API; publicar frontend tras API. La versión previa sigue
siendo compatible con estas columnas adicionales. Para revertir código conservar
las columnas/datos; no ejecutar DROP ni borrar las instantáneas ya capturadas.
Prisma Client se regenera localmente sin aplicar migraciones. No hay dependencias
ni variables nuevas.

Las pruebas usan repositorios simulados y HTTP local; comprueban el flujo real
de servicios, errores, idempotencia y rollback del doble, pero no certifican
FK/bloqueos/concurrencia SQL real. Se conservan las pruebas de conversión existentes.
El test frontend verifica que la presentación use snapshots y soporte ventas
antiguas. Falta ensayo de migración y concurrencia en PostgreSQL desechable y
comprobación del formulario con navegador y tecnologías de asistencia.

Verificación local del 23 de noviembre de 2026: 25 pruebas específicas y 294
pruebas backend completas aprobadas. Pruebas frontend y builds de ambos paquetes
correctos. Lint frontend: cero errores y las cuatro advertencias previas de img.
Schema validado con Prisma y cliente generado sin aplicar migraciones. No hay
scripts separados de typecheck ni lint backend; los builds ejecutan TypeScript.

Comandos desde catalog-api:

```text
node --require ./scripts/test.cjs --import tsx --test src/services/sale-customer.test.ts src/services/sale-conversion.test.ts src/schemas/sales.schema.test.ts
npm.cmd test
npm.cmd run build
node node_modules/prisma/build/index.js validate
```

Desde catalog-generator: `npm.cmd test`, `npm.cmd run build`, `npm.cmd run lint`.
En la raíz: `git diff --check`. El generador OpenAPI registra las nuevas rutas
y esquemas de ventas; el documento conserva los esquemas ajenos a esta fase,
por la desincronización previa ya documentada en la primera fase de clientes.

Sigue pendiente definir retención/anonimización de compradores históricos y de
clientes de cuentas cerradas, así como fusión de duplicados. No se introduce
sincronización retroactiva, ni eliminación física, ni asociación con pedidos.
