# Runbook: Gastos F1b, gastos fijos y pagos programados (`20261126000000_scheduled_expense_payments`)

Preparado el 26 de noviembre de 2026 para que el responsable aplique en producción la migración de F1b y publique el código de la rama `f1b-scheduled`. Lo ejecuta **una sola persona**, paso a paso, deteniéndose ante cualquier resultado distinto del esperado. Este documento no autoriza a ningún agente a ejecutarlo.

Reutiliza los procedimientos del [runbook de Ventas](despliegue-2026-11-ventas.md): la PowerShell dedicada con la URL leída sin eco (2.2), el volcado manual (2.1 a 2.6) y la cuenta de prueba (7.0). Sigue la misma estructura que el [runbook de F1a](despliegue-f1a-gastos.md). Complementa [despliegue](despliegue.md), [migraciones](migrations.md) y el [contrato de F1b](expenses-f1b-contract.md).

## Qué se despliega

| Pieza | Efecto |
| --- | --- |
| `20261126000000_scheduled_expense_payments` | **Solo añade**, en una transacción: el tipo `ScheduledExpenseStatus`; la tabla `scheduled_expense_payments` con 4 claves foráneas (dueño, y fijo, categoría y gasto pagado compuestas con el dueño; todas `ON DELETE RESTRICT`), 2 CHECK (`_valid_check`, `_status_check`) y 4 índices, entre ellos el único parcial `scheduled_expense_payments_occurrence_key` (`templateId`, `occurrenceDate`, sin las canceladas), que impide duplicar fechas de un fijo; la columna `expenses."scheduledPaymentId"` (nula) con su clave foránea, su índice, el único parcial `expenses_scheduledPaymentId_confirmed_key` (un solo gasto vigente por pago) y el CHECK `expenses_scheduled_source_check`; 2 funciones y 4 triggers (identidad congelada, transiciones permitidas y coherencia diferida pago ↔ gasto). No modifica filas existentes. |
| API (`catalog-api`) | `POST /expenses/scheduled/sync` (generación explícita, idempotente, segura en paralelo y limitada a 30 por minuto y cuenta); pagos programados (`GET`/`POST /expenses/scheduled`, `PATCH /:id`, `/:id/pay`, `/:id/cancel`); gastos fijos (`GET`/`POST /expenses/recurring`, `PATCH /:id`, `/:id/pause`, `/:id/resume`, `/:id/end`). Anular el gasto de un pago lo devuelve a pendiente, o lo vincula al reemplazo. `overview` añade `scheduled` y `variable`; el resumen de Inicio añade `scheduledDueSoonCount`, `scheduledOverdueCount` y `modules.scheduledExpenses`. Las lecturas no escriben. `openapi.json` incluye solo las rutas nuevas. |
| Frontend (`catalog-generator`) | En Gastos: `sync` antes de leer, tarjetas «Fijos pagados», «Variables» y «Próximos pagos», franja «Vencidos», chip «Fijos», insignia «Fijo», tarjeta «Gastos fijos» con «Marcar pagado» y «Administrar», y los diálogos «Programar pago» y «Marcar pagado». En Inicio: `sync` antes del resumen y las filas «n pagos vencen esta semana» y «n pagos vencidos». |

**Ensayo de la migración (26/11/2026):** `npm.cmd run test:scheduled-postgres` sobre la cadena completa de 41 migraciones en un clúster PostgreSQL local desechable, sin deriva entre el esquema y `schema.prisma`. Cubre esquema, API y cifras:
- restricciones y triggers;
- `sync` en paralelo sin duplicados;
- pagar dos veces da un solo gasto;
- anular con y sin reemplazo;
- aislamiento entre cuentas;
- los programados no suman;
- el resumen es de solo lectura.

También pasaron `test:expenses-postgres` (F1a con las migraciones posteriores) y `test:dashboard-postgres`.

