# Procedimiento seguro para migraciones

## Estado conocido del repositorio

- Prisma carga `DATABASE_URL` desde `catalog-api/.env`; la dirección está configurada como remota. Este documento no reproduce esa dirección ni credenciales.
- Se instaló PostgreSQL 17.11-5 para Windows con `winget` y el asistente interactivo del instalador oficial de EDB. El servicio `postgresql-x64-17` está activo y escucha en `127.0.0.1:5432`; el instalador lo dejó con inicio automático. No se pudo cambiar a inicio manual desde esta sesión por `Acceso denegado`; un usuario con permisos de administrador puede hacerlo desde Services o PowerShell elevado. `psql` existe en `C:\Program Files\PostgreSQL\17\bin`, pero no está en `PATH`. Docker no está instalado/disponible y no se pudo consultar WSL desde esta sesión.
- Se crearon las bases locales `catalogo_test`, `catalogo_shadow` y `catalogo_restore_test`; las dos primeras eran nuevas y vacías. No contienen datos de producción. La clave local se usó solo en variables de proceso/comandos locales y no se guarda en este documento ni en archivos del proyecto.
- El historial versionado contiene una migración inicial y nueve migraciones incrementales. Eso documenta el historial esperado en el repositorio, pero no demuestra cuáles se aplicaron en Supabase ni cómo se creó su esquema.
- No existe un directorio/configuración `supabase/` en el workspace; la única historia versionada aquí es `catalog-api/prisma/migrations/`. No confirma qué mecanismo se usó en el servicio remoto.
- La existencia de `public._prisma_migrations` en Supabase queda sin confirmar. No se consultó esa base en este bloque. Si no existe, no se debe ejecutar `prisma migrate deploy`: primero hay que acordar y probar un baseline que describa el esquema real.
- `prisma migrate status` con la URL remota ya había devuelto `Error: Schema engine error:` sin detalle. Con `DEBUG="*"` y una URL loopback deliberadamente no disponible, Prisma imprimió el stack de `Schema engine error` pero no la causa nativa; además registró un `EPERM` independiente al abrir su caché de telemetría bajo el perfil de Windows. Por tanto, el error original del destino remoto no se puede atribuir a una causa única sin consultar una base no productiva con conectividad válida. No se usa la URL remota para esta depuración.

## Consistencia entre migraciones y schema.prisma

La inspección estática de `prisma/schema.prisma` y los SQL versionados encuentra la secuencia esperada para usuarios, catálogos, productos, promociones, imágenes, reseñas, pedidos y plantillas. La conversión de `CatalogTemplate` a `TEXT` coincide con `Catalog.template String` actual. La nueva migración `20261023150000_order_idempotency_key` corresponde a `Order.idempotencyKey String?` y `@@unique([catalogId, idempotencyKey])`.

