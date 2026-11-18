# Inventario: E2E local real

Verificación del 17 de noviembre de 2026. Continúa la [fase anterior](inventory-verification.md), conservando los cambios sin confirmar sobre `2c42d49`.

## Entorno

- PostgreSQL **17.11** real, `127.0.0.1:55439`, base `catalogo_test`. Cada ejecución crea un esquema único `inventory_e2e_*` y conserva los anteriores.
- API Express real compilada desde `catalog-api/src/app.ts`, en `127.0.0.1:4359`. Rutas, limitadores, validaciones, servicios, repositorios y autenticación originales, sin sustituirlos.
- Next.js real en `localhost:4358`, con Webpack, configuración original y copia temporal del código vigente. No se copian archivos `.env`, builds ni perfiles personales.
- Chrome/Edge real headless. Registro e inicio de sesión desde el formulario real, sin inyectar sesiones ni JWT. El proxy establece la cookie HttpOnly; JavaScript no puede leerla y localStorage no contiene un token.
- Dos cuentas ficticias por ejecución. Contraseñas y secreto de firma generados en memoria, sin imprimirlos ni guardarlos en el informe JSON.
- Correo en modo local `MAIL_MODE=log`, sin entregas reales. Google y Storage no forman parte del ensayo; Storage apunta a un puerto loopback sin servicio, con configuración ficticia.

La API se arranca mediante `app.listen`, sin los workers de limpieza de `server.ts`. El cierre real se verifica hasta revocación y creación del trabajo pendiente; no se ejecuta limpieza externa ni una política futura de retención.

La conexión entra por stdin. Antes de migrar se exige protocolo PostgreSQL, host y DNS loopback, base exactamente `catalogo_test` y ausencia de parámetros ambiguos. Se comprueba la identidad y el esquema antes de escribir. No se usa la conexión de `.env`.

## PostgreSQL: levantar y detener

Clúster temporal conservado de esta sesión:

```powershell
$inventoryCluster = 'C:\Users\danie\AppData\Local\Temp\vitrinaya-inventory-0764518467a24c2daea1f5f04e4e7908'
& 'C:/Program Files/PostgreSQL/17/bin/pg_ctl.exe' -D $inventoryCluster status
# Solo si está detenido:
& 'C:/Program Files/PostgreSQL/17/bin/pg_ctl.exe' -D $inventoryCluster -l (Join-Path $inventoryCluster 'postgres.log') -o '-h 127.0.0.1 -p 55439' -w start
# Detenerlo conservando los datos:
& 'C:/Program Files/PostgreSQL/17/bin/pg_ctl.exe' -D $inventoryCluster -m fast -w stop
```

Si ya no existe, crear un directorio **nuevo**, sin reutilizar otro directorio de datos. Ejecutar los comandos uno por uno y detenerse ante un error o si el puerto pertenece a otro servicio:

```powershell
$inventoryCluster = Join-Path $env:TEMP ('vitrinaya-inventory-' + [guid]::NewGuid().ToString('N'))
& 'C:/Program Files/PostgreSQL/17/bin/initdb.exe' -D $inventoryCluster --username=inventory_test --auth=trust --encoding=UTF8 --locale=C
& 'C:/Program Files/PostgreSQL/17/bin/pg_ctl.exe' -D $inventoryCluster -l (Join-Path $inventoryCluster 'postgres.log') -o '-h 127.0.0.1 -p 55439' -w start
& 'C:/Program Files/PostgreSQL/17/bin/createdb.exe' -h 127.0.0.1 -p 55439 -U inventory_test catalogo_test
```

`trust` se limita al clúster de fixtures en loopback, sin datos reales; no es una configuración para producción ni copias de clientes. El runner cierra su API, frontend y navegador al terminar. PostgreSQL se administra aparte. No se ejecutan DROP, reset ni borrados de datos reales.

Estado final: el clúster temporal quedó **detenido**, con confirmación `server stopped`. Se conservaron sus archivos y datos ficticios y no se detuvo el servicio PostgreSQL existente. La primera solicitud de parada no se ejecutó por un límite de uso de la revisión automática de aprobación; tras reanudar, la parada autorizada se completó correctamente.

## Comandos ejecutados

Desde `catalog-api`:

```powershell
npm.cmd run build
npm.cmd exec -- tsc --noEmit
npm.cmd test
'postgresql://inventory_test@127.0.0.1:55439/catalogo_test' | npm.cmd run test:inventory-postgres
```

