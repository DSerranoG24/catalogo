# Rol de administración

## Alcance

`User.role` es el enum `USER | ADMIN`, con `USER` obligatorio por defecto. La migración [20261025190000_user_role](../catalog-api/prisma/migrations/20261025190000_user_role/migration.sql) es aditiva: todas las cuentas existentes quedan como USER. No promueve correos ni identidades Google. El primer administrador se asigna manualmente por UUID; no hay endpoint de promoción, métricas, gestión de vendedores ni panel funcional en este bloque.

ADMIN no elimina los filtros de propietario en rutas de vendedor. Los repositorios de catálogos, productos, categorías y pedidos conservan su alcance por usuario. Crear cuentas locales o Google siempre escribe USER mediante campos explícitos: atributos adicionales role/isAdmin no se pasan a Prisma como permisos del cliente. No existe endpoint para modificar el rol.

## Contrato y autorización

El bloque posterior de [métricas de plataforma](platform-metrics.md) añade únicamente agregados sobre esta protección; no incorpora gestión de cuentas ni permisos por vendedor.

Todo `/api/admin/*` pasa por `authenticate` y después `requireAdmin`, también para métodos o subrutas desconocidos. El primero verifica la firma, caducidad y sessionVersion del JWT. El segundo consulta únicamente `role` en PostgreSQL usando el id autenticado. Ignora rol del JWT, cuerpo, query y cabeceras del cliente. No almacena el rol en JWT, cookie ni localStorage.

| GET /api/admin/access | Resultado |
|---|---|
| Sesión ausente, inválida o revocada | 401 |
| Usuario autenticado USER o usuario ya inexistente al consultar rol | 404 con `{ success: false, error: "ROUTE_NOT_FOUND" }` |
| ADMIN | 200 con `{ success: true }` |
| Fallo al consultar el rol | 503 genérico; nunca continúa al handler |

Todas las respuestas del router llevan `Cache-Control: no-store`. Rutas desconocidas devuelven 404 incluso para ADMIN. Una degradación se observa en la siguiente petición aunque se reutilice el mismo JWT. No cancela operaciones ya autorizadas en curso ni borra información previamente entregada.

## Frontend

`/admin` está separado del layout cliente del vendedor. No se publica ningún enlace hacia él en la landing o dashboard. El helper server-only lee la cookie HttpOnly y consulta `/api/admin/access` con `CATALOG_API_URL`, timeout de seis segundos, HTTPS en producción, redirect error y cache no-store. No utiliza metadata de localStorage ni expone el JWT al navegador.

El helper exige un 2xx con JSON `{ success: true }`; ausencia de cookie, 401/404/503, respuesta inválida y errores de red terminan en notFound. La página y su metadata llaman al helper; React cache solo deduplica esas llamadas dentro de un mismo render, no mantiene decisiones entre peticiones.

La configuración existente `htmlLimitedBots: /.*/` bloquea la metadata antes de transmitir HTML para todos los user agents. Comprobar acceso desde generateMetadata evita comenzar una respuesta 200 antes del notFound. La entrada no debe añadir un loading/Suspense por delante de esa decisión sin volver a probar el estado HTTP. La respuesta denegada usa texto neutro: «Página no disponible», sin título ni contenido administrativo; noindex y no-store. La entrada autorizada contiene únicamente una confirmación de acceso y regreso a los catálogos propios.

Toda futura página administrativa debe ejecutar el helper antes de leer datos y cada endpoint debe conservar el middleware: un layout puede reutilizarse durante navegación cliente y no sustituye la autorización por petición. El 404 reduce divulgación de detalles; no promete que la existencia técnica de la URL sea secreta.

## Primer administrador: SQL manual

Comando completo en [sql/promote-first-admin.sql](sql/promote-first-admin.sql). Sustituir únicamente el placeholder del UUID después de comprobar a quién pertenece. No contiene un correo operativo ni un identificador supuesto.

El caso correcto es **cero administradores previos y exactamente una cuenta USER coincidente**. El script NO rechaza la ausencia de administrador: es la condición necesaria para crear el primero. Rechaza si ya existe un ADMIN o si el UPDATE no modifica exactamente una fila. La clave primaria impide varias coincidencias por id. El bloqueo de tabla serializa dos intentos manuales simultáneos. Una excepción aborta la transacción y no deja una promoción parcial; tras un fallo el operador debe ejecutar ROLLBACK si la sesión quedó en una transacción abortada.

Recomendar correo verificado y credenciales robustas para esa cuenta, sin añadir requisitos nuevos al middleware. No se ha ejecutado el comando ni se ha promovido ninguna cuenta. Las futuras altas/bajas de administradores requieren otro procedimiento autorizado; este script se limita al primero.

## Despliegue y comprobación

Orden: revisar/resguardar destino autorizado → aplicar migración por separado → generar cliente Prisma y desplegar API → desplegar frontend → asignar primer administrador mediante SQL manual. No desplegar la API dependiente antes del esquema. Para rollback, conservar el enum/columna aditivos; no eliminar datos. No autorizar una operación administrativa con una API anterior que no aplique el control de rol.

Pruebas: acceso USER/ADMIN, JWT sin sesión, claims/cabeceras/query/cuerpo falsificados, degradación con el mismo JWT, fallo de base denegado, creación local/Google forzada a USER y respuestas sin caché. Navegador/HTTP contra build real de Next y API local simulada comprueba 404 para anónimo/vendedor, normal y bot, backend fallido, mismo cookie tras degradación y localStorage falsificado; 200 para ADMIN. Los dobles no acreditan migración ni concurrencia de PostgreSQL real. Validar el SQL y su operación en una base aislada tras la aplicación manual autorizada.
