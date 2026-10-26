# Métricas agregadas de Vitrinaya

## Acceso y respuesta

`GET /api/admin/metrics` utiliza el router `authenticate → requireAdmin`: 401 sin sesión, 404 para no administradores, 200 para administrador y 503 genérico si no puede calcular. No admite query parameters: 400 si se reciben. `Cache-Control: no-store`. No utiliza el listado privado de pedidos (que devuelve datos personales y solo cien pedidos).

La respuesta contiene `{ success: true, metrics }`. Sus datos son cantidades, porcentajes y fechas; los únicos metadatos estáticos son `timeZone: America/Bogota` e `includesAdmin: true`. Incluye todas las cuentas, también ADMIN, y nunca devuelve identificadores de cuenta/catálogo ni información de compradores. El SQL usa userId solo para agrupar internamente la repetición. La validación estricta rechaza campos inesperados antes de serializar.

## Tiempo y consistencia

El repositorio [admin-metrics.repository.ts](../catalog-api/src/repositories/admin-metrics.repository.ts) obtiene `asOf` de CURRENT_TIMESTAMP dentro de una transacción Repeatable Read de solo lectura. Todas las consultas comparten snapshot y fecha de corte. `statement_timeout` es 2500 ms, la transacción tiene timeout 4000 ms y espera máxima de conexión de 1000 ms. No hay caché persistente, estimaciones de catálogo PostgreSQL ni polling.

Se interpretan los TIMESTAMP(3) existentes como UTC (convención de almacenamiento de la aplicación) y se agrupan explícitamente en America/Bogota. Últimos 7 días empieza a medianoche local de hoy menos seis días; 30 días, menos veintinueve. Los rangos llegan hasta asOf y hoy es parcial. La serie contiene exactamente treinta fechas ascendentes: el servicio completa con cero los días sin registros. No depende de la zona horaria del proceso. Antes de desplegar conviene comprobar esa convención temporal en el entorno aislado de validación; no se ha consultado la configuración remota.

## Definición técnica de cada dato

| Campo | Consulta exacta / significado |
|---|---|
| accounts.total | COUNT de users conservados, sin excluir ADMIN |
| accounts.last7Days / last30Days | COUNT de users con createdAt entre el inicio del periodo y asOf |
| accounts.active | COUNT de users para los que EXISTS un catálogo propio JOIN products por catalogId; cualquier producto existente, aunque esté inactivo o el catálogo archivado |
| accounts.activePercent | 100 × active / total |
| catalogs.published | COUNT de catalogs con active=true, archivedAt IS NULL y EXISTS products del catálogo con active=true; no exige stock |
| catalogs.last7Days / last30Days | Mismo predicado de publicación actual, filtrando además createdAt del catálogo; «creados en el periodo que siguen publicados», no eventos de publicación |
| orders.total | COUNT de orders conservados, todos los estados, incluidos CANCELLED |
| orders.last7Days / last30Days | Mismo COUNT con createdAt en el periodo |
| repeat.withOrders | Número de grupos catalog.userId tras unir orders con catalogs |
| repeat.repeating | Grupos cuya primera y última creación de pedido caen en semanas locales diferentes; date_trunc('week', fecha local), lunes a domingo, con año implícito en la fecha |
| repeat.percent | 100 × repeating / withOrders; repetición histórica acumulada, sin exigir semanas consecutivas ni recientes |
| accounts.unverified | COUNT de users con emailVerifiedAt IS NULL |
| accounts.unverifiedPercent | 100 × unverified / total |
| daily | COUNT diario local de users.createdAt y orders.createdAt para treinta días, uniendo ambas series y completando huecos en el servicio |
| visits.last7Days / last30Days | null: «Sin instrumentación». No equivale a cero ni interviene en una conversión |

Todos los porcentajes con denominador cero son null, representados como «Sin base». Se redondean a dos decimales. Los totales son de registros conservados: no reconstruyen cuentas/productos borrados ni actividad que nunca se persistió.

## Embudo y confirmaciones

`funnel.allTime`, `last7Days` y `last30Days` son cohortes por creación del pedido, no por fecha de cambio de estado. En cada cohorte:

| Campo | Consulta |
|---|---|
| initiated | COUNT de todos los pedidos creados hasta asOf, incluidos cancelados; no son carritos abiertos |
| pending | COUNT con estado actual PENDING |
| confirmedCurrent | COUNT con estado actual CONFIRMED o COMPLETED |
| confirmedCurrentPercent | 100 × confirmedCurrent / initiated; nunca se divide entre pendientes |
| confirmedDated | COUNT con firstConfirmedAt no nulo y <= asOf, incluso si posteriormente se canceló |
| confirmedKnown | COUNT con fecha registrada <= asOf, o sin fecha pero estado actual CONFIRMED/COMPLETED |
| confirmedKnownPercent | 100 × confirmedKnown / initiated |
| legacyCancelledUnknown | COUNT de CANCELLED con firstConfirmedAt nulo; no permite afirmar si pasó por CONFIRMED |

