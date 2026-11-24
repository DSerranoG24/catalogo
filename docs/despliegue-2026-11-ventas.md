# Runbook: migraciones de Ventas de noviembre de 2026

Preparado el 24 de noviembre de 2026 para que el responsable aplique en producción dos migraciones y publique el código que las acompaña. Lo ejecuta **una sola persona**, paso a paso, deteniéndose ante cualquier resultado distinto del esperado. Este documento no autoriza a ningún agente a ejecutarlo. Complementa [despliegue](despliegue.md) y [migraciones](migrations.md).

## Qué se despliega

| Pieza | Efecto |
| --- | --- |
| `20261124100000_sale_integrity_checks` | 11 CHECK en `"Sale"`, `"SaleLine"` y `"SaleReturnLine"` (importes, ecuaciones y reparto de devoluciones). No modifica datos. |
| `20261124200000_inventory_movements_allow_sale_origin` | Reemplaza `inventory_movements_origin_check` e `inventory_movements_batch_check` para admitir `origin = 'SALE'` con sus referencias obligatorias. **Desbloquea** confirmar, convertir pedidos en confirmados o entregados, cancelar y devolver revendibles, que hoy fallan con 500. |
| Código de la rama `f0b-sale-integrity` | Bloqueo de la venta y de los artículos en orden fijo, reintento idempotente antes de la versión, ensayo PostgreSQL y documentación. Sin cambios de frontend. |

Ambas migraciones se ensayaron el 24/11/2026 sobre la cadena completa de 38 migraciones en PostgreSQL local (`npm.cmd run test:sales-postgres`, 19/19 etapas).

**Compatibilidad:**
- El código actualmente desplegado funciona con el esquema nuevo. Sus totales ya cumplen los CHECK, y en cuanto exista la segunda migración sus movimientos `SALE` empiezan a aceptarse.
- El código nuevo funciona con el esquema actual, salvo los movimientos de venta, que siguen bloqueados como hoy.
- Por eso el orden recomendado es **migraciones → push inmediato**: entre ambos pasos las ventas ya funcionan con el código antiguo, que no bloquea artículos. Mantén esa ventana corta y no confirmes ventas durante ella.

## 0. Preparación (sin tocar producción)

1. Reserva una ventana de poca actividad, de unos 30 minutos.
2. Comprueba que tienes:
   - acceso a Supabase (SQL Editor y *Connect*), Render y Vercel;
   - la cadena de conexión de producción en un gestor seguro. No la pegues en archivos, chats ni terminales con historial compartido;
   - el cliente de PostgreSQL instalado (`pg_dump.exe` y `pg_restore.exe`; en este equipo, `C:\Program Files\PostgreSQL\17\bin`);
   - espacio en disco fuera del repositorio para el volcado.
3. En tu copia local, desde la raíz del repositorio:

   ```powershell
   git status                       # debe estar limpio
   git log --oneline -4 f0b-sale-integrity
   ```

   Deben aparecer, en este orden descendente, el commit F0c (origen `SALE`), el contrato de Gastos y F0b (integridad de Ventas), sobre `0d6de38`.
4. Verifica localmente la versión exacta que se publicará, desde `catalog-api`:

   ```powershell
   git switch f0b-sale-integrity
   npm.cmd ci
   npm.cmd run build
   npm.cmd test
   ```

   Detente si algo falla. Opcional, con un clúster PostgreSQL local de prueba: `'postgresql://<usuario>@127.0.0.1:<puerto>/catalogo_test' | npm.cmd run test:sales-postgres`.
5. Anota el commit que hoy sirve producción, para comparar después:
   - **Render:** servicio API → Events → último deploy correcto → SHA.
   - **Vercel:** proyecto → Deployments → Production → SHA.

## 1. Consulta previa de solo lectura

En Supabase → SQL Editor del proyecto de producción, abre [`docs/sql/verify-sale-integrity.sql`](sql/verify-sale-integrity.sql). Solo lee: abre una transacción `READ ONLY` y termina en `ROLLBACK`.

El editor de Supabase muestra únicamente el resultado de la **última** sentencia. Ejecuta cada `SELECT` por separado, seleccionando su texto y pulsando *Run*. Fuera de la transacción también son de solo lectura.