Hay restricciones SQL que son más estrictas que el modelo Prisma y no están declaradas en `schema.prisma`: `products_promotion_valid_check`, `product_reviews_rating_check` y `product_reviews_comment_length_check`. Se mantienen en sus migraciones SQL: el proyecto instala Prisma ORM 6.19.3 y Prisma v6 documenta CHECK como una función no soportada/introspectable desde PSL; añadir una sintaxis `@@check` no es válido para esta versión ([guía de Prisma v6 sobre CHECK](https://www.prisma.io/docs/orm/v6/more/troubleshooting/check-constraints), [funciones no soportadas por introspección](https://www.prisma.io/docs/orm/v6/prisma-schema/introspection)). No se deben quitar ni editar esas sentencias. Una reconstrucción basada solo en `schema.prisma` las perdería; deben revisarse y preservarse explícitamente en cualquier reconstrucción o baseline. Esta decisión deberá reevaluarse por separado si el proyecto migra a una versión Prisma cuya sintaxis PSL estable cubra CHECK constraints. Una inspección estática no certifica el estado real de Supabase ni demuestra que toda la cadena se aplique sin diferencias en una base vacía.

La telemetría de Prisma falló al abrir su caché de checkpoint bajo el perfil de Windows (`EPERM`, operación `open`). En la ejecución diagnóstica Prisma siguió leyendo la configuración e iniciando el motor; por tanto ese `EPERM` de caché es ruido de telemetría y no explica por sí mismo el error de conexión `Schema engine error`. La causa del error remoto sigue sin determinarse porque no se volvió a conectar a ese destino. Para silenciar el checkpoint solo en una sesión PowerShell, el usuario puede ejecutar `$env:CHECKPOINT_DISABLE = '1'` antes de sus comandos Prisma y luego `Remove-Item Env:CHECKPOINT_DISABLE`. No se cambió ninguna preferencia del sistema. Prisma documenta esa variable para desactivar telemetría del CLI v6 ([documentación](https://www.prisma.io/docs/orm/v6/tools/prisma-cli)).

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

En este equipo el paquete se instaló con el comando interactivo siguiente (PostgreSQL 17.11-5). En el asistente se mantuvo el puerto predeterminado 5432 y se configuró la clave solo para la base local:

```powershell
winget install --exact --id PostgreSQL.PostgreSQL.17 --interactive --accept-source-agreements --accept-package-agreements
```

El instalador creó el servicio `postgresql-x64-17` con inicio automático. No pude cambiarlo a inicio manual porque Windows devolvió `Acceso denegado`. Para cambiarlo desde PowerShell **ejecutada como administrador** y mantenerlo activo durante la sesión:

```powershell
Set-Service -Name postgresql-x64-17 -StartupType Manual
```

Arranque y parada cuando el servicio quede en inicio manual (puede requerir permisos de administrador):

```powershell
Start-Service -Name postgresql-x64-17
Stop-Service -Name postgresql-x64-17
Get-Service -Name postgresql-x64-17
```

Mientras el inicio siga como `Automatic`, `Stop-Service` lo detiene hasta que vuelva a iniciarse Windows. La configuración a `Manual` anterior no se logró aplicar desde esta sesión.

Los ejecutables del equipo actual están en `C:\Program Files\PostgreSQL\17\bin`; si `psql`, `createdb` o `dropdb` no están en `PATH`, usa sus rutas completas. La instalación no agregó ese directorio al PATH.

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

Código de salida `0` significa sin diferencias detectables por Prisma; `2` indica diferencia; otros errores son fallo de ejecución/conexión. Nunca configures ambas variables con la misma base. Esta comparación no sustituye la inspección de restricciones no soportadas por PSL: verifica expresamente que sigan existiendo los tres CHECK descritos arriba. Prisma documenta el uso de shadow DB al comparar un directorio de migraciones.

En el PostgreSQL de prueba (SQL Editor del proyecto de prueba o `psql` local), comprueba dichas constraints y la unicidad idempotente:

```sql
SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname IN (
  'products_promotion_valid_check',
  'product_reviews_rating_check',
  'product_reviews_comment_length_check'
)
ORDER BY conname;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'orders'
  AND indexname = 'orders_catalogId_idempotencyKey_key';
```

El índice esperado debe contener `("catalogId", "idempotencyKey")`; la columna permite `NULL` para órdenes históricas. Esta consulta es de solo lectura.

### Resultado ejecutado en el PostgreSQL local

Se verificó lo siguiente exclusivamente contra `127.0.0.1:5432/catalogo_test`:

- `npm.cmd run prisma:migrate:deploy`: aplicó en orden las 10 migraciones, incluida `20261023150000_order_idempotency_key`.
- `prisma migrate status`: `Database schema is up to date!`.
- `prisma validate`: el modelo Prisma es válido.
- `prisma migrate diff --from-migrations ... --to-schema-datamodel ... --shadow-database-url ... --exit-code`: `No difference detected.` No detecta por sí solo las CHECK que PSL no expresa; se consultaron aparte.
- La consulta a `pg_constraint` encontró las tres CHECK y sus condiciones. `information_schema.columns` mostró `idempotencyKey` nullable. `pg_indexes` confirmó el índice único `orders_catalogId_idempotencyKey_key` sobre `("catalogId", "idempotencyKey")`.
- La prueba HTTP real envió dos POST simultáneos con la misma clave al API local. Ambas respuestas fueron HTTP 201 con el mismo `order.id` (`331b2705-befe-4f56-a554-0b23b5e70b0a`) y PostgreSQL guardó 1 fila. El reintento secuencial devolvió el mismo recibo. Dos claves distintas en el mismo catálogo produjeron 2 filas. La misma clave en dos catálogos produjo 2 IDs y 2 filas. Sin clave se crearon dos pedidos distintos. Se envió `total: 1` desde el cliente y el servidor devolvió 2500, calculado desde los precios persistidos.
- Tras la prueba se verificaron 0 usuarios, 0 catálogos y 0 pedidos de fixture; el ledger local tiene 10 migraciones completas.
- `npm.cmd test` sin el script de integración adicional: 28/28 pruebas aprobadas. `npm.cmd run build` y `prisma validate`: correctos. Al incluir el script de integración, el runner informó 29/29 pruebas aprobadas (las 28 habituales más el caso de integración local).
- Ensayo de restauración local: `pg_dump -Fc` creó `%TEMP%\catalogo-test-restore-20261023.dump` (23,643 bytes) desde la base local vacía de fixtures; `pg_restore --exit-on-error` restauró en la nueva `catalogo_restore_test` sin error. La copia restaurada contiene las 10 migraciones, las tres CHECK y el índice único idempotente. Esto valida la restauración lógica local del esquema, no un respaldo de producción/Supabase.

Para repetir la integración, `src/scripts/verify-order-idempotency-postgres.ts` solo admite `DATABASE_URL` con host loopback y base `/catalogo_test`; falla si el destino no cumple esas condiciones. Usa el API, Prisma y PostgreSQL existentes, sin dependencias nuevas. Ejecuta las pruebas unitarias más esta verificación con:

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
4. Comprueba que restauró tablas/filas esperadas, conteos acordados, extensiones, triggers/RLS personalizados y las tres constraints SQL. Si la restauración no termina limpia, el respaldo no está validado: no uses ese respaldo como requisito de seguridad para la migración.

   La disponibilidad de proyectos Free y sus límites pueden cambiar; al momento de esta guía Supabase indica dos proyectos Free por organización. Verifica el plan/cupo antes de crear uno.

## Validación en una base de prueba

Los pasos concretos para proyecto Supabase gratuito, PostgreSQL local en Windows, comparación de esquema, concurrencia y restauración de respaldo se describen en [Cómo verificar antes de aplicar](#cómo-verificar-antes-de-aplicar). En esta máquina no se detectó servicio PostgreSQL, `psql` ni Docker CLI disponible en `PATH`, y no hay una base de prueba configurada; por eso la concurrencia real sigue pendiente. La prueba unitaria falsa no se presenta como prueba de PostgreSQL.

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

No se ejecutó ningún paso de respaldo, restauración, baseline, migración, prueba contra PostgreSQL ni despliegue durante esta auditoría.

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