Desde `catalog-generator`:

```powershell
'postgresql://inventory_test@127.0.0.1:55439/catalogo_test' | npm.cmd run test:inventory-e2e
npm.cmd run lint
npm.cmd exec -- tsc --noEmit
npm.cmd test
# Variables únicamente del proceso de build, para impedir acceso remoto:
$env:CATALOG_API_URL = 'http://127.0.0.1:4359/api'
$env:NEXT_PUBLIC_CATALOG_API_URL = 'http://127.0.0.1:4359/api'
npm.cmd run build
```

También se ejecutaron `psql ... -c 'SHOW server_version'`, `git status --short` y `git diff --check`. No se instalaron ni actualizaron dependencias en esta fase. No se editaron archivos de entorno. No publicar el `.next` local ni usar `--prebuilt`, porque contiene configuración de prueba.

## Resultado: 14 etapas aprobadas

| Etapa | Comprobación real |
| --- | --- |
| Destino aislado | Identidad loopback, `catalogo_test` y esquema nuevo comprobados antes de migrar. |
| Migraciones | Las 25 finalizadas en el ledger; `inventory_movements_balance_check` validado. |
| Stack | API, frontend, proxy y navegador reales, sin respuestas de inventario fabricadas. |
| Registro y bodega | Registro 201 en formulario; bodega vacía sin catálogo; sesión HttpOnly. La bodega es la colección del propietario, no otra tabla. |
| SKU y mínimo | Espacios rechazados con error visible; SKU válido normalizado; duplicado 409 y una sola fila; expansión Unicode sobre el límite 400; mínimo 3 persistido y aviso de existencias bajas. |
| Movimientos | Entrada 10 → saldo 10; salida 3 → 7; ajuste al alza → 20; ajuste a la baja → 4. Motivos y snapshots en historial. |
| Negativos | Salida excesiva 409 visible, saldo intacto; cantidad final negativa y motivo vacío 400, sin movimientos nuevos. Ajustar a la baja no permite saldo negativo. |
| Reintento | Se corta una respuesta tras el commit real. Reintentar conserva un único movimiento; misma clave/contenido 200, contenido distinto 409. |
| Recarga incierta | Se corta otra respuesta confirmada y se recarga antes de reintentar. El historial muestra la operación, sin reenvío automático ni incremento del recuento. |
| Concurrencia HTTP | Seis creaciones con el mismo ID recuperan una fila; seis IDs con un SKU producen un éxito y cinco conflictos. Ocho reintentos de una entrada suman una vez. De 16 salidas sobre diez unidades se aceptan diez y rechazan seis; saldo final cero. |
| Búsqueda/paginación | `%`, `_` y `\` encuentran literalmente el único artículo correspondiente. Veinticinco productos en páginas de 24 y 1 a 1280/320/390 px, sin desbordamiento. Se navega también el historial real. |
| Sesiones/propiedad | Logout impide consultar; segundo registro carga otra bodega vacía. Ambos usuarios reciben 404 al leer/escribir artículos ajenos. Mismo SKU permitido entre propietarios; `userId` añadido al cuerpo rechazado. Login posterior conserva datos propios. |
| Cierre real | `/auth/close` reautentica y devuelve 202. Artículos/movimientos posteriores devuelven 401; el ledger no cambia. Guardar desde la pantalla muestra sesión expirada. |
| Conciliación | Para cada artículo, `SUM(resultingStock - previousStock)` coincide con stock; cada fila cumple la aritmética de su tipo y no tiene snapshots negativos. El artículo principal conserva 31 movimientos y saldo 32 después de volver a entrar. |

Los 400/401/404/409 de casos negativos son resultados esperados. El corte de respuesta se provoca mediante CDP **después de alcanzar el backend y confirmar su transacción**; no se simula una API exitosa. Los datos de paginación y concurrencia también se crean por HTTP autenticado. SQL solo comprueba los resultados del E2E; no crea usuarios ni altera saldos para hacer pasar pruebas.

Las dos primeras ejecuciones fallaron antes del primer POST de registro: el runner confundía HTML presente con formulario hidratado. Se corrigió su espera de interacción y la finalización del logout, sin cambiar autenticación ni omitir aserciones. Las ejecuciones posteriores aprobaron las 14 etapas, incluida la comprobación adicional de error visible tras cerrar cuenta. No fue necesario corregir código funcional de Inventario en esta fase.

Última ejecución completa: esquema `inventory_e2e_ece84bc409e56227`; artefactos en `C:\Users\danie\AppData\Local\Temp\vitrinaya-inventory-e2e-HtP1r3`. Incluye JSON de resultados y capturas a 1280/320/390 px. El JSON no contiene contraseñas, cookies, tokens, cuerpos de autenticación ni URLs con credenciales.

## Migraciones y comprobaciones generales

La migración `20261118000000_inventory_movement_consistency` se verificó en PostgreSQL 17.11, sin modificarla ni cambiar migraciones anteriores. Además del esquema nuevo del E2E, el ensayo PostgreSQL pasó sus 12 etapas sobre fixtures de catálogo y movimientos preexistentes. Esto no acredita bases remotas, otras versiones de PostgreSQL ni datos ajenos a los esquemas aislados.

API: 213 pruebas aprobadas, build y `tsc --noEmit` correctos. Frontend: 17 comprobaciones existentes y la regresión de reintentos aprobadas, build Turbopack y tipos correctos; lint sin errores, con cuatro advertencias previas sobre imágenes públicas. No existen scripts independientes `typecheck` ni `lint` de API. El watcher de Webpack emitió avisos al escanear archivos de sistema de Windows desde la copia temporal; no impidieron compilar ni aprobar el E2E.

## Decisión del MVP local: recargas

Para el **MVP local, manual y sin Ventas**, se mantiene la conciliación manual en vez de persistir reintentos en el navegador. La pantalla avisa antes de operar que tras recargar se debe revisar el historial; el E2E verifica ese procedimiento con una respuesta realmente perdida después del commit. No existe reenvío automático al recargar ni al iniciar sesión de nuevo.

Al recargar/cerrar la pestaña se pierde el borrador y su clave. Registrar otra vez los mismos campos constituye **otra operación** y puede duplicar un movimiento si se ignora el historial. No se promete exactamente una vez entre recargas; no se guardan motivos ni credenciales en localStorage/sessionStorage.

Ventas deberá persistir **en servidor** un identificador por venta/evento y vincularlo al movimiento dentro de su transacción. Si se requiere recuperación automática de movimientos manuales entre recargas, ampliar el alcance con operaciones pendientes en servidor y revisión de privacidad; no guardar formularios sensibles en el navegador.

## Propuesta de retención tras cierre — no implementada

1. Mantener revocación inmediata de acceso y escrituras. Cerrar una cuenta no debe poner saldos a cero ni fabricar salidas.
2. Conservar provisionalmente **12 meses desde `closedAt`** el ledger técnico para soporte/conciliación: IDs internos, fechas, tipos, cantidades y snapshots.
3. Separar anonimización de texto libre y ledger numérico. Motivos, nombres y SKU pueden contener datos personales: acordar su revisión/anonimización sin cambiar cantidades ni el historial comercial registrado.
4. Restringir el acceso posterior a soporte autorizado; no crear accesos públicos ni reutilizar la sesión anterior.
5. Al terminar la retención, aplicar la eliminación/anonimización aprobada, revisando casos que necesiten conservación adicional. No añadir ahora borrados automáticos ni cambiar el worker existente.

La duración, momento de anonimizar y acceso de soporte requieren decisión de producto antes de implementación. El E2E comprueba conservación actual, sin ejecutar esta propuesta.

## Siguiente tarea preparada: contrato de Ventas

Antes de implementarlo, acordar:

- Cuándo descontar: registrar o confirmar la venta. Conservar la política de pedidos del catálogo hasta autorizar su integración.
- Fuente persistida y autorizada de precios: inventario todavía no tiene precio. Totales e instantáneas se calcularán en servidor.
- Estados/transiciones; cancelaciones y devoluciones mediante movimientos compensatorios, sin editar el ledger anterior.
- ID idempotente persistido por evento y transacción conjunta de venta, líneas, totales y movimiento.
- Pruebas de dos ventas concurrentes, stock insuficiente, reintentos y cancelación repetida, siempre por propietario.

No se implementó Ventas ni se autorizan despliegues con este informe.

## Archivos de esta fase

- `catalog-generator/scripts/verify-inventory-e2e.mjs`: runner nuevo.
- `catalog-generator/package.json`: solo script `test:inventory-e2e`.
- `docs/inventory-e2e.md`, `docs/inventory-verification.md` y enlace en `docs/inventory.md`.

Los demás cambios pendientes son de la fase anterior y se conservaron. Sin commits, push, despliegues ni cambios en producción.
