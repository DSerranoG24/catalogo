# Operación y diagnósticos anteriores

La comunicación de producción reproducida abajo está fechada el 2026-10-24; los ensayos de idempotencia descritos corresponden al 23. Registro original conservado literalmente: las afirmaciones sobre doce migraciones son históricas, no el conteo vigente. No se repitieron consultas remotas en esta consolidacion. Consultar [estado](../estado.md) y [migraciones](../migrations.md).

## Estado conocido del repositorio

- Prisma usa `DATABASE_URL` del proceso y carga `catalog-api/.env` como respaldo. No se inspeccionan archivos de entorno reales ni se presupone su destino: confírmalo antes de cualquier comando contra una base.
- Se instaló PostgreSQL 17.11-5 para Windows con `winget` y el asistente interactivo del instalador oficial de EDB. El servicio `postgresql-x64-17` está activo y escucha en `127.0.0.1:5432`; el instalador lo dejó con inicio automático. No se pudo cambiar a inicio manual desde esta sesión por `Acceso denegado`; un usuario con permisos de administrador puede hacerlo desde Services o PowerShell elevado. `psql` existe en `C:\Program Files\PostgreSQL\17\bin`, pero no está en `PATH`. Docker no está instalado/disponible y no se pudo consultar WSL desde esta sesión.
- Se crearon las bases locales `catalogo_test`, `catalogo_shadow` y `catalogo_restore_test`; las dos primeras eran nuevas y vacías. No contienen datos de producción. La clave local se usó solo en variables de proceso/comandos locales y no se guarda en este documento ni en archivos del proyecto.
- El historial versionado contiene 12 migraciones: una inicial y once incrementales, incluidas las dos de archivado de catálogos y protección del historial de pedidos.
- No existe un directorio/configuración `supabase/` en el workspace; la única historia versionada aquí es `catalog-api/prisma/migrations/`. No confirma qué mecanismo se usó en el servicio remoto.
- Estado de producción comunicado por el responsable el 2026-10-24: main en `5bebe7a`, las 12 migraciones aplicadas en Supabase, `archivedAt` y la FK con RESTRICT verificadas, y 31 pruebas aprobadas. No se volvió a consultar producción en este bloque. Las referencias a 10 migraciones y 28/29 pruebas más abajo describen únicamente la verificación local histórica del 2026-10-23.
- `prisma migrate status` con la URL remota ya había devuelto `Error: Schema engine error:` sin detalle. Con `DEBUG="*"` y una URL loopback deliberadamente no disponible, Prisma imprimió el stack de `Schema engine error` pero no la causa nativa; además registró un `EPERM` independiente al abrir su caché de telemetría bajo el perfil de Windows. Por tanto, el error original del destino remoto no se puede atribuir a una causa única sin consultar una base no productiva con conectividad válida. No se usa la URL remota para esta depuración.

## Consistencia entre migraciones y schema.prisma

La inspección y los diagnósticos siguientes corresponden al bloque histórico de idempotencia del 2026-10-23. El error remoto registrado entonces no describe el estado actual comunicado de producción. Después se añadieron las dos migraciones de archivado; su verificación en producción fue comunicada por el responsable, no repetida en este bloque.

La inspección estática histórica de `prisma/schema.prisma` y los SQL versionados encontró la secuencia esperada para usuarios, catálogos, productos, promociones, imágenes, reseñas, pedidos y plantillas. La conversión de `CatalogTemplate` a `TEXT` coincide con `Catalog.template String`. La migración `20261023150000_order_idempotency_key` corresponde a `Order.idempotencyKey String?` y `@@unique([catalogId, idempotencyKey])`.

Hay restricciones SQL que son más estrictas que el modelo Prisma y no están declaradas en `schema.prisma`: `products_promotion_valid_check`, `product_reviews_rating_check` y `product_reviews_comment_length_check`. Se mantienen en sus migraciones SQL: el proyecto instala Prisma ORM 6.19.3 y Prisma v6 documenta CHECK como una función no soportada/introspectable desde PSL; añadir una sintaxis `@@check` no es válido para esta versión ([guía de Prisma v6 sobre CHECK](https://www.prisma.io/docs/orm/v6/more/troubleshooting/check-constraints), [funciones no soportadas por introspección](https://www.prisma.io/docs/orm/v6/prisma-schema/introspection)). No se deben quitar ni editar esas sentencias. Una reconstrucción basada solo en `schema.prisma` las perdería; deben revisarse y preservarse explícitamente en cualquier reconstrucción o baseline. Esta decisión deberá reevaluarse por separado si el proyecto migra a una versión Prisma cuya sintaxis PSL estable cubra CHECK constraints. Una inspección estática no certifica el estado real de Supabase ni demuestra que toda la cadena se aplique sin diferencias en una base vacía.

La telemetría de Prisma falló al abrir su caché de checkpoint bajo el perfil de Windows (`EPERM`, operación `open`). En la ejecución diagnóstica Prisma siguió leyendo la configuración e iniciando el motor; por tanto ese `EPERM` de caché es ruido de telemetría y no explica por sí mismo el error de conexión `Schema engine error`. La causa del error remoto sigue sin determinarse porque no se volvió a conectar a ese destino. Para silenciar el checkpoint solo en una sesión PowerShell, el usuario puede ejecutar `$env:CHECKPOINT_DISABLE = '1'` antes de sus comandos Prisma y luego `Remove-Item Env:CHECKPOINT_DISABLE`. No se cambió ninguna preferencia del sistema. Prisma documenta esa variable para desactivar telemetría del CLI v6 ([documentación](https://www.prisma.io/docs/orm/v6/tools/prisma-cli)).


## Instalación local registrada en el procedimiento anterior

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