| Consulta | Resultado esperado | Si no se cumple |
| --- | --- | --- |
| Reglas (`WITH rules AS …`) | Todas las filas `CHECK` con `violaciones = 0`. Las `DIAGNÓSTICO` pueden ser distintas de 0. | **No migres.** Guarda solo los IDs que aparecen y revísalos antes de decidir. No corrijas importes por SQL sin una decisión explícita. Una violación en `inventory_movements_*` no se puede reparar: el registro de movimientos es inmutable. Escala antes de seguir. |
| Totales de contexto | Conteos de ventas, líneas y líneas devueltas. | Solo informativo. |
| Orígenes de `inventory_movements` | Solo `MANUAL` e `INVENTORY_BATCH`; `con_referencias_de_venta = 0`. | Un origen `SALE` o filas con referencias de venta indican cambios manuales previos: no migres y escala. |
| Restricciones actuales | Aparecen `inventory_movements_batch_check` e `inventory_movements_origin_check` (con `MANUAL` e `INVENTORY_BATCH`). | Si falta alguna o tiene otro nombre, la segunda migración fallará: no migres. |
| Migraciones de este bloque | Sin filas. | Si ya aparecen, alguien las aplicó o intentó aplicarlas: revisa `finished_at` y `rolled_back_at` antes de seguir (ver paso 4). |

Guarda una captura o nota de los resultados, sin datos personales.

## 2. Respaldo: volcado manual obligatorio

El proyecto está en **Supabase Free**, que no tiene respaldos automáticos. Antes de migrar hay que crear un volcado manual y verificarlo. **Sin un volcado verificado, no sigas.** Las migraciones son aditivas y transaccionales, pero el volcado cubre errores de operación.

Alcance del volcado:
- Incluye el esquema `public`: todas las tablas de la aplicación y `_prisma_migrations`.
- **No incluye los objetos de Storage** (imágenes de productos, logos y banners) ni los esquemas que gestiona Supabase (`auth`, `storage`…), que la aplicación no usa para sus datos.
- Contiene datos personales (clientes, pedidos, ventas). Trátalo como confidencial: no lo subas a la nube ni lo compartas, y bórralo cuando ya no haga falta.

### 2.1 Comprobar versiones

1. En el SQL Editor de producción ejecuta `SELECT version();` y anota la versión mayor del servidor (por ejemplo, `PostgreSQL 17.6` → 17).
2. En una PowerShell, comprueba la de tu cliente:

   ```powershell
   & 'C:\Program Files\PostgreSQL\17\bin\pg_dump.exe' --version
   ```

3. Si la versión mayor de `pg_dump` es **igual o mayor** que la del servidor, sigue con 2.2. Si es menor, `pg_dump` se negará a volcar: usa la alternativa de 2.5 con la CLI de Supabase, o instala tú el cliente de PostgreSQL de esa versión y vuelve a este paso.

### 2.2 Abrir la PowerShell dedicada y leer la URL sin eco

