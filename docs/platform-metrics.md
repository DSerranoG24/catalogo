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

La elección inicial de los dos índices simples fue razonada, sin un destino aislado confirmado. La verificación local posterior descrita abajo sí ejecutó EXPLAIN (ANALYZE, BUFFERS), sin leer el .env real ni consultar producción. La creación normal de índices puede bloquear escrituras durante su ejecución: revisar volumen y ventana de despliegue antes de aplicar el archivo. Si el plan exige creación concurrente, preparar esa operación por separado de una transacción explícita, sin modificar una migración ya aplicada.

## Interfaz y fallos

`/admin` conserva el guardia de servidor y el 404 neutro antes de renderizar. El panel solicita agregados por el proxy autenticado y valida sus tipos. Usa Inter y tokens existentes, tarjetas, una tabla diaria accesible y barras SVG con la tabla como alternativa textual. Muestra el criterio de inclusión de ADMIN, zona, hoy parcial, fecha de corte, publicación por cohortes, repetición histórica y limitaciones de confirmaciones. Visitas permanece sin instrumentación.

La carga inicial y la actualización manual son explícitas; no hay polling. Un error no se convierte en ceros: si existe una respuesta anterior se conserva su fecha y aparece el error con reintento. Un 401/404 borra datos del panel y refresca el guardia de servidor. Los ceros de una respuesta exitosa representan filas ausentes de la base, no errores ocultos.

## Pruebas y despliegue

### Verificador PostgreSQL local

Desde la raíz, ejecutar en una terminal PowerShell interactiva:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\catalog-api\scripts\verify-platform-metrics-postgres.ps1
```

`RemoteSigned` se limita a ese proceso; no cambia la política permanente del equipo. Primero ejecuta el build y después pide la URI con `Read-Host -AsSecureString`: no pegarla en el comando ni en el chat. No se lee ni modifica `.env`. Solo admite PostgreSQL en `localhost`, `127.0.0.1` o `::1`, base exacta `catalogo_test`, sin opciones de conexión arbitrarias. Comprueba además resolución DNS y `current_database()`/`inet_server_addr()`. No utilizar túneles ni proxies hacia bases remotas: loopback por sí solo no acredita el destino de un túnel.

Requiere PostgreSQL local ya disponible, dependencias existentes instaladas, cliente Prisma generado y un usuario local con permisos de crear/eliminar su propio esquema y aplicar sus migraciones. No crea ni borra la base. No necesita Supabase, Storage, claves de correo ni claves JWT reales.

El verificador crea un esquema aleatorio `metrics_verify_<uuid>` dentro de `catalogo_test`. Copia los archivos de migración a un directorio temporal y usa Prisma Migrate real: aplica las primeras quince, inserta pedidos anteriores y aplica la decimosexta. Verifica historial, índices válidos y NULL de todos los pedidos anteriores. El esquema público y su historial no cambian. La migración permanece aplicada únicamente dentro del esquema temporal hasta su limpieza.

Ejecuta `changeOrderStatus` real, repetición de confirmación, cancelación y ocho confirmaciones concurrentes. Un trigger de auditoría exclusivo del esquema cuenta las escrituras efectivas de `firstConfirmedAt` y compara la fecha con `CURRENT_TIMESTAMP` de la transacción PostgreSQL (tolerancia de 1 ms por conversión Date/timestamp(3)). Prueba los treinta días, huecos, porcentajes null y semanas de Bogotá: lunes 29/12/2025, domingo 04/01/2026 y lunes 05/01/2026, con órdenes en los dos lados de las 05:00 UTC. Un vendedor tiene dos semanas distintas y otro solo una; comprueba que la repetición es 1 de 2. Los null de porcentajes se presentan como «Sin base» por la interfaz existente.

Levanta el router HTTP real en puerto aleatorio de loopback con autenticación, consulta de rol y agregaciones contra el esquema real; verifica 401 sin sesión, 200 de administrador, no-store y ausencia de campos/valores personales canario. Todos los datos y JWT usados son sintéticos y no se imprimen. No se inicia el servidor completo ni ningún transporte de correo.

Después elimina sus fixtures funcionales e inserta por defecto 1.000 cuentas, 1.000 catálogos, 50.000 productos y 100.000 pedidos distribuidos en 365 días y cuatro estados. Ejecuta ANALYZE en sus cuatro tablas y `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` sobre la consulta completa de agregación, dos veces, con el mismo corte. El primer pase no garantiza caché fría. Finalmente verifica que la consulta real también cumple sus timeouts habituales. Para otro volumen sintético:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\catalog-api\scripts\verify-platform-metrics-postgres.ps1 -Accounts 2000 -Orders 200000
```