**Compatibilidad y orden: migración → push → API *Live* → frontend.**
- El código publicado hoy funciona con el esquema nuevo: la columna nueva es nula, el CHECK y los triggers nuevos solo actúan sobre filas con `scheduledPaymentId`, y la tabla nueva no la usa nadie.
- La API nueva **necesita** la migración. Sin ella, `GET /expenses` y el resto de Gastos responden 503, porque Prisma lee `scheduledPaymentId`; `overview` responde 503 y **el resumen de Inicio responde 500**, porque cuenta los pagos programados. Por eso la migración va antes del push.
- El frontend nuevo **necesita** la API nueva. Con la API anterior, `sync` devuelve 404 y aparece el aviso discreto; la tarjeta «Gastos fijos» muestra un error, y las cifras de Gastos dan «La respuesta de gastos no es válida» porque `overview` no trae `scheduled`. No hay riesgo para los datos, pero comprueba Render antes que Vercel.

## 0. Preparación (sin tocar producción)

```powershell
git status                          # limpio
git log --oneline --first-parent -8 f1b-scheduled
```

Esperado, en orden descendente:
1. «docs F1b: runbook de despliegue…»;
2. «F1b-4: interfaz…» (`bda2bc6`);
3. «F1b-3: cifras…» (`f9d09a6`);
4. «F1b-2: API…» (`823edb1`);
5. «F1b-1: migración…» (`ca2325d`);
6. `9b529c1` (correcciones del planificador);
7. `ba646c3` (contrato aprobado).

`git merge-base --is-ancestor origin/main f1b-scheduled` debe terminar sin error. Si `main` recibió commits después de crear la rama, actualízala primero.

Verifica localmente la versión que se publicará:

```powershell
cd catalog-api;        npm.cmd ci; npm.cmd run build; npm.cmd test
cd ..\catalog-generator; npm.cmd ci; npm.cmd run lint; npm.cmd run build; npm.cmd test
```

Opcional, con un clúster local de prueba (nunca producción):

```powershell
cd catalog-api; npm.cmd run build
'postgresql://<usuario>@127.0.0.1:<puerto>/catalogo_test' | npm.cmd run test:scheduled-postgres
```

Anota el SHA que hoy sirve producción en Render y en Vercel.

## 1. Consulta previa de solo lectura

En Supabase → SQL Editor de producción, abre [`docs/sql/verify-scheduled-preflight.sql`](sql/verify-scheduled-preflight.sql). Es `READ ONLY` y termina en `ROLLBACK`. Ejecuta cada `SELECT` por separado.

| Consulta | Esperado | Si no se cumple |
| --- | --- | --- |
| 1. Objetos que crea la migración | 0 filas. | Algún objeto ya existe y la migración fallaría completa: **no migres** y revisa de dónde viene. |
| 2. Columna `expenses.scheduledPaymentId` | 0 filas. | Igual que la 1. |
| 3. Registro de esta migración | 0 filas. | Alguien la aplicó o la intentó: revisa `finished_at` y `rolled_back_at` (paso 4). |
| 4. Migración de F1a | Una fila con `aplicada = true` y `revertida = false`. | F1a no está aplicada: **detente** y sigue antes el [runbook de F1a](despliegue-f1a-gastos.md). |
| 5. Volumen de Gastos | Informativo. | — |

## 2. Respaldo: volcado manual obligatorio

El plan de Supabase es Free: no hay copias automáticas recuperables. Haz el volcado de los pasos **2.1 a 2.4** del runbook de Ventas en la PowerShell dedicada y regístralo: fecha, tamaño, ruta fuera del repositorio y SHA-256, nunca la URL. Sin volcado verificado no se migra.

## 3. Aplicar la migración

En la misma PowerShell dedicada, dentro de `catalog-api`, con `f1b-scheduled` activa y `$env:DATABASE_URL` cargada según 2.2 (conexión directa o *Session pooler*, nunca el puerto 6543):

```powershell
npm.cmd exec prisma -- migrate status
```