Abre una PowerShell **nueva**, dedicada a este despliegue; la usarás también en el paso 3. Ve a `catalog-api` dentro del repositorio y pega el bloque. Pide la URL sin mostrarla y comprueba que corresponde al proyecto de producción antes de ejecutar nada, igual que en [migrations.md](migrations.md#opción-a-proyecto-supabase-de-prueba-plan-free):

```powershell
$expectedRef = Read-Host 'Project ref del proyecto DE PRODUCCIÓN'
$secureUrl = Read-Host 'URI de conexión de PRODUCCIÓN (directa o Session pooler)' -AsSecureString
$databaseUrl = [System.Net.NetworkCredential]::new('', $secureUrl).Password
$uri = [uri]$databaseUrl
$user = [uri]::UnescapeDataString(($uri.UserInfo -split ':', 2)[0])
if (-not (($uri.Host -eq "db.$expectedRef.supabase.co") -or ($user -eq "postgres.$expectedRef"))) {
  $databaseUrl = $null; throw 'La URI no corresponde al Project ref indicado. No se ejecutó nada.'
}
if ($uri.Port -eq 6543) {
  $databaseUrl = $null; throw 'Es el Transaction pooler (6543). Usa la conexión directa o el Session pooler.'
}
$env:DATABASE_URL = $databaseUrl                                    # para Prisma, en el paso 3
$dumpUrl = $uri.GetLeftPart([UriPartial]::Path) + '?sslmode=require' # pg_dump no admite ?schema=
$databaseUrl = $null; $secureUrl = $null; $uri = $null; $user = $null; $expectedRef = $null
```

Comprueba el Project ref en el panel de Supabase antes de escribirlo. `$dumpUrl` es la misma conexión sin los parámetros de Prisma (como `?schema=public`), que `libpq` rechaza. No imprimas ninguna de las dos variables.

### 2.3 Crear el volcado fuera del repositorio

En la misma PowerShell:

```powershell
$pgBin = 'C:\Program Files\PostgreSQL\17\bin'          # la versión comprobada en 2.1
$backupDir = Join-Path $env:USERPROFILE 'Respaldos\catalogo'
$repoRoot = (git rev-parse --show-toplevel) -replace '/', '\'
if ($backupDir.StartsWith($repoRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'La carpeta de respaldo está dentro del repositorio.' }
New-Item -ItemType Directory -Force $backupDir | Out-Null
$backupPath = Join-Path $backupDir ('catalogo-prod-{0}.dump' -f (Get-Date -Format 'yyyyMMdd-HHmm'))
& "$pgBin\pg_dump.exe" --format=custom --schema=public --no-owner --no-privileges --file=$backupPath --dbname=$dumpUrl
if ($LASTEXITCODE -ne 0) { throw 'pg_dump falló. No continúes con la migración.' }
```

`--format=custom` (`-Fc`) produce un archivo comprimido que `pg_restore` puede inspeccionar y restaurar de forma selectiva. Si `pg_dump` falla, sus mensajes pueden mostrar el host, nunca la contraseña. Mientras se ejecuta, la URL es visible en la lista de procesos del equipo: hazlo en tu equipo personal, sin otras sesiones de usuario abiertas.

### 2.4 Verificar y registrar el volcado

```powershell
& "$pgBin\pg_restore.exe" --list $backupPath > "$backupPath.list"
if ($LASTEXITCODE -ne 0) { throw 'El archivo no es un volcado legible. No continúes.' }
$tables = Select-String -Path "$backupPath.list" -Pattern 'TABLE DATA public (_prisma_migrations|"Sale"|"SaleLine"|inventory_movements|inventory_items|orders|users) '
"Tablas clave con datos en el volcado: $($tables.Count) de 7"
$file = Get-Item $backupPath
[pscustomobject]@{
  fecha   = $file.LastWriteTime.ToString('yyyy-MM-dd HH:mm')
  bytes   = $file.Length
  ruta    = $file.FullName
  sha256  = (Get-FileHash $backupPath -Algorithm SHA256).Hash
  pg_dump = (& "$pgBin\pg_dump.exe" --version)
}
```

Esperado: `pg_restore --list` termina sin error y aparecen las 7 tablas clave. Si faltan tablas o el tamaño es anormalmente pequeño, detente.

Anota en tus notas del despliegue la fecha, el tamaño, la ruta, el SHA-256 y la versión de `pg_dump`. **No anotes la URL.** El archivo `.list` contiene solo nombres de objetos y puede quedarse junto al volcado.

### 2.5 Alternativa: CLI de Supabase

Solo si el `pg_dump` local es de una versión menor que el servidor. Requiere la CLI de Supabase y Docker, que no se instalan durante este runbook. En la misma PowerShell:

```powershell
supabase db dump --db-url $dumpUrl -f "$backupDir\catalogo-prod-schema.sql"
supabase db dump --db-url $dumpUrl -f "$backupDir\catalogo-prod-data.sql" --use-copy --data-only
if ($LASTEXITCODE -ne 0) { throw 'supabase db dump falló. No continúes.' }
Select-String -Path "$backupDir\catalogo-prod-schema.sql" -Pattern '_prisma_migrations' -List
Select-String -Path "$backupDir\catalogo-prod-data.sql" -Pattern 'COPY "public"\."Sale"' -List
```

Produce SQL plano en lugar del formato `-Fc`. Se verifica comprobando que ambos archivos existen, no están vacíos y contienen esas tablas. Registra los mismos datos que en 2.4 para cada archivo.

### 2.6 Cómo restaurar desde el volcado (solo si hiciera falta)

Primero, siempre que sea posible, **restaura en otra base** para inspeccionar o recuperar datos concretos sin tocar producción: un proyecto Supabase de prueba o un PostgreSQL local vacío.

```powershell
# $destUrl: URL de una base VACÍA de prueba, leída sin eco con el mismo patrón de 2.2.
& "$pgBin\pg_restore.exe" --no-owner --no-privileges --single-transaction --dbname=$destUrl $backupPath
```

Restaurar **sobre producción** es el último recurso y requiere una decisión explícita:
- se pierden todas las escrituras posteriores al volcado (pedidos, ventas, movimientos, clientes);
- Storage no cambia, así que puede haber imágenes subidas después que queden huérfanas, o referencias a imágenes borradas después.

Si se decide:
1. Detén las escrituras: en Render, suspende el servicio de la API.
2. Haz un volcado nuevo del estado actual (2.3 y 2.4, con otro nombre), para poder conciliar después lo que se perderá.
3. Restaura sobre `public` en una sola transacción. Si algo falla, se revierte todo y producción queda como estaba:

   ```powershell
   & "$pgBin\pg_restore.exe" --clean --if-exists --single-transaction --no-owner --no-privileges --schema=public --dbname=$dumpUrl $backupPath
   if ($LASTEXITCODE -ne 0) { throw 'La restauración falló y se revirtió. Producción no cambió.' }
   ```

4. Comprueba `npm.cmd exec prisma -- migrate status`. Con el volcado previo a este despliegue, las dos migraciones vuelven a figurar como pendientes, coherentes con el esquema restaurado.
5. Reanuda el servicio en Render. Su código es compatible con el esquema anterior (ver «Compatibilidad»).
6. Repite la consulta previa (paso 1) y una prueba de humo.

## 3. Aplicar las migraciones

Continúa en la **misma PowerShell dedicada** del paso 2, dentro de `catalog-api` y con la rama `f0b-sale-integrity` activa:

1. `$env:DATABASE_URL` ya contiene la conexión de producción, leída sin eco y validada contra el Project ref en 2.2: directa o *Session pooler*, nunca el *Transaction pooler* (puerto 6543), que no es apto para `migrate`. Si cerraste la ventana, repite 2.2. No edites `.env` ni la imprimas.
2. Confirma que el volcado del paso 2 está verificado y registrado.
3. Ejecuta uno por uno y comprueba `$LASTEXITCODE` tras cada comando:

   ```powershell
   npm.cmd exec prisma -- migrate status
   ```

   Esperado: exactamente dos migraciones pendientes, `20261124100000_sale_integrity_checks` y `20261124200000_inventory_movements_allow_sale_origin`. Si aparece cualquier otra pendiente o una fallida, **detente**.

   ```powershell
   npm.cmd run prisma:migrate:deploy
   npm.cmd exec prisma -- migrate status
   ```

   Esperado: `All migrations have been successfully applied` y después `Database schema is up to date!`.
4. En el SQL Editor, repite la consulta de **restricciones actuales**: ambas deben incluir `'SALE'`. Repite también la de **migraciones de este bloque**: dos filas con `finished_at` y sin `rolled_back_at`.
5. Retira las variables y cierra esa PowerShell para que la cadena de conexión no quede en la sesión: `Remove-Item Env:DATABASE_URL; $dumpUrl = $null`.

No uses `migrate dev`, `db push`, `migrate reset` ni `migrate resolve --applied` contra producción.

## 4. Si falla: P3018 / P3009

Cada migración va en su propia transacción. Si una falla, **no deja cambios parciales**: la anterior, si terminó, queda aplicada, y la fallida no.

1. `migrate deploy` muestra `P3018` y el nombre de la migración. Un nuevo `deploy` mostrará `P3009` y se negará a continuar hasta resolverla. No reintentes a ciegas.
2. Identifica cuál falló y por qué: repite la consulta previa (paso 1). La causa esperable es una regla `CHECK` con violaciones.
3. Comprueba con la consulta de restricciones que el esquema sigue como antes de esa migración.
4. Marca la migración como revertida, desde la misma PowerShell dedicada:

   ```powershell
   npm.cmd exec prisma -- migrate resolve --rolled-back <nombre_de_la_migración>
   ```

5. Decide con los datos delante:
   - **Falló `sale_integrity_checks`.** Hay ventas cuyos importes no cuadran. Como la segunda migración no llegó a aplicarse, las ventas siguen bloqueadas igual que antes. No corrijas importes sin decidir qué venta es la correcta. Cuando estén resueltas, vuelve al paso 3.
   - **Falló `inventory_movements_allow_sale_origin`.** La primera queda aplicada, lo cual es seguro, y las ventas siguen bloqueadas. Un movimiento existente incumple las reglas nuevas y no puede borrarse ni editarse. Hace falta revisar el diseño de la restricción antes de reintentar; detente y escala.
6. El registro `_prisma_migrations` conservará la fila revertida (`rolled_back_at`) junto a la del reintento correcto. Es lo esperado y se comprobó en el ensayo.

Si el despliegue de código ya se hizo y la primera migración falla, no pasa nada: el código nuevo funciona con el esquema anterior.

## 5. Publicar el código

Solo después del paso 3 correcto:

```powershell
git switch main
git merge --ff-only f0b-sale-integrity
git push origin main
```

`--ff-only` garantiza que `main` avance a los mismos commits revisados, sin crear un commit nuevo. El push puede disparar despliegues automáticos en Render y Vercel.

## 6. Comprobar Render y Vercel

**Render (API):**
1. Events: un deploy para el SHA del último commit de `f0b-sale-integrity`, en estado *Live*. Si queda *Failed*, revisa el primer error del log de build; la versión anterior sigue atendiendo, y no significa éxito.
2. Logs: arranque sin errores de Prisma ni de conexión.
3. `GET https://<API>/api/health` → 200. Solo prueba la conexión: no acredita el esquema ni las ventas.

**Vercel (frontend):** este bloque no cambia el frontend. Si se crea un deployment para el SHA nuevo, debe quedar *Ready* y asignado al dominio de producción. Si el proyecto omite builds sin cambios, el deployment anterior sigue siendo válido.

Compara ambos SHA con los anotados en el paso 0.

## 7. Prueba de humo en una cuenta de prueba

Hazla en una **cuenta de prueba creada para eso en producción, nunca en la cuenta real del negocio**. La prueba deja registros permanentes (las ventas no se borran y los movimientos de inventario son inmutables). En una cuenta aparte no ensucian el inventario, las ventas ni los totales del negocio.

### 7.0 Crear e identificar la cuenta de prueba

Solo la primera vez; después se reutiliza.

1. Abre una **ventana privada** del navegador para que la sesión de prueba no se mezcle con la de la cuenta real.
2. En la web de producción, entra en `/login` y crea una cuenta nueva con correo y contraseña:
   - **Correo:** una dirección tuya dedicada a pruebas, por ejemplo con alias `tu-usuario+humo-ventas@…` si tu proveedor admite `+`. No uses el correo de la cuenta del negocio ni entres con Google, que se vincula a tu identidad real.
   - **Nombre:** `PRUEBA HUMO — no es un cliente`.
   - **Contraseña:** una única, guardada en tu gestor junto a una nota «cuenta de prueba de producción».
3. No hace falta verificar el correo: una cuenta sin verificar puede usar el panel ([cuentas](accounts.md)). Si lo verificas, confirmas además que el alias recibe correo.
4. Para identificarla, ejecuta en la consola (F12) de la ventana privada:

   ```js
   await fetch("/api/backend/me").then(r => r.json())
   ```

   Anota en tus notas de despliegue el `user.id` y el correo de la cuenta de prueba.
5. No crees catálogos ni publiques productos con esta cuenta: así nada de ella llega al catálogo público ni recibe pedidos. Contará como un usuario más en las métricas de administración.
6. No la cierres al terminar: se reutiliza en próximas pruebas de humo. Si algún día se cierra desde `/dashboard/cuenta`, sus datos se conservan, pero ya no se podrá usar.

### 7.1 Recorrido

Antes de cada paso, comprueba que la ventana privada sigue en la cuenta de prueba (el `GET /api/backend/me` del 7.0 debe devolver su `user.id`).

1. En `/dashboard/inventario` de la cuenta de prueba, crea el artículo **«PRUEBA HUMO VENTAS 2026-11»** con SKU `HUMO-2611`. Regístrale una entrada de 3 unidades y una ficha comercial con precio 1000. En pruebas posteriores, reutiliza el artículo y ajusta las cifras esperadas a su stock actual.
2. En la misma ventana privada, abre la consola del navegador (F12) y pega:

   ```js
   const api = async (path, method = "GET", body) => {
     const r = await fetch(`/api/backend${path}`, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
     const j = await r.json().catch(() => null); console.log(method, path, r.status, j);
     if (!r.ok) throw new Error(`HTTP ${r.status}`); return j.result;
   };
   const ITEM = (await api("/inventory/items?page=1&q=HUMO-2611")).items.find(i => i.sku === "HUMO-2611").id;
   const key = () => ({ operationId: crypto.randomUUID(), requestId: crypto.randomUUID() });
   const sale = await api("/sales", "POST", key());
   const draft = await api(`/sales/${sale.id}`, "PATCH", { operationId: crypto.randomUUID(), expectedVersion: sale.version, lines: [{ inventoryItemId: ITEM, quantity: 1, unitDiscount: "0" }] });
   const confirmCmd = { ...key(), expectedVersion: draft.version, deliverImmediately: false };
   const confirmed = await api(`/sales/${sale.id}/confirm`, "POST", confirmCmd);
   ```

   Esperado: el último `console.log` muestra `200` y `status: "CONFIRMED"`. Antes de la migración, este paso daba `500 SALE_OPERATION_FAILED`.
3. En Inventario, el artículo debe tener 2 unidades y un movimiento «Confirmación de venta» de 3 → 2.
4. Comprueba el reintento idempotente:

   ```js
   await api(`/sales/${sale.id}/confirm`, "POST", confirmCmd);
   ```

   Esperado: `200`, la misma venta y **ningún** movimiento nuevo (siguen 2 unidades).
5. Cancela:

   ```js
   await api(`/sales/${sale.id}/cancel`, "POST", { ...key(), expectedVersion: confirmed.version, reason: "Prueba de humo despliegue 2026-11" });
   ```

   Esperado: `200`, `status: "CANCELLED"`, 3 unidades y un movimiento de cancelación de 2 → 3.
6. Opcional, devolución desde la interfaz:
   1. Crea otra venta con `deliverImmediately: true` (repite el paso 2 con ese valor). Deja 2 unidades.
   2. En `/dashboard/ventas`, abre la venta y registra una «Devolución total» con 1 revendible y 0 dañadas.
   3. Esperado: venta `RETURNED` y stock 3 de nuevo.
7. Repite la consulta de orígenes (paso 1): ahora aparece `SALE` con sus referencias, procedentes de la cuenta de prueba.
8. Cierra la ventana privada. La cuenta real del negocio no se tocó en ningún paso.

Si un paso falla, anota el código HTTP y `error` (no hay datos personales en esta prueba) y **no reviertas el esquema**: con las migraciones aplicadas, una corrección es hacia adelante.

## 8. Cierre

- Anota en [estado](estado.md) la fecha de aplicación, los SHA publicados, el registro del volcado (fecha, tamaño, ruta, SHA-256; nunca la URL) y el resultado de la prueba de humo.
- El artículo, las ventas y los movimientos de prueba quedan en la cuenta de prueba, identificados por su `user.id`, el nombre `PRUEBA HUMO` y el SKU `HUMO-2611`.
- Conserva el volcado hasta confirmar que producción funciona con normalidad y luego aplica tu política de borrado: contiene datos personales.

## Recuperación de aplicación

- Volver al código anterior es compatible con el esquema nuevo: no necesita revertir las migraciones. Ten en cuenta que el código anterior confirma ventas sin bloquear artículos.
- No elimines las restricciones por SQL para «volver atrás»: quitar la segunda volvería a bloquear las ventas. Cualquier cambio de esquema posterior se hace con una migración nueva revisada.
- Restaurar el volcado sobre producción pierde las escrituras posteriores y no recupera Storage; es el último recurso y requiere una decisión explícita ([procedimiento en 2.6](#26-cómo-restaurar-desde-el-volcado-solo-si-hiciera-falta)).
