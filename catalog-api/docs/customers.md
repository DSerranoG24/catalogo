# Clientes: primera fase

Módulo privado e independiente. No cambia el catálogo público ni enlaza clientes
con pedidos, ventas o servicios técnicos. No importa automáticamente personas de
pedidos existentes ni incluye notificaciones, facturación o pagos.

## Datos

`Customer` usa la tabla `customers`:

| Campo | Contrato |
| --- | --- |
| `id` | UUID generado por Prisma; solo lectura |
| `ownerId` | ID del usuario autenticado, nunca del cuerpo; solo lectura |
| `fullName` | Obligatorio, 1–160 caracteres tras recortar extremos y colapsar espacios; sin caracteres de control |
| `phone` | Obligatorio, texto de 7–15 dígitos, conserva ceros iniciales |
| `email` | Opcional, correo válido de hasta 254 caracteres, recortado |
| `address` | Opcional, hasta 300 caracteres, recortado |
| `notes` | Opcional, hasta 2000 caracteres, recortado; conserva saltos de línea |
| `archivedAt` | Fecha ISO o `null`; `null` significa activo; solo lectura |
| `createdAt`, `updatedAt` | Fechas ISO gestionadas por el servidor; solo lectura |

El teléfono admite `+` inicial, espacios, paréntesis, puntos y guiones como
formato de entrada (máximo 40 caracteres), y guarda solo dígitos. No comprueba
existencia del número, no adivina país ni agrega prefijos. `+57 (300) 000-0000`
y `573000000000` coinciden; `3000000000` se considera otro número. Correo vacío,
dirección vacía o notas vacías se convierten en `null`; `null` explícito también
los limpia. Omitir campos en PATCH conserva sus valores. No se fuerza minúsculas
en el correo. Dirección y notas rechazan NUL. Nombres iguales están permitidos.

Todos los esquemas rechazan campos desconocidos, incluido `ownerId`, `id`,
`archivedAt` y `active`. PATCH exige al menos un campo editable. El estado solo
cambia por los endpoints de archivado/reactivación. Un cliente archivado se
puede consultar y actualizar sin reactivarlo.

## Endpoints

Todos bajo `/api/customers`, protegidos por `authenticate` y con
`Cache-Control: private, no-store`, incluso ante fallos de autenticación.
El navegador debe usar el proxy privado existente `/api/backend/customers`;
su cookie HttpOnly se transforma en Bearer en servidor y el proxy ya comprueba
Origin en mutaciones. La API no autentica por cookies ni cambia CORS o CSRF.

| Método y ruta | Respuesta |
| --- | --- |
| `POST /` | 201 `{ success, customer, warnings }` |
| `GET /?q=...&status=active&page=1` | 200 `{ success, customers, page, pageSize: 25, hasMore }` |
| `GET /:id` | 200 `{ success, customer }` |
| `PATCH /:id` | 200 `{ success, customer, warnings }` |
| `POST /:id/archive` | 200 `{ success, customer }` |
| `POST /:id/reactivate` | 200 `{ success, customer }` |
| `DELETE /:id` | 405 `CUSTOMER_DELETION_NOT_ALLOWED`; no consulta ni elimina registros |

POST/PATCH reciben `fullName`, `phone`, `email`, `address`, `notes` según las
reglas anteriores. No hay cuerpo requerido para archivar/reactivar; cualquier
cuerpo enviado a esas rutas no se usa para cambiar datos. Repetir una transición
ya aplicada conserva tanto `archivedAt` como `updatedAt`.

