# Runbook: Gastos F1a (`20261125000000_operating_expenses`)

Preparado el 24 de noviembre de 2026 para que el responsable aplique en producción la migración de Gastos y publique el código de la rama `f1-expenses`. Lo ejecuta **una sola persona**, paso a paso, deteniéndose ante cualquier resultado distinto del esperado. Este documento no autoriza a ningún agente a ejecutarlo.

Reutiliza los procedimientos del [runbook de Ventas](despliegue-2026-11-ventas.md): la PowerShell dedicada con la URL leída sin eco (2.2), el volcado manual (2.3 a 2.6) y la cuenta de prueba (7.0). Aquí solo se indica lo que cambia. Complementa [despliegue](despliegue.md), [migraciones](migrations.md) y el [contrato de Gastos v1.2](expenses-contract.md).

## Qué se despliega

| Pieza | Efecto |
| --- | --- |
| `20261125000000_operating_expenses` | **Solo añade**: 5 tablas (`expense_categories`, `recurring_expense_templates`, `expenses`, `expense_operations`, `expense_events`), 5 tipos enum, 10 CHECK, 3 funciones y 5 triggers (historial inmutable, columnas de identidad congeladas, sin borrado, transiciones de estado). No toca tablas existentes ni datos. Una sola transacción. |
| API (`catalog-api`) | Endpoints de categorías (`GET`, `seed`, crear, renombrar/ordenar, archivar, reactivar) y de gastos (listar, resumen, detalle, registrar, reclasificar, anular con reemplazo opcional), con parser de 16 KiB propio. Sin endpoints de plantillas recurrentes. |
| Frontend (`catalog-generator`) | Enlace «Gastos» en la cabecera y la pantalla `/dashboard/gastos`. Hook común de envío seguro (Ventas lo usa a través de un adaptador, sin cambio de comportamiento). |

La migración se ensayó el 24/11/2026 sobre la cadena completa de 40 migraciones en PostgreSQL local (`npm.cmd run test:expenses-postgres`, 14/14 etapas, incluida la matriz de dos cuentas y `EXPLAIN` con 20 000 filas).

**Compatibilidad y orden: migración → push → API *Live* → frontend.**
- El código publicado hoy funciona con el esquema nuevo: las tablas nuevas no las usa nadie.
- La API nueva **necesita** la migración: sin las tablas, todos los endpoints de Gastos responden 503 (`EXPENSE_RETRY_SAME_OPERATION`) o 500. El resto de la API no se ve afectado.
- El frontend nuevo **necesita** la API nueva: con la API anterior, al abrir Gastos la siembra de categorías devuelve 404 y la pantalla muestra un error con «Reintentar cargar categorías». No hay riesgo para los datos, pero comprueba Render antes que Vercel.

## 0. Preparación (sin tocar producción)

Igual que el paso 0 del runbook de Ventas, con la rama `f1-expenses`:

```powershell
git status                          # limpio
git log --oneline -7 f1-expenses
```

Esperado, en orden descendente: F1a-5 (este documento), F1a-4 (interfaz), F1a-3 (ensayo PostgreSQL), F1a-2 (API), F1a-1 (migración y consulta previa) y `db5e8e7` (contrato v1.1), sobre `b177f12`, que es `main`.

Verifica localmente la versión que se publicará:

```powershell
cd catalog-api;        npm.cmd ci; npm.cmd run build; npm.cmd test
cd ..\catalog-generator; npm.cmd ci; npm.cmd run lint; npm.cmd run build; npm.cmd test
```

Opcional, con un clúster local de prueba (nunca producción): `'postgresql://<usuario>@127.0.0.1:<puerto>/catalogo_test' | npm.cmd run test:expenses-postgres`.

Anota el SHA que hoy sirve producción en Render y en Vercel.

## 1. Consulta previa de solo lectura

En Supabase → SQL Editor de producción, abre [`docs/sql/verify-expenses-preflight.sql`](sql/verify-expenses-preflight.sql). Es `READ ONLY` y termina en `ROLLBACK`. Ejecuta cada `SELECT` por separado.

| Consulta | Esperado | Si no se cumple |
| --- | --- | --- |
| 1. Objetos que crea la migración | 0 filas. | Algún objeto ya existe y la migración fallaría completa: **no migres** y revisa de dónde viene. |
| 2. Registro de esta migración | 0 filas. | Alguien la aplicó o la intentó: revisa `finished_at` y `rolled_back_at` (paso 4). |
| 3. Migraciones de Ventas | Las tres con `aplicada = true` y `revertida = false`. | Hay una migración anterior pendiente o fallida: **detente**; este runbook no la cubre. |

## 2. Respaldo: volcado manual obligatorio

El plan de Supabase es Free: no hay copias automáticas recuperables. Haz el volcado de los pasos **2.1 a 2.4** del runbook de Ventas en la PowerShell dedicada y regístralo (fecha, tamaño, ruta fuera del repositorio, SHA-256; nunca la URL). Sin volcado verificado no se migra.

## 3. Aplicar la migración

En la misma PowerShell dedicada, dentro de `catalog-api`, con `f1-expenses` activa y `$env:DATABASE_URL` cargada según 2.2 (directa o *Session pooler*, nunca el puerto 6543):

```powershell
npm.cmd exec prisma -- migrate status
```

Esperado: **exactamente una** pendiente, `20261125000000_operating_expenses`. Cualquier otra pendiente o fallida: detente.

```powershell
npm.cmd run prisma:migrate:deploy
npm.cmd exec prisma -- migrate status
```

Esperado: `All migrations have been successfully applied` y después `Database schema is up to date!`.

