# Runbook: Pagos de la venta F2a-1, esquema (`20261126100000_sale_payments_ledger`)

Preparado el 26 de noviembre de 2026 para que el responsable aplique en producción la migración de F2a-1 y publique el código que la acompaña. Lo ejecuta **una sola persona**, paso a paso, deteniéndose ante cualquier resultado distinto del esperado. Este documento no autoriza a ningún agente a ejecutarlo.

Reutiliza los procedimientos del [runbook de Ventas](despliegue-2026-11-ventas.md): la PowerShell dedicada con la URL leída sin eco (2.2), el volcado manual (2.1 a 2.6) y la cuenta de prueba (7.0). Sigue la estructura del [runbook de F1b](despliegue-f1b.md). Complementa [despliegue](despliegue.md), [migraciones](migrations.md) y el [contrato de pagos y cartera](sales-payments-cartera-contract.md#16-esquema-f2a-1-implementado).

## Qué se despliega

| Pieza | Efecto |
| --- | --- |
| `20261126100000_sale_payments_ledger` | **Solo añade**, en una transacción con `lock_timeout` de 5 s. Crea: 4 tipos enumerados; en `"Sale"`, 3 columnas (`paymentMode` `NOT NULL DEFAULT 'LEGACY'`, `paymentTermDays` y `paymentDueDate`, nulas), el índice único `Sale_id_userId_key`, el CHECK `Sale_payment_columns_check` y el trigger `sale_payment_columns_guard`; 4 tablas nuevas (`sale_payment_entries`, `customer_credit_entries`, `sale_money_operations`, `receivable_settings`) con 10 FKs (todas `ON DELETE RESTRICT`), 6 CHECK y 18 índices contando las claves primarias (uno de ellos único parcial); 8 funciones y 14 triggers (solo inserción, guardas de inserción y comprobaciones diferidas), 3 de ellos sobre `"Sale"` y `"SaleReturnLine"`. **No modifica ninguna fila**: las ventas existentes quedan `LEGACY` por el valor por defecto, sin reescribir la tabla. |
| API (`catalog-api`) | Solo cambia el cliente de Prisma (`schema.prisma` con los modelos nuevos), el ensayo nuevo `test:sale-payments-postgres` y dos ensayos existentes que asumían cuál era la última migración. **No hay rutas nuevas ni cambios de comportamiento.** Las ventas que cree esta API siguen siendo `LEGACY`. |
| Frontend (`catalog-generator`) | Sin cambios. |

**Ensayo de la migración (26/11/2026)** en un clúster PostgreSQL 17 local desechable:
- `npm.cmd run test:sale-payments-postgres` aplica las 41 migraciones anteriores, crea ventas en los cinco estados, ejecuta la consulta previa y después aplica F2a-1. Comprueba:
  - que las ventas existentes quedan `LEGACY`, sin cambiar `version` ni `updatedAt`;
  - que no hay deriva frente a `schema.prisma`;
  - los CHECK, las FKs compuestas entre cuentas, el rechazo de `UPDATE`, `DELETE` y `TRUNCATE` en los libros y los recibos, y la unicidad de idempotencia;
  - las invariantes al confirmar la transacción, incluido el ejemplo de $300.000;
  - que el servicio de Ventas actual sigue funcionando (confirmar, entregar, devolución parcial y cancelar) y crea ventas `LEGACY` sin movimientos.

  Resultado: 21 comprobaciones correctas.
- Con la cadena de 42 migraciones también pasaron `test:sales-postgres` (24 etapas), `test:expenses-postgres` (15), `test:scheduled-postgres` y `test:dashboard-postgres`.
- **Tiempo:** con 200 000 ventas (47 MB), la sentencia más lenta (el índice único sobre `"Sale"`) tardó 105 ms y la migración completa menos de un segundo. Producción tiene muchas menos ventas.

**Bloqueos:** `ALTER TABLE "Sale" ADD COLUMN` toma un bloqueo `ACCESS EXCLUSIVE` sobre `"Sale"` hasta el `COMMIT`. Mientras dura (fracciones de segundo), las lecturas y escrituras de ventas, Inicio incluido, esperan. Si otra transacción tiene `"Sale"` ocupada, la migración espera como máximo 5 s y falla sin cambios (paso 4). Elige un momento sin ventas en curso.

**Compatibilidad y orden: migración → push → API *Live*.**
- **El código publicado hoy funciona con el esquema nuevo:**
  - no lee las columnas nuevas;
  - al insertar una venta, la base pone `LEGACY`;
  - los triggers nuevos de `"Sale"` y `"SaleReturnLine"` solo actúan sobre ventas `TRACKED`, que todavía no existen;
  - el cliente de una venta `LEGACY` se puede cambiar como hoy.

  El ensayo lo comprueba con el servicio actual.
- **La API nueva necesita la migración.** El cliente de Prisma nuevo nombra `paymentMode` en todas las lecturas y escrituras de ventas: sin la migración, Ventas, la conversión de pedidos, el historial del cliente e Inicio fallarían. Por eso la migración va antes del push.
- El frontend no cambia; Vercel puede reconstruir sin efecto.

## 0. Preparación (sin tocar producción)

```powershell
git status                          # limpio, en la rama que se va a publicar
git log --oneline -5
```

Verifica localmente la versión que se publicará:

```powershell
cd catalog-api;          npm.cmd ci; npm.cmd run build; npm.cmd test
cd ..\catalog-generator; npm.cmd ci; npm.cmd run lint; npm.cmd run build; npm.cmd test
```

Opcional, con un clúster local de prueba (nunca producción):

```powershell
cd catalog-api; npm.cmd run build
'postgresql://<usuario>@127.0.0.1:<puerto>/catalogo_test' | npm.cmd run test:sale-payments-postgres
```

Esperado: `"success": true`. Anota el SHA que hoy sirve producción en Render y en Vercel.

## 1. Consulta previa de solo lectura

En Supabase → SQL Editor de producción, abre [`docs/sql/verify-sale-payments-preflight.sql`](sql/verify-sale-payments-preflight.sql). Es `READ ONLY` y termina en `ROLLBACK`. Ejecuta cada `SELECT` por separado.

| Consulta | Esperado | Si no se cumple |
| --- | --- | --- |
| 1. Objetos que crea la migración | 0 filas. | Algún objeto ya existe y la migración fallaría completa: **no migres** y revisa de dónde viene. |
| 2. Columnas nuevas de `"Sale"` | 0 filas. | Igual que la 1. |
| 3. Registro de esta migración | 0 filas. | Alguien la aplicó o la intentó: revisa `finished_at` y `rolled_back_at` (paso 4). |
| 4. Migración de F1b | Una fila con `aplicada = true` y `revertida = false`. | F1b no está aplicada: **detente** y sigue antes el [runbook de F1b](despliegue-f1b.md). |
| 5. Ventas por estado | Informativo: anota las cifras. Todas quedarán `LEGACY`. | — |
| 6. Pares `(id, userId)` repetidos | 0 filas. | Imposible con `id` como clave primaria: si aparece algo, **detente**. |
| 7. Transacciones de más de un minuto | Idealmente 0 filas. | Espera a que terminen o elige otro momento: la migración no esperará más de 5 s por `"Sale"`. |

## 2. Respaldo: volcado manual obligatorio

El plan de Supabase es Free: no hay copias automáticas recuperables. Haz el volcado (`pg_dump`) de los pasos **2.1 a 2.4** del runbook de Ventas en la PowerShell dedicada y regístralo: fecha, tamaño, ruta fuera del repositorio y SHA-256, nunca la URL. Sin volcado verificado no se migra.

## 3. Aplicar la migración

En la misma PowerShell dedicada, dentro de `catalog-api`, con la rama que se publicará activa y `$env:DATABASE_URL` cargada según 2.2 (conexión directa o *Session pooler*, nunca el puerto 6543):

```powershell
npm.cmd exec prisma -- migrate status
```

Esperado: **exactamente una** pendiente, `20261126100000_sale_payments_ledger`. Si hay cualquier otra pendiente o fallida, detente.

```powershell
npm.cmd run prisma:migrate:deploy
npm.cmd exec prisma -- migrate status
```

Esperado: `All migrations have been successfully applied` y después `Database schema is up to date!`.

En el SQL Editor, repite las consultas previas:
- **Consulta 1:** ahora **21 filas**: 4 `table`, 4 `type`, 8 `function`, 1 `index`, 1 `constraint` y 3 `trigger`.
- **Consulta 2:** 3 filas.
- **Consulta 3:** una fila con `finished_at` y sin `rolled_back_at`.
- **Consulta 5:** las mismas cifras que antes.

Y esta, también de solo lectura:

```sql
SELECT "paymentMode", count(*) FROM "Sale" GROUP BY 1;
```

Esperado: una sola fila, `LEGACY`, con el total de ventas de la consulta 5.

Retira la variable y cierra la ventana: `Remove-Item Env:DATABASE_URL; $dumpUrl = $null`.

No uses `migrate dev`, `db push`, `migrate reset` ni `migrate resolve --applied` contra producción.

## 4. Si falla: P3018 / P3009

La migración es una sola transacción (`BEGIN … COMMIT`): si falla, **no deja cambios parciales**.

1. `migrate deploy` muestra `P3018`. Un nuevo intento mostraría `P3009`: no reintentes a ciegas.
2. Causas esperables:
   - `canceling statement due to lock timeout`: otra transacción ocupaba `"Sale"` más de 5 s;
   - un objeto con el mismo nombre (consulta 1 o 2 con filas);
   - un permiso insuficiente del usuario de conexión.
3. Confirma que las consultas 1 y 2 vuelven a dar 0 filas: nada quedó creado.
4. Marca la migración como revertida:

   ```powershell
   npm.cmd exec prisma -- migrate resolve --rolled-back 20261126100000_sale_payments_ledger
   ```

5. Si fue el bloqueo, repite desde el paso 1 en un momento sin actividad. En cualquier otro caso, **no publiques el código** hasta resolver la causa. No crees ni borres objetos a mano: cualquier cambio de esquema se hace con una migración nueva revisada.

## 5. Publicar el código

Solo después de que el paso 3 termine bien, con autorización, publica la rama en `main` (avance rápido) y empuja.

## 6. Comprobar Render

1. **Render:** un deploy *Live* para el SHA publicado, logs de arranque sin errores de Prisma, y `GET https://<API>/api/health` → 200.
2. **Vercel:** sin cambios de frontend. Si reconstruye, comprueba que el deployment quede *Ready*.

## 7. Prueba de humo, en la cuenta de prueba

En la **cuenta de prueba** (ventana privada, ver 7.0 del runbook de Ventas), nunca en la cuenta real. Usa el prefijo `HUMO`.

1. **Ventas.** Abre Vender: el listado carga, con los mismos estados y totales que antes.
2. **Venta nueva.** Crea un borrador «HUMO F2A1» con un artículo, confírmalo y entrégalo. Todo funciona como antes; no aparece nada nuevo en la interfaz.
3. **Devolución y cancelación.** Devuelve una unidad de esa venta. Crea otra venta, confírmala y cancélala con el motivo «Humo prueba». Las dos funcionan como antes.
4. **Inicio.** Las cifras de ventas, costo y utilidad son coherentes con las ventas de humo.
5. **Base de datos** (SQL Editor, solo lectura):

   ```sql
   SELECT "paymentMode", count(*) FROM "Sale" GROUP BY 1;
   SELECT count(*) FROM sale_payment_entries;
   ```

   Esperado: todas las ventas `LEGACY`, incluidas las de humo, y 0 movimientos.

Si un paso falla, anota el mensaje y **no reviertas el esquema**: vuelve al código anterior (Recuperación).

## 8. Cierre

- Anota en [estado](estado.md) la fecha, el SHA publicado, el registro del volcado y el resultado de la prueba de humo.
- Las ventas de humo quedan en la cuenta de prueba (no se borran ventas).
- Conserva el volcado hasta confirmar que producción funciona con normalidad y luego aplica tu política de borrado: contiene datos personales.

## Recuperación de aplicación

- Volver al código anterior es compatible con el esquema nuevo: las columnas y tablas nuevas quedan sin uso y las ventas siguen naciendo `LEGACY`. No hace falta revertir la migración.
- No borres tablas, columnas ni triggers por SQL para «volver atrás». Cualquier cambio posterior va en una migración nueva revisada.
- Restaurar el volcado sobre producción pierde todas las escrituras posteriores (ventas, inventario, pedidos y gastos) y es el último recurso, con decisión explícita (2.6 del runbook de Ventas).