Esperado: **exactamente una** pendiente, `20261126000000_scheduled_expense_payments`. Si hay cualquier otra pendiente o fallida, detente.

```powershell
npm.cmd run prisma:migrate:deploy
npm.cmd exec prisma -- migrate status
```

Esperado: `All migrations have been successfully applied` y después `Database schema is up to date!`.

En el SQL Editor, repite las consultas previas:
- **Consulta 1:** ahora debe listar **9 filas**: 1 `table`, 1 `type`, 2 `function`, 2 `index`, 2 `constraint` y 1 `trigger`.
- **Consulta 2:** debe devolver una fila.
- **Consulta 3:** debe mostrar una fila con `finished_at` y sin `rolled_back_at`.

Retira la variable y cierra la ventana: `Remove-Item Env:DATABASE_URL; $dumpUrl = $null`.

No uses `migrate dev`, `db push`, `migrate reset` ni `migrate resolve --applied` contra producción.

## 4. Si falla: P3018 / P3009

La migración es una sola transacción (`BEGIN … COMMIT`): si falla, **no deja cambios parciales**.

1. `migrate deploy` muestra `P3018`. Un nuevo intento mostraría `P3009`: no reintentes a ciegas.
2. Repite la consulta previa. Lo esperable es un objeto con el mismo nombre (consulta 1 o 2 con filas) o un permiso insuficiente del usuario de conexión.
3. Confirma que las consultas 1 y 2 vuelven a dar 0 filas: nada quedó creado.
4. Marca la migración como revertida:

   ```powershell
   npm.cmd exec prisma -- migrate resolve --rolled-back 20261126000000_scheduled_expense_payments
   ```

5. **No publiques el código** hasta resolver la causa. No crees ni borres objetos a mano para «hacer sitio»: cualquier cambio de esquema se hace con una migración nueva revisada.

## 5. Publicar el código

Solo después de que el paso 3 termine bien:

```powershell
git switch main
git merge --ff-only f1b-scheduled
git push origin main
```

## 6. Comprobar Render y después Vercel

1. **Render:** un deploy *Live* para el SHA del último commit de `f1b-scheduled`, logs de arranque sin errores de Prisma, y `GET https://<API>/api/health` → 200.
2. Solo entonces **Vercel:** un deployment *Ready* para el mismo SHA, asignado al dominio de producción. Si Vercel terminó antes que Render, no abras Gastos ni Inicio hasta que Render esté *Live*.

Compara ambos SHA con los del paso 0.

## 7. Prueba de humo por la interfaz, en la cuenta de prueba

Hazla en la **cuenta de prueba** (ventana privada, ver 7.0 del runbook de Ventas), nunca en la cuenta real: los pagos y gastos no se borran y quedan en el historial. No escribas datos personales en descripciones, proveedor ni referencia. Usa el prefijo `HUMO`.

1. **Apertura.** Abre Gastos.
   - Aparecen «Gastos del mes», «Fijos pagados» (con «0 de 0 · Sin gastos fijos este mes» si es el primero), «Variables» y «Próximos pagos».
   - Aparecen el chip «Fijos» y la tarjeta «Gastos fijos» con «Administrar».
   - El total de «Gastos del mes» es el mismo que antes del despliegue.
   - No aparece el aviso «No pudimos actualizar los gastos fijos».
2. **Pago único.** Pulsa «Programar pago» y completa:
   - monto `50.000`;
   - vencimiento dentro de 3 días;
   - categoría «Papelería e insumos»;
   - descripción «HUMO PAGO ÚNICO».

   Pulsa «Guardar pago programado».
   - Esperado: «Pago programado…», la fila con la insignia «Único» y «Vence en 3 días», y «Próximos pagos» con `$ 50.000` más lo que ya hubiera.
   - **«Gastos del mes» no cambia.**