La fecha registrada tiene prioridad sobre el respaldo por estado actual. La proporción conocida puede ser solo un mínimo mientras existan cancelados sin historia conocida. No hay backfill ni fecha de inicio de cobertura inventada. La interfaz advierte que las fechas se registran desde este despliegue; los pedidos confirmados anteriormente conservan null. Un cancelado nulo tampoco prueba que hubiera estado confirmado.

## Escritura única de firstConfirmedAt

La migración [20261025200000_platform_metrics](../catalog-api/prisma/migrations/20261025200000_platform_metrics/migration.sql) añade Order.firstConfirmedAt nullable, sin modificar filas históricas. La transición usa una transacción: primero UPDATE con id, propietario y estado anterior esperados. Solo si cambia exactamente una fila de PENDING a CONFIRMED obtiene la hora de PostgreSQL y escribe la fecha mediante UPDATE con firstConfirmedAt IS NULL y el mismo propietario. El primer UPDATE mantiene bloqueada la fila hasta el commit: las operaciones concurrentes esperan y revalidan el estado. Ambas escrituras se confirman o revierten juntas.

Reintentar con el estado anterior ya cambiado no actualiza filas; confirmar un ya confirmado está rechazado por las reglas existentes y tampoco se estampa desde el repositorio para una transición CONFIRMED→CONFIRMED. Cancelar o completar solo cambia status: no borra ni sobreescribe la fecha. El rol ADMIN no evita los filtros de propietario del cambio de estado.

## Índices y medición pendiente

La migración crea users(createdAt) y orders(createdAt), para los rangos y series recientes. No hacen constante un COUNT histórico completo. No añade orders(catalogId, createdAt): ya hay índice de catalogId y no se ha medido que el compuesto aporte al agrupamiento histórico global. No añade índices a estados de cuenta o publicación preventivamente.

No hubo un destino aislado confirmado para ejecutar EXPLAIN (ANALYZE, BUFFERS); no se leyó el .env real ni se consultó producción. La elección de los dos índices simples es razonada, NO un benchmark. Queda pendiente medir con datos representativos en un entorno aislado antes de aplicar. La creación normal de índices puede bloquear escrituras durante su ejecución: revisar volumen y ventana de despliegue antes de aplicar el archivo. Si el plan exige creación concurrente, preparar esa operación por separado de una transacción explícita, sin modificar una migración ya aplicada.

## Interfaz y fallos

`/admin` conserva el guardia de servidor y el 404 neutro antes de renderizar. El panel solicita agregados por el proxy autenticado y valida sus tipos. Usa Inter y tokens existentes, tarjetas, una tabla diaria accesible y barras SVG con la tabla como alternativa textual. Muestra el criterio de inclusión de ADMIN, zona, hoy parcial, fecha de corte, publicación por cohortes, repetición histórica y limitaciones de confirmaciones. Visitas permanece sin instrumentación.

La carga inicial y la actualización manual son explícitas; no hay polling. Un error no se convierte en ceros: si existe una respuesta anterior se conserva su fecha y aparece el error con reintento. Un 401/404 borra datos del panel y refresca el guardia de servidor. Los ceros de una respuesta exitosa representan filas ausentes de la base, no errores ocultos.

## Pruebas y despliegue

Las pruebas de unidad/HTTP usan dobles: denegación 401/404 antes de agregar, parámetros rechazados, porcentajes null, treinta días incluyendo huecos y medianoche Bogotá, diferencias entre confirmado actual y conocido, respuesta sin PII, confirmación única/reintento/cancelación y rollback completo. No acreditan ejecución de este SQL en PostgreSQL ni un plan de rendimiento real. Las pruebas de navegador usan el build Next real y una API local simulada para carga, tablas, errores, reintento, actualización manual y revocación.

Orden: revisar y validar en entorno aislado → respaldo y aplicación manual autorizada de migración → generar Prisma/build y desplegar API → frontend. No aplicar la migración desde el arranque. No desplegar esta API sobre esquema anterior. El esquema es aditivo; conservar campo/índices al volver a un binario anterior, pero ese binario dejaría de registrar fechas nuevas y generaría un hueco de cobertura que debe declararse. No se aplicó ninguna migración ni se enviaron correos durante este bloque.
