# Procedimiento seguro para migraciones

## Estado del repositorio

El historial versionado contiene 13 migraciones y cinco CHECK SQL. No es una consulta al ledger remoto. Prisma recibe DATABASE_URL del proceso y puede cargar el archivo local como respaldo: confirmar siempre el destino sin imprimir credenciales.

Las comunicaciones de despliegue y comprobaciones anteriores están en el [historial](historial/README.md); no sustituyen una verificación nueva. No hay una segunda historia de migraciones Supabase versionada en este repositorio.

## Consistencia entre migraciones y schema.prisma

Hay cinco restricciones CHECK SQL que no están declaradas en `schema.prisma`: `products_promotion_valid_check`, `product_reviews_rating_check`, `product_reviews_comment_length_check`, `catalogs_quotationCounter_check` y `orders_quotationNumber_check`. Las dos últimas llegaron con cotizaciones. Se mantienen en sus migraciones SQL: el proyecto usa Prisma ORM 6 y estas CHECK no están representadas por PSL ([guía de Prisma v6 sobre CHECK](https://www.prisma.io/docs/orm/v6/more/troubleshooting/check-constraints)). Una reconstrucción basada solo en el modelo las perdería; deben inspeccionarse y preservarse en reconstrucciones o baseline. No modificar migraciones aplicadas. Una inspección estática no certifica el esquema remoto ni la reproducción completa en una base vacía.

## Orden del despliegue

La migración se aplica ANTES de empujar el código que la necesita, porque un push a main puede disparar un despliegue automático. `render.yaml` define `npm start` y no incluye migraciones en build/arranque, pero eso NO garantiza la configuración efectiva de un servicio existente en Render. Hay que comprobar también el panel y el comando que aparece en los logs. No hay un script de release adicional ni un pre-deploy configurado en el repositorio.

Este procedimiento lo ejecuta manualmente un único responsable autorizado; no se ejecuta como parte de las pruebas ni desde cada instancia:

1. Preparar y revisar localmente el código y los SQL de la versión exacta que se desplegará. Probarlos en una base aislada. Confirmar que el esquema nuevo es compatible con el código que sigue atendiendo producción; si no lo es, detenerse y diseñar una migración por etapas antes de continuar.
2. Confirmar el destino y obtener un respaldo restaurable siguiendo [Respaldo previo](#respaldo-previo). Este cambio de configuración no modifica la base y no requiere un respaldo por sí mismo; las futuras migraciones sí requieren evaluar y respaldar los datos existentes.
3. Abrir una PowerShell dedicada en `catalog-api`. Un operador autorizado debe proporcionar `DATABASE_URL` únicamente al proceso mediante un mecanismo seguro, sin imprimirla, guardarla en archivos ni editar `.env`. Confirmar host y proyecto mediante el panel y el gestor seguro antes de ejecutar Prisma; no confiar en el destino implícito de `.env`.
4. Ejecutar los comandos siguientes uno por uno. Comprobar `$LASTEXITCODE` inmediatamente después de cada comando; ante cualquier valor distinto de cero, detener el procedimiento. El primer `status` puede indicar migraciones pendientes: revisarlas y autorizar su aplicación antes de continuar, sin tratar ese resultado como permiso automático para migrar.

   ```powershell
   npm.cmd exec prisma -- migrate status
   npm.cmd run prisma:migrate:deploy
   npm.cmd exec prisma -- migrate status
   ```

   `prisma:migrate:deploy` aplica todas las migraciones pendientes del directorio versionado. No usar `prisma:migrate` (`migrate dev`), `db push` ni `migrate reset` contra producción. No ejecutar dos releases en paralelo, aunque Prisma tenga un bloqueo de protección.
5. Exigir salida correcta de `migrate deploy` y del `status` posterior, sin pendientes ni fallidas. Revisar el ledger con la consulta de [Consultas y comprobaciones manuales previas](#consultas-y-comprobaciones-manuales-previas): las migraciones esperadas deben tener `finished_at` y no `rolled_back_at`. Verificar también las columnas, índices y constraints que introduce la versión; `status` no sustituye esa inspección. Para el estado de archivado actual, comprobar `catalogs.archivedAt` y la FK de pedidos a catálogos con `ON DELETE RESTRICT`.
6. Solo después de verificar, empujar el código de esa misma versión y permitir el despliegue. Comprobar después `/api/health` y los flujos afectados. Retirar `DATABASE_URL` de la terminal dedicada con `Remove-Item Env:DATABASE_URL` y cerrarla al terminar.

Si falla la migración o su verificación: NO empujar el código dependiente ni disparar su despliegue. Mantener la versión anterior si sigue siendo compatible; registrar únicamente el nombre de la migración y el error sin credenciales ni datos personales. Inspeccionar el ledger y los objetos afectados con el responsable de la base: un fallo puede haber dejado cambios parciales. No reintentar a ciegas, editar migraciones ya aplicadas ni usar `migrate resolve` para ocultar un fallo. Probar la recuperación en una copia aislada y acordar una corrección hacia adelante o una recuperación explícita; restaurar un respaldo puede perder escrituras posteriores. Si el esquema quedó aplicado pero falla el despliegue, tampoco se revierte automáticamente la base.

El health check `/api/health` ejecuta `SELECT 1`: verifica respuesta de la API y conexión a PostgreSQL, pero NO verifica migraciones aplicadas ni compatibilidad del esquema. Una respuesta saludable no autoriza a omitir los pasos anteriores.

El cambio local del YAML solo tendrá efecto cuando se incorpore a la configuración efectiva del servicio. Confirmar manualmente en Render que Start Command sea `npm start` y que no haya otro ejecutor de migraciones. Este bloque no cambia el panel ni realiza despliegues.

## Configuración de Render

Los valores exactos de Build, Start, Pre-Deploy y Root Directory, el alcance de Blueprint y la deteccion de despliegues fallidos viven en [despliegue](despliegue.md#render). No hay migraciones en build, pre-deploy ni arranque. El [incidente anterior](historial/2026-10-25-render.md) se conserva como historial, no como configuración vigente.

## Proxy de Render y limitación de solicitudes

La API establece `app.set("trust proxy", 1)` antes de los limitadores: confía en el salto inmediatamente anterior a Express, según la topología acordada de un proxy de Render. Con X-Forwarded-For, Express toma la dirección más cercana a la aplicación, leyendo la cadena de derecha a izquierda; no acepta sin límite las direcciones que un cliente anteponga. No se usa `true`, no se desactivan validaciones y no se inventan rangos de IP de Render.

Esto requiere que todo el tráfico público pase por ese proxy y que este mantenga correctamente las cabeceras. Si cambian los caminos o el número de saltos, hay que reevaluarlo; no aumentar el valor a ciegas. Sin X-Forwarded-For se usa la dirección del socket. Con IP inválida, puerto añadido o socket sin dirección todavía puede registrarse una validación. Express no interpreta Forwarded (RFC 7239) como sustituto automático de X-Forwarded-For.

El proxy same-origin de Next solo reenvía Content-Type, Accept y Authorization. Por tanto, para solicitudes que pasan por Next, la dirección identificada por la API es la del servidor de Next/Vercel que conecta con Render, NO necesariamente la del navegador. Los límites global y de login pueden agrupar esos usuarios. El limitador adicional de importación se basa en usuario autenticado y catálogo, no en IP, pero sigue sujeto al límite global. No se cambia esa arquitectura ni se añade reenvío de cabeceras no verificadas en esta corrección.

La versión instalada de express-rate-limit registra los errores de validación y captura esa excepción internamente. La reproducción local con trust proxy=false y X-Forwarded-For generó ERR_ERL_UNEXPECTED_X_FORWARDED_FOR pero respondió HTTP 200. Corregir la configuración es necesario; atribuir una conexión rota/502 exclusivamente a ese mensaje requiere más evidencia del fallo de la petición efectiva. El health check saludable tampoco demuestra que login y demás rutas funcionen.

## Respaldo previo

Antes de una migración de producción:

1. En Supabase Dashboard, abre **Database → Backups** y confirma que hay un respaldo utilizable y cuál es su fecha. La disponibilidad y el tipo (lógico, físico o PITR) dependen del proyecto/plan; no des por hecho que hay uno.
2. Descarga el respaldo disponible o crea un respaldo lógico con la CLI de Supabase. Con `SUPABASE_DB_URL` proporcionada de forma segura al proceso (no escrita en Git ni mostrada en logs), los comandos documentados son:

   ```powershell
   # Requiere Supabase CLI y Docker; no se instalaron durante esta auditoría.
   supabase db dump --db-url $env:SUPABASE_DB_URL -f roles.sql --role-only
   supabase db dump --db-url $env:SUPABASE_DB_URL -f schema.sql
   supabase db dump --db-url $env:SUPABASE_DB_URL -f data.sql --use-copy --data-only -x "storage.buckets_vectors" -x "storage.vector_indexes"
   ```

   Protege la cadena de conexión y los archivos porque contienen información sensible. Para un respaldo completo, conserva también roles/configuración requeridos por el proyecto.
3. Comprueba tamaño y fecha de los artefactos, guárdalos fuera del repositorio y realiza una restauración de ensayo en un proyecto Supabase desechable o entorno aislado. Un archivo creado sin prueba de restauración no es una recuperación verificada.
4. No restaures sobre producción como mecanismo de rollback sin evaluar pérdida de datos posteriores al respaldo. Para volver atrás ante un fallo de esquema, prefiere una corrección hacia adelante cuando sea viable.

Referencias oficiales: [respaldo y restauración con CLI](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore) y [restauración de respaldos del Dashboard](https://supabase.com/docs/guides/platform/migrating-within-supabase/dashboard-restore).

## Cómo verificar antes de aplicar

Todo este procedimiento es manual y debe ejecutarse solo sobre una base vacía/desechable de prueba. No pegues una URL de producción, no edites `catalog-api/.env`, no ejecutes `migrate reset` y no compartas cadenas de conexión. La URL debe sustituirse en una variable de entorno solo para la terminal de prueba; Prisma y el API reciben la variable del proceso por encima del valor cargado desde `.env`.

### Opción A: proyecto Supabase de prueba (plan Free)

1. Entra al [Dashboard de Supabase](https://supabase.com/dashboard), crea un proyecto nuevo separado del proyecto real y selecciona el plan Free si se ofrece para esa organización. Ponle un nombre inequívoco, por ejemplo `catalogo-verificacion`, elige región, genera una contraseña de base de datos única y guárdala en un gestor seguro. Espera a que el proyecto aparezca activo. El plan Free permite dos proyectos por organización; confirma el cupo disponible antes de crearlo ([planes y cuotas](https://supabase.com/docs/guides/platform/billing-on-supabase), [inicio de Supabase](https://supabase.com/docs/guides/platform)).
2. Desde el Dashboard del proyecto nuevo, copia el **Project ref** de la URL/Settings y abre **Connect** para obtener su URI de conexión. Usa Session pooler cuando la red no acepte la conexión directa. El nombre de usuario del pooler incluye `postgres.<PROJECT-REF>`; el destino se validará antes de exportar `DATABASE_URL`.
3. Abre una ventana PowerShell nueva dedicada a la prueba, ve a `catalog-api` y captura la URI de prueba sin eco. El bloque compara el host o usuario con el Project ref esperado y se detiene antes de ejecutar nada si no coincide. No guardes la URI en `.env` ni la escribas en la consola:

   ```powershell
   $expectedTestRef = Read-Host 'Project ref del proyecto DE PRUEBA'
   $secureTestUrl = Read-Host 'URI de conexión del proyecto DE PRUEBA (Connect)' -AsSecureString
   $testDatabaseUrl = [System.Net.NetworkCredential]::new('', $secureTestUrl).Password
   $testUri = [uri]$testDatabaseUrl
   $testUser = [uri]::UnescapeDataString(($testUri.UserInfo -split ':', 2)[0])
   $isExpectedProject = ($testUri.Host -eq "db.$expectedTestRef.supabase.co") -or ($testUser -eq "postgres.$expectedTestRef")
   if (-not $isExpectedProject) {
     $testDatabaseUrl = $null
     throw 'El host/usuario no corresponde al Project ref de prueba. No se ejecutó Prisma.'
   }
   $env:DATABASE_URL = $testDatabaseUrl
   $testDatabaseUrl = $null
   $testUri = $null
   $secureTestUrl = $null
   $expectedTestRef = $null
   $testUser = $null
   ```

   Revisa el Project ref en el Dashboard antes de ingresarlo. Si Connect ofrece un formato distinto al URI PostgreSQL del proyecto, no adaptes el validador a ciegas: consulta el formato y confirma que la referencia sea la del proyecto de prueba. Para retirar la variable al finalizar: `Remove-Item Env:DATABASE_URL`.
4. En `catalog-api`, valida el esquema local sin conexión y aplica la cadena solo al proyecto de prueba recién creado:

   ```powershell
   npm.cmd exec prisma -- validate
   npm.cmd run prisma:migrate:deploy
   npm.cmd exec prisma -- migrate status
   ```

   Al ser una base vacía, es normal que `migrate deploy` aplique las migraciones del repositorio. Si muestra objetos ya existentes, detente y revisa que la referencia sea correcta; no uses `reset` ni `resolve` para forzar la prueba.
5. Conserva la base de prueba hasta terminar comparación, prueba funcional y ensayo de restauración. Esta opción prueba conectividad con Supabase/Pooler además de PostgreSQL; no es la base de producción.

### Opción B: PostgreSQL local en Windows

**Sin Docker:** instala PostgreSQL para Windows desde el instalador oficial y marca la instalación de `psql`/Command Line Tools. En una ventana PowerShell confirma que `psql --version` y `createdb --version` responden. Crea dos bases desechables (la segunda sirve de shadow DB para comparar migraciones):

```powershell
createdb -U postgres catalogo_test
createdb -U postgres catalogo_shadow
$env:DATABASE_URL = 'postgresql://postgres:<CLAVE_LOCAL>@127.0.0.1:5432/catalogo_test?schema=public'
$env:SHADOW_DATABASE_URL = 'postgresql://postgres:<CLAVE_LOCAL>@127.0.0.1:5432/catalogo_shadow?schema=public'
```

Reemplaza `<CLAVE_LOCAL>` por la contraseña del usuario PostgreSQL local; no uses credenciales de Supabase. No escribas la clave en un archivo versionado. Si `createdb` pide contraseña, usa la solicitada por el instalador o el administrador local. La URL debe señalar `127.0.0.1` y las bases `catalogo_test`/`catalogo_shadow`.

Si los ejecutables PostgreSQL no están en PATH, usa la ruta de instalación local verificada. El detalle de instalación del equipo anterior se conserva en el [historial de operación](historial/2026-10-24-operacion.md).

**Con Docker Desktop:** en PowerShell inicia un contenedor efímero sin volumen persistente, publicado en el puerto 5433 para reducir conflictos con un PostgreSQL instalado:

```powershell
docker run --rm --name catalogo-postgres-test -e POSTGRES_USER=postgres -e POSTGRES_PASSWORD=local_test_only -e POSTGRES_DB=catalogo_test -p 5433:5432 -d postgres:17
docker exec catalogo-postgres-test pg_isready -U postgres -d catalogo_test
```

Espera hasta que `pg_isready` informe que acepta conexiones; crea la segunda base y fija URLs locales:

```powershell
docker exec catalogo-postgres-test createdb -U postgres catalogo_shadow
$env:DATABASE_URL = 'postgresql://postgres:local_test_only@127.0.0.1:5433/catalogo_test?schema=public'
$env:SHADOW_DATABASE_URL = 'postgresql://postgres:local_test_only@127.0.0.1:5433/catalogo_shadow?schema=public'
```

La clave `local_test_only` es únicamente para este contenedor local desechable. No mapees el puerto públicamente. Detén solo este contenedor al concluir con `docker stop catalogo-postgres-test`; al ejecutarse con `--rm` y sin volumen, sus datos locales temporales se eliminan.

### Aplicar la cadena a la base de prueba y comparar el esquema

Desde `catalog-api`, y solo con `DATABASE_URL` verificada como prueba:

```powershell
npm.cmd exec prisma -- validate
npm.cmd run prisma:migrate:deploy
npm.cmd exec prisma -- migrate status
```

Para comparar el estado recreado por las migraciones con el modelo Prisma sin añadir dependencias, Prisma CLI v6 puede crear temporalmente la historia en la shadow DB y calcular la diferencia. Prisma requiere la shadow database al usar `--from-migrations` ([documentación](https://www.prisma.io/docs/orm/prisma-migrate/understanding-prisma-migrate/shadow-database)). `DATABASE_URL` debe señalar `catalogo_test`; `SHADOW_DATABASE_URL`, una base distinta y desechable (`catalogo_shadow`):

```powershell
npm.cmd exec prisma -- migrate diff --from-migrations prisma/migrations --to-schema-datamodel prisma/schema.prisma --shadow-database-url $env:SHADOW_DATABASE_URL --exit-code
```

Código de salida `0` significa sin diferencias detectables por Prisma; `2` indica diferencia; otros errores son fallo de ejecución/conexión. Nunca configures ambas variables con la misma base. Esta comparación no sustituye la inspección de restricciones no soportadas por PSL: verifica expresamente las cinco CHECK descritas arriba.

En el PostgreSQL de prueba (SQL Editor del proyecto de prueba o `psql` local), comprueba dichas constraints y la unicidad idempotente:

```sql
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname IN (
  'products_promotion_valid_check',
  'product_reviews_rating_check',
  'product_reviews_comment_length_check',
  'catalogs_quotationCounter_check',
  'orders_quotationNumber_check'
)
ORDER BY conname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'orders'
  AND indexname = 'orders_catalogId_idempotencyKey_key';
```

El índice esperado debe contener `("catalogId", "idempotencyKey")`; la columna permite `NULL` para órdenes históricas. Esta consulta es de solo lectura.

### Resultados históricos

El ensayo del 2026-10-23 esta en [historial de idempotencia](historial/2026-10-23-idempotencia.md), sin modificar sus cifras de diez migraciones, tres CHECK y 28/29 pruebas. El verificador actual incluye cotizaciones y requiere el esquema actual; aquel resultado no acredita su ejecución actual.

Para repetir la integración, [catalog-api/src/scripts/verify-order-idempotency-postgres.ts](../catalog-api/src/scripts/verify-order-idempotency-postgres.ts) solo admite `DATABASE_URL` con host loopback y base `/catalogo_test`; falla si el destino no cumple esas condiciones. Usa el API, Prisma y PostgreSQL existentes, sin dependencias nuevas. Con el esquema actual ya preparado en esa base aislada, ejecuta desde `catalog-api` la suite más esta verificación con:

```powershell
$env:DATABASE_URL = 'postgresql://postgres:<CLAVE_LOCAL_URL_ENCODED>@127.0.0.1:5432/catalogo_test?schema=public'
$env:CHECKPOINT_DISABLE = '1'
npm.cmd test -- src/scripts/verify-order-idempotency-postgres.ts
Remove-Item Env:DATABASE_URL, Env:CHECKPOINT_DISABLE
```

Si la contraseña contiene `#`, codifícalo como `%23` dentro de la URI. Mantén estas variables únicamente en la PowerShell dedicada a la verificación y no imprimas el valor de `DATABASE_URL`.

Para reconstruir desde una base vacía, conéctate a `postgres` en `127.0.0.1:5432` con `psql`, elimina solo la base local `catalogo_test` con confirmación explícita y créala de nuevo (`DROP DATABASE catalogo_test WITH (FORCE);` y luego `CREATE DATABASE catalogo_test;`). Hazlo solo si verificaste que host/puerto son loopback y el nombre es exactamente `catalogo_test`. Repite `migrate deploy`, `migrate status`, `migrate diff` y el test anterior. La shadow database debe ser distinta; Prisma la reinicia para reproducir la historia.

El ensayo de restauración puede repetirse contra una base local nueva con estos comandos; `-W` solicita la contraseña sin incluirla en los argumentos. El archivo de respaldo debe guardarse fuera del repositorio:

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\17\bin'
$runId = Get-Date -Format 'yyyyMMddHHmmss'
$backupPath = Join-Path $env:TEMP "catalogo-test-restore-$runId.dump"
$restoreDatabase = "catalogo_restore_test_$runId"
& (Join-Path $pgBin 'pg_dump.exe') -Fc -h 127.0.0.1 -p 5432 -U postgres -d catalogo_test -W -f $backupPath
& (Join-Path $pgBin 'createdb.exe') -h 127.0.0.1 -p 5432 -U postgres -W $restoreDatabase
& (Join-Path $pgBin 'pg_restore.exe') --exit-on-error -h 127.0.0.1 -p 5432 -U postgres -W -d $restoreDatabase $backupPath
```

No traslades a producción la URL local, la clave local ni los datos de prueba. Esta prueba valida migraciones, restauración lógica de la base local vacía y concurrencia en PostgreSQL 17 local; no confirma que el esquema ni el historial remoto sean iguales ni reemplaza un ensayo restaurando un backup real de Supabase.

### Probar concurrencia real de idempotencia

La prueba unitaria con almacén falso verifica la recuperación de un conflicto `P2002`; no prueba el comportamiento de PostgreSQL. La verificación real requiere aplicar la migración y hacer POST al API local apuntado a la base de prueba.

1. En Prisma Studio (`npm.cmd run prisma:studio`) conectado a la base de prueba, crea un usuario de prueba, un catálogo activo y un producto activo con precio. Guarda el `publicId` del catálogo y el ID UUID del producto. Para probar que la unicidad es por catálogo, crea otro catálogo activo (y un producto válido en él). Usa nombres y datos ficticios.
2. En una terminal con la misma `DATABASE_URL` de prueba inicia `npm.cmd run dev`. En otra terminal, define el URL local del API y los IDs de prueba; no introduzcas datos de producción:

   ```powershell
   $env:TEST_API_BASE = 'http://127.0.0.1:3000/api'
   $env:TEST_PUBLIC_ID = '<publicId-de-prueba>'
   $env:TEST_PRODUCT_ID = '<productId-UUID-de-prueba>'
   ```

3. Ejecuta dos solicitudes simultáneas con la misma clave. El endpoint real es `POST /api/public/catalogs/:publicId/orders`; la clave va en JSON. El script usa Node integrado, no requiere paquetes:

   ```powershell
   @'
   const assert = require('node:assert/strict');
   const { randomUUID } = require('node:crypto');
   const key = randomUUID();
   const payload = {
     idempotencyKey: key,
     customerName: 'Prueba de concurrencia',
     customerPhone: '3001234567',
     customerAddress: 'Calle 10 # 20-30',
     consent: true,
     items: [{ productId: process.env.TEST_PRODUCT_ID, quantity: 1 }],
   };
   const url = `${process.env.TEST_API_BASE}/public/catalogs/${encodeURIComponent(process.env.TEST_PUBLIC_ID)}/orders`;
   const send = () => fetch(url, {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify(payload),
   }).then(async response => ({ status: response.status, body: await response.json() }));
   Promise.all([send(), send()]).then(([a, b]) => {
     assert.equal(a.status, 201);
     assert.equal(b.status, 201);
     assert.equal(a.body.order.id, b.body.order.id);
     console.log(JSON.stringify({ key, orderId: a.body.order.id }));
   }).catch(error => { console.error(error); process.exitCode = 1; });
   '@ | node
   ```

4. En el SQL Editor de prueba o `psql`, consulta el `catalogId` asociado a ese `publicId` y cuenta por la clave impresa; reemplaza ambos marcadores por valores de prueba:

   ```sql
   SELECT count(*)
   FROM orders
   WHERE "catalogId" = '<catalogId-de-prueba>'
     AND "idempotencyKey" = '<clave-impresa>';
   ```

   Resultado requerido: `1`; ambas respuestas deben tener el mismo `order.id`. Repite el POST secuencialmente con el mismo payload/clave y verifica que responde el mismo recibo. Repite con la misma clave pero el segundo catálogo y un producto de ese catálogo; debe generarse otro `order.id` y quedar una fila por catálogo. Usa una nueva clave para separar los casos.
5. Limpia las variables de prueba con `Remove-Item Env:TEST_API_BASE, Env:TEST_PUBLIC_ID, Env:TEST_PRODUCT_ID`. No borres datos ni tablas en el proyecto remoto de producción.

### Ensayar restauración antes de confiar en un respaldo

Haz este ensayo solo en otro proyecto Supabase desechable o base PostgreSQL local vacía; el destino no puede ser producción ni la misma base en la que tienes datos que conservar.

1. Confirma que existen los archivos y el método correspondiente: Supabase Dashboard **Database → Backups** para un respaldo descargable, o los archivos lógicos `roles.sql`, `schema.sql`, `data.sql` generados con el procedimiento de respaldo anterior. Supabase Free no garantiza que haya un backup descargable tipo Dashboard/PITR; verifica lo que el panel ofrece para ese proyecto. El respaldo de SQL lógico requiere tener `psql`; el comando de dump de Supabase CLI requiere además Docker.
2. Crea un proyecto Supabase nuevo para la restauración o una base local nueva, y valida su referencia/host antes de restaurar. La restauración reemplaza/crea objetos en ese destino. No cambies el destino a producción para “probar”.
3. Para los tres SQL de `supabase db dump`, sigue la restauración oficial con `psql --single-transaction --variable ON_ERROR_STOP=1 --file roles.sql --file schema.sql --command 'SET session_replication_role = replica' --file data.sql --dbname <URI-PRUEBA>`. Si Supabase informa permisos de owner/roles, aplica solo las correcciones específicas de su guía y deja registro; no elimines líneas al azar. Un archivo `.backup` del Dashboard requiere la ruta de restauración compatible con ese formato según el panel/documentación, no se restaura como SQL con `-f`.
4. Comprueba que restauró tablas/filas esperadas, conteos acordados, extensiones, triggers/RLS personalizados y las cinco CHECK SQL actuales. Si la restauración no termina limpia, el respaldo no está validado: no uses ese respaldo como requisito de seguridad para la migración.

   La disponibilidad de proyectos Free y sus límites pueden cambiar; al momento de esta guía Supabase indica dos proyectos Free por organización. Verifica el plan/cupo antes de crear uno.

## Validación en una base de prueba

Los pasos para base aislada, comparación de esquema, concurrencia y restauración se describen en [Cómo verificar antes de aplicar](#cómo-verificar-antes-de-aplicar). El ensayo histórico del 2026-10-23 con 10 migraciones y tres CHECK no acredita una restauración de producción ni la repetición de la cadena actual de 13 migraciones y cinco CHECK. No se repitió aquí.

## Qué hacer si no existe `_prisma_migrations`

Su ausencia significa que no hay historial activo de Prisma Migrate que permita saber qué migraciones se aplicaron; por sí sola no demuestra el método histórico de creación, porque la tabla pudo eliminarse o haberse restaurado desde otro origen. No ejecutar el historial actual contra la base existente: la migración inicial crearía tablas ya presentes y fallaría o produciría una divergencia.

Primero obtener un respaldo probado, capturar el esquema real y comparar tablas, columnas, tipos, índices, constraints, funciones/triggers, políticas RLS y objetos administrados de Supabase con `schema.prisma` y los SQL versionados. Si una copia de prueba demuestra que el esquema real coincide con el estado acumulado de las migraciones históricas anteriores a la migración de idempotencia, acordar y probar el baseline marcando como aplicadas solo esas migraciones, en orden, por ejemplo `.\node_modules\.bin\prisma.cmd migrate resolve --applied 20261001144330_init`; repetir para cada versión cuya totalidad de cambios esté realmente presente. No marcar la migración de idempotencia como aplicada si su columna e índice no existen. `migrate resolve` registra el historial y no ejecuta el SQL. Si el estado remoto no coincide con ningún final de la cadena, no usar `resolve` a ciegas: diseñar un baseline que represente el esquema inspeccionado y reconciliarlo con el historial de este repositorio en una copia de prueba, sin reescribir migraciones aplicadas. Documentar la decisión antes de usarlo en otro entorno.

La guía de Prisma para [baselining](https://www.prisma.io/docs/orm/prisma-migrate/workflows/baselining) describe el proceso; Supabase distingue el estado SQL del historial de migraciones y advierte que cambios directos en el Dashboard/SQL Editor pueden desincronizarlo ([guía de migraciones](https://supabase.com/docs/guides/deployment/database-migrations)).

Si Supabase confirma que los cambios se hicieron desde Dashboard/SQL Editor, ese es un indicio de que el estado remoto pudo quedar fuera del historial versionado; no prueba por sí solo que `_prisma_migrations` falte. Supabase advierte que cambios remotos directos pueden desincronizar su historial. Revisa el estado con acceso a una base de pruebas o cuando haya autorización para consultar producción.

## Aplicación controlada y rollback

Después de una prueba satisfactoria y un respaldo restaurable:

1. Confirmar quién administra el esquema fuente de verdad: Prisma Migrate, migraciones de Supabase u otro proceso. No mantener dos sistemas aplicando SQL al mismo esquema sin una política explícita.
2. Verificar el commit/tag que contiene schema y migración, versiones de Node en Vercel y Render, y `migrate status` contra el destino acordado.
3. Aplicar una sola vez el mecanismo acordado durante una ventana controlada. Si Prisma es el mecanismo autorizado, `npm.cmd run prisma:migrate:deploy` ejecuta las migraciones pendientes; no ejecutar `migrate dev` en producción.
4. Verificar columnas/índices y estado de migraciones; desplegar API y frontend después de que exista la columna. Vigilar errores Prisma y creación de pedidos.

La migración de idempotencia es expansiva: añade una columna nullable y crea un índice único compuesto. No elimina datos. La reversión SQL estructural sería `DROP INDEX "orders_catalogId_idempotencyKey_key"; ALTER TABLE "orders" DROP COLUMN "idempotencyKey";`, pero perdería las claves ya guardadas y permitiría duplicados en reintentos posteriores. Por eso no hay rollback automático: si la API ya usó claves, hacer corrección hacia adelante; solo considerar la reversión manual si se confirma que perderlas es aceptable, con respaldo previo y en coordinación con API/frontend. Restaurar un backup completo implica perder escrituras posteriores a ese backup y no es una reversión inocua.

El historial registra comprobaciones anteriores; esta consolidación documental no ejecuta migraciones ni consultas remotas.

## Consultas y comprobaciones manuales previas

Cuando el usuario decida consultar Supabase, abre **SQL Editor** del proyecto al que quiere consultar (este paso lo ejecuta el usuario; no se ejecutó desde esta sesión). La siguiente consulta es de solo lectura y devuelve si existe la tabla, junto con sus columnas registradas en el catálogo. No ejecuta consultas contra la tabla si no existe:

```sql
SELECT
  to_regclass('public._prisma_migrations') IS NOT NULL AS table_exists,
  to_regclass('public._prisma_migrations') AS table_name,
  (
    SELECT array_agg(column_name ORDER BY ordinal_position)
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = '_prisma_migrations'
  ) AS columns;
```

Si `table_exists` es `false`, no existe el ledger en `public`. Si es `true`, ejecuta esta segunda consulta de solo lectura para listar las migraciones y su estado; no la ejecutes si la tabla no existe:

```sql
SELECT migration_name, started_at, finished_at, rolled_back_at
FROM public._prisma_migrations
ORDER BY started_at;
```

Antes de un despliegue, confirmar en configuración del servicio la versión Node de Vercel y Render. El repositorio declara Node 24 mediante `.nvmrc` y `engines.node: 24.x`, pero `render.yaml` solo fija `runtime: node`, no una versión; no se inspeccionaron los ajustes de esos servicios.