3. **Gasto fijo.** Pulsa «Programar pago» y completa:
   - monto `30.000`;
   - vencimiento hoy;
   - categoría «Internet y telefonía»;
   - descripción «HUMO FIJO»;
   - «Repetir» cada 1 mes.

   Pulsa «Guardar gasto fijo».
   - Esperado: la fila «HUMO FIJO» con «Vence hoy», y «Fijos pagados» con «0 de 1» (o uno más de los que hubiera).
4. **Marcar pagado con otro monto.** En «HUMO FIJO», pulsa «Marcar pagado».
   - El monto llega precargado como `30.000` y la fecha es la de hoy, sin poder elegir una futura.
   - Cambia el monto a `31.000`: aparece «El monto previsto era $ 30.000». Pulsa «Confirmar pago».
   - Esperado: el mensaje «… quedó pagado y se registró como gasto», la fila en «Pagado», «Fijos pagados» sumando uno y `$ 31.000`, y «Gastos del mes» con `$ 31.000` más.
   - En la lista aparece «HUMO FIJO» con la insignia «Fijo», y el chip «Fijos» lo muestra.
5. **Anular devuelve a pendiente.** Abre el gasto «HUMO FIJO» de la lista: dice «Pago de un gasto fijo». Anúlalo sin reemplazo, con el motivo «Humo prueba».
   - Esperado: el total vuelve a su valor anterior y la fila de «Gastos fijos» vuelve a «Vence hoy» con «Marcar pagado».
   - Márcalo pagado otra vez con `30.000`.
6. **Reprogramar y omitir.** En «HUMO PAGO ÚNICO», abre las opciones (pulsa la fila) y elige «Reprogramar» a dentro de 5 días: aparece «Vence en 5 días». Ábrelas de nuevo y elige «Omitir este pago» → «Sí, omitir este pago». La fila desaparece y no se registra ningún gasto.
7. **Administrar.** En «Administrar» aparece «HUMO FIJO» con «Cada mes». Pausa y reanuda, y termina con «Terminar» → «Sí, terminar». El gasto ya pagado sigue en la lista y en los totales.
8. **Inicio.** Abre Inicio.
   - Si la cuenta tiene pagos pendientes en los próximos 7 días o vencidos, «Requiere tu atención» muestra «n pagos vencen esta semana» o «n pagos vencidos», con «Ver», que lleva a Gastos.
   - La «Utilidad del mes» solo resta los gastos pagados.
9. **Móvil.** A 390 px de ancho, o en el teléfono:
   - las tarjetas quedan apiladas;
   - la tarjeta «Gastos fijos» se lee sin desplazamiento horizontal;
   - «Marcar pagado» se puede pulsar;
   - «Registrar gasto» queda sobre la barra inferior.

Si un paso falla, anota el mensaje que muestra el panel y **no reviertas el esquema**.

## 8. Cierre

- Anota en [estado](estado.md) la fecha, los SHA publicados, el registro del volcado y el resultado de la prueba de humo.
- Los datos de prueba quedan en la cuenta de prueba con el prefijo `HUMO`:
  - el gasto fijo, terminado;
  - el pago único, omitido;
  - un gasto pagado y uno anulado.
- Conserva el volcado hasta confirmar que producción funciona con normalidad y luego aplica tu política de borrado: contiene datos personales.

## Recuperación de aplicación

- Volver al código anterior es compatible con el esquema nuevo: la tabla y la columna nuevas quedan sin uso. No hace falta revertir la migración.
- Con el código anterior, los gastos creados al pagar un programado siguen siendo gastos normales y siguen sumando. Los pagos pendientes no se ven hasta volver a publicar F1b.
- No borres la tabla, la columna ni los triggers por SQL para «volver atrás»: se perderían los vínculos entre pagos y gastos. Cualquier cambio posterior va en una migración nueva revisada.
- Restaurar el volcado sobre producción pierde todas las escrituras posteriores (ventas, inventario, pedidos y gastos) y es el último recurso, con decisión explícita (2.6 del runbook de Ventas).