El JSON completo se imprime y se guarda en `catalog-api/platform-metrics-postgres-results.json` (ignorado por Git), con checks, etapa fallida si la hubiera y planes completos, sin URI, claves, tokens ni errores crudos. Los planes permiten inspeccionar Planning/Execution Time, nodos, filas, loops y buffers. No se añaden índices adicionales. El workload uniforme sirve de referencia reproducible, no demuestra la distribución real ni sustituye medir otros sesgos o volúmenes.

Un `finally` elimina solo el esquema exacto generado y su directorio temporal. No hay TRUNCATE/DELETE/DROP sobre datos ajenos. Si se interrumpe a la fuerza el proceso o falla la limpieza, el JSON indica el esquema propio para revisarlo manualmente; no eliminar otros esquemas. Nunca ejecutar el verificador contra Supabase. Las pruebas automáticas del verificador rechazan destinos remotos, otra base y parámetros peligrosos antes de conectarse.

### Ejecución real local del 25 de octubre de 2026

Resultado `success: true`, catorce comprobaciones aprobadas y `cleanup: true`. Historial de quince migraciones seguido de dieciséis; columna ausente antes, NULL en los tres pedidos anteriores después. Ocho confirmaciones concurrentes produjeron un ganador y una sola escritura, comparada con el reloj de PostgreSQL. Pasaron también índices, reconfirmación, cancelación, serie de treinta días con ceros, denominadores null, semanas de Bogotá cruzando año y repetición 1 de 2. El endpoint HTTP real devolvió agregados sin los campos ni valores personales canario.

Prisma Migrate se ejecuta desde el directorio temporal: `--schema` por sí solo no evita que el `prisma.config.ts` del repositorio fuerce su carpeta de migraciones. La comprobación de historial detectó ese problema en el primer intento; se corrigió el aislamiento antes de la ejecución final. La auditoría de reloj convierte explícitamente CURRENT_TIMESTAMP a UTC antes de comparar timestamps sin zona.

El informe completo local está en `catalog-api/platform-metrics-postgres-results.json`, fuera de Git. Workload: 1.000 cuentas, 1.000 catálogos, 50.000 productos y 100.000 pedidos. Plan de la consulta completa:

| Pase | Planning Time | Execution Time | Shared Hit Blocks | Shared Read Blocks | Temp Read/Written Blocks |
|---|---:|---:|---:|---:|---:|
| Primero | 12,054 ms | 728,897 ms | 24.880 | 0 | 0 / 0 |
| Repetición | 3,860 ms | 704,497 ms | 24.880 | 0 | 0 / 0 |

La serie de cuentas utilizó Index Only Scan de users_createdAt_idx; la de pedidos, Bitmap Index/Heap Scan de orders_createdAt_idx. Los totales históricos leyeron secuencialmente orders; la repetición empleó Hash Join y agregación. El mayor coste fue el agregado de cohortes (aprox. 435–449 ms): Nested Loop, Memoize y Bitmap Scan por createdAt, con tres iteraciones. La consulta real con el timeout normal de 2.500 ms también pasó.

No se añadieron índices. Estos planes no aportan una justificación para orders(catalogId, createdAt); si el volumen aumenta, primero medir el agregado de cohortes y otras distribuciones. Los dos pases encontraron todos los bloques en caché: no acreditan rendimiento con caché fría ni bajo carga concurrente real.

Las pruebas de unidad/HTTP usan dobles: denegación 401/404 antes de agregar, parámetros rechazados, porcentajes null, treinta días incluyendo huecos y medianoche Bogotá, diferencias entre confirmado actual y conocido, respuesta sin PII, confirmación única/reintento/cancelación y rollback completo. No acreditan ejecución de este SQL en PostgreSQL ni un plan de rendimiento real. Las pruebas de navegador usan el build Next real y una API local simulada para carga, tablas, errores, reintento, actualización manual y revocación.

Orden: revisar y validar en entorno aislado → respaldo y aplicación manual autorizada de migración → generar Prisma/build y desplegar API → frontend. No aplicar la migración desde el arranque. No desplegar esta API sobre esquema anterior. El esquema es aditivo; conservar campo/índices al volver a un binario anterior, pero ese binario dejaría de registrar fechas nuevas y generaría un hueco de cobertura que debe declararse. Solo se aplicaron migraciones dentro del esquema temporal de catalogo_test, posteriormente eliminado. No se enviaron correos ni se accedió a Supabase.