En el SQL Editor, repite la consulta 1: ahora debe listar **18 filas** (5 `table`, 5 `type`, 3 `function`, 5 `trigger`). La consulta 2 debe mostrar una fila con `finished_at` y sin `rolled_back_at`.

Retira la variable y cierra la ventana: `Remove-Item Env:DATABASE_URL; $dumpUrl = $null`.

No uses `migrate dev`, `db push`, `migrate reset` ni `migrate resolve --applied` contra producción.

## 4. Si falla: P3018 / P3009

La migración es una sola transacción (`BEGIN … COMMIT`): si falla, **no deja cambios parciales**.

1. `migrate deploy` muestra `P3018`. Un nuevo intento mostraría `P3009`: no reintentes a ciegas.
2. Repite la consulta previa. La causa esperable es un objeto con el mismo nombre (consulta 1 con filas) o un permiso insuficiente del usuario de conexión.
3. Confirma que la consulta 1 vuelve a dar 0 filas (nada quedó creado).
4. Marca la migración como revertida:

   ```powershell
   npm.cmd exec prisma -- migrate resolve --rolled-back 20261125000000_operating_expenses
   ```

5. **No publiques el código** hasta resolver la causa. No crees ni borres objetos a mano para «hacer sitio»: cualquier cambio de esquema se hace con una migración nueva revisada.

## 5. Publicar el código

Solo después del paso 3 correcto:

```powershell
git switch main
git merge --ff-only f1-expenses
git push origin main
```

## 6. Comprobar Render y después Vercel

1. **Render:** un deploy *Live* para el SHA de F1a-5, logs de arranque sin errores de Prisma, `GET https://<API>/api/health` → 200.
2. Solo entonces **Vercel:** un deployment *Ready* para el mismo SHA, asignado al dominio de producción. Si Vercel terminó antes que Render, no abras Gastos hasta que Render esté *Live*.

Compara ambos SHA con los del paso 0.

## 7. Prueba de humo por la interfaz, en la cuenta de prueba

En la **cuenta de prueba** (ventana privada, ver 7.0 del runbook de Ventas), nunca en la cuenta real: los gastos no se borran y quedan en el historial. No escribas datos personales en descripciones, proveedor ni referencia.

1. **Navegación y siembra.** En la cabecera aparece «Gastos», junto a Inventario y Ventas. Al abrirla se ven los avisos «Las compras de mercancía se registran como entrada de inventario…» e «IVA y retenciones no se gestionan…». En «Categoría» del formulario aparecen las 11 sugeridas, incluida **«Nómina y honorarios»**. Recargar la página no las duplica.
2. **Registrar.** Fecha de hoy, monto `12.345`, categoría «Papelería e insumos», medio Efectivo, descripción «HUMO GASTO 1», referencia «HUMO-REF». Pulsa «Registrar gasto».
   - Esperado: «Gasto registrado.», el detalle abierto con monto `$ 12.345` y la referencia visible **solo** en el detalle (no en el listado).
3. **Filtros y totales.** Con «Este mes», el total confirmado es la suma de los gastos de prueba del mes (si es el primero, `$ 12.345`). Filtra por medio «Nequi»: el gasto desaparece y el total baja. Vuelve a «Todos».
4. **Reclasificar.** Registra un segundo gasto: monto `5.000`, medio «Otro» con nota «Humo nota A», descripción «HUMO GASTO 2». En su detalle pulsa «Reclasificar», cambia la categoría a «Otros gastos» y la nota a «Humo nota B», y guarda.
   - Esperado: «Gasto reclasificado.», y en «Historial» las líneas «Categoría: «…» → «Otros gastos»» y «Nota del medio de pago: «Humo nota A» → «Humo nota B»». El monto no cambia.
5. **Anular y reemplazar.** En «HUMO GASTO 1» pulsa «Anular gasto», escribe el motivo «Humo monto equivocado», marca «Registrar el gasto correcto al anular», cambia el monto a `12.000` y pulsa «Anular y registrar el correcto».
   - Esperado: «Gasto anulado y reemplazado.», el original en «Anulado» y de solo lectura, con «Ver el gasto que lo reemplaza»; el total del mes baja en 345 y el contador muestra «1 anulado (no suman)».
6. **Archivar una categoría.** En «Categorías», crea «Humo categoría», archívala («Sí, archivar») y comprueba que **ya no aparece** en la categoría del formulario de registro, pero sí en el filtro como «(archivada)». Intenta crear «humo categoría»: aparece «Ya existe una categoría con ese nombre» y el botón «Reactivar «Humo categoría»». Reactívala y vuelve a archivarla.
7. **Móvil.** A 390 px de ancho, o en el teléfono, el formulario, el listado y el detalle se leen sin desplazamiento horizontal.

Si un paso falla, anota el mensaje que muestra el panel y **no reviertas el esquema**.

## 8. Cierre

- Anota en [estado](estado.md) la fecha, los SHA publicados, el registro del volcado y el resultado de la prueba de humo.
- Los gastos y categorías de prueba quedan en la cuenta de prueba (prefijo `HUMO`), anulados o archivados.
- Conserva el volcado hasta confirmar que producción funciona con normalidad y luego aplica tu política de borrado: contiene datos personales.

## Recuperación de aplicación

- Volver al código anterior es compatible con el esquema nuevo: las tablas de Gastos quedan sin uso. No hace falta revertir la migración.
- No borres tablas ni triggers por SQL para «volver atrás»: se perderían los gastos registrados y el historial. Cualquier cambio posterior va en una migración nueva revisada.
- Restaurar el volcado sobre producción pierde todas las escrituras posteriores (ventas, inventario, pedidos) y es el último recurso, con decisión explícita (2.6 del runbook de Ventas).