La búsqueda `q` admite hasta 160 caracteres, es literal (escapa `%`, `_`, `\`),
y busca por nombre sin distinguir mayúsculas. Si contiene formato telefónico,
también busca por los dígitos normalizados, incluidos fragmentos del número.
`status` admite `active` (predeterminado), `archived`, `all`; `page` es 1–10000,
25 resultados por página, orden `createdAt DESC, id DESC`. Parámetros desconocidos
o repetidos son inválidos. Paginación por desplazamiento: nuevas altas concurrentes
pueden desplazar páginas. No se devuelve un total global ni datos de otros dueños.

Los duplicados de teléfono exacto normalizado, incluidos clientes archivados,
producen `warnings: [{ code: "CUSTOMER_PHONE_MATCH", message: "..." }]`. La creación
sigue devolviendo 201; una actualización de teléfono, 200. No hay restricción
UNIQUE por teléfono ni bloqueo por nombres. En PATCH se excluye el propio ID.
Actualizar otros campos no vuelve a emitir advertencias de un teléfono intacto.
No se devuelven datos ni IDs de los clientes coincidentes. Un bloqueo asesor
transaccional por propietario/teléfono serializa escrituras con el mismo número;
su uso no es una regla de unicidad y no bloquea la creación de duplicados.

Errores `{ success: false, error, message }`:

- 400 `INVALID_CUSTOMER_INPUT`: cuerpo, ID o consulta inválidos.
- 401: sesión ausente, inválida, obsoleta o cuenta cerrada; se conserva el contrato
  del middleware. El controlador usa `AUTH_REQUIRED` en comprobaciones adicionales.
- 404 `CUSTOMER_NOT_FOUND`: registro inexistente o de otro propietario, con la
  misma respuesta para detalle y mutaciones.
- 405 `CUSTOMER_DELETION_NOT_ALLOWED`: no existe eliminación física por API,
  tampoco para clientes sin historial. No se revela existencia al intentar DELETE.
- 500 `CUSTOMER_OPERATION_FAILED`: error genérico sin detalles de base ni datos
  personales. El módulo no registra cuerpos, teléfonos, correos ni errores internos.

## Persistencia, seguridad y migración pendiente

Todas las consultas y mutaciones incluyen `ownerId`. Las escrituras bloquean el
usuario activo con `FOR SHARE` dentro de la transacción para coordinarse con el
cierre de cuenta. Crear y actualizar usan listas explícitas de campos editables.
La relación a User tiene `ON DELETE RESTRICT` y no borra clientes en cascada.
La clave única `(id, ownerId)` queda disponible para futuras relaciones compuestas;
todavía no se añadió ninguna relación a pedidos/ventas/servicios. No se incorpora
un método de borrado al repositorio. Esto protege el acceso por la aplicación;
no pretende impedir SQL administrativo directo contra una tabla aún sin historial.

Pendiente de revisión/aplicación manual:
`prisma/migrations/20261121000000_customers/migration.sql`. Se generó exclusivamente
comparando el schema anterior de Git con el nuevo mediante:

```text
prisma migrate diff --from-schema-datamodel prisma/customers-before.tmp.prisma --to-schema-datamodel prisma/schema.prisma --script --output prisma/migrations/20261121000000_customers/migration.sql
```

El archivo temporal se eliminó. No se usó datasource, URL, shadow database ni
conexión para generar el SQL. Crea únicamente tabla, tres índices (incluida la
clave compuesta) y FK del módulo; no modifica datos ni tablas existentes.
Las restricciones de formato están en Zod; SQL agrega tipos, longitudes, NOT NULL,
PK, índices y FK. No se editaron migraciones anteriores. Se regeneró únicamente
el cliente Prisma local para compilar; no se ejecutó `migrate dev`, `deploy`,
`db push`, `db execute` ni ninguna migración contra una base.

Aplicar y comprobar la migración antes de publicar el backend que la necesita,
siguiendo el procedimiento del proyecto. La versión anterior sigue funcionando
con la tabla adicional. Ante rollback de código, conservar la tabla y sus datos;
no eliminarla si ya recibió clientes. No hay backfill, variables ni dependencias
nuevas. No requiere frontend para comprobar contratos por HTTP.

## Verificación y límites

`src/routes/customer.routes.test.ts` recorre esquemas, controlador, servicio,
repositorio, rutas y autenticación JWT real con usuarios y persistencia simulados.
Los dobles rechazan accesos sin propietario y cualquier intento de borrado.
Incluye normalización, entradas inválidas, aislamiento, búsquedas, paginación,
actualización, archivado/reactivación, duplicados, autorización y errores genéricos.
`app.test.ts` comprueba además el montaje y la protección en la aplicación real.
Estos tests no certifican ejecución SQL, FK ni concurrencia en PostgreSQL.
La migración y los bloqueos requieren ensayo posterior en una base desechable.

Verificación local del 21 de noviembre de 2026: 12 pruebas específicas y 280
pruebas backend completas aprobadas; tests y builds de ambos paquetes correctos.
Prisma Client generado y schema validado sin conexión a una base. Lint frontend
sin errores, con cuatro advertencias previas de `img`; no hay scripts de lint
backend ni de typecheck separados (los builds ejecutan TypeScript).

Se registraron las nuevas operaciones y esquemas en el generador OpenAPI. Tras
generar se conservaron en `openapi.json` los esquemas anteriores ajenos a clientes:
ya existían diferencias entre esos esquemas versionados y su generación actual.
Su sincronización global es un hallazgo separado, fuera de esta fase; ejecutar
una regeneración global volverá a mostrar esas diferencias. No se cambiaron los
contratos de entrada ni los flujos públicos existentes.

Antes de asociar clientes a historial hay que acordar:

- Relación compuesta por propietario y reglas de archivo/borrado `RESTRICT` de
  cada consumidor; no confiar solo en un ID recibido del cliente.
- Conservar snapshots de nombre/contacto en documentos históricos frente a
  futuras ediciones del cliente; asociar un cliente no debe reescribirlos.
- País/prefijos del teléfono, fusión de duplicados y tratamiento de clientes
  archivados al crear nuevas operaciones.
- Política de retención y anonimización de datos personales, incluidos clientes
  de cuentas cerradas. El cierre actual conserva User y no borra esta tabla;
  el acceso queda revocado, pero no se implementó limpieza de esos datos.
- Control de edición concurrente (PATCH conserva campos omitidos; dos cambios
  del mismo campo usan la última escritura) e idempotencia de altas ante reintentos.
  Esta fase admite duplicados deliberadamente y no promete creación única.
