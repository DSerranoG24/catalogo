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
2. Comprueba que tienes acceso a Supabase (SQL Editor y Backups), Render y Vercel, y la cadena de conexión de producción en un gestor seguro. No la pegues en archivos, chats ni terminales con historial compartido.
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

## 2. Respaldo

Sigue [Respaldo previo](migrations.md#respaldo-previo):

1. Supabase → Database → Backups: confirma que existe un respaldo utilizable y anota su fecha y hora.
2. Si tu plan no ofrece un respaldo reciente, crea uno lógico con la CLI de Supabase, tal como está documentado ahí. Guárdalo fuera del repositorio.
3. No sigas sin un respaldo identificado. Las migraciones son aditivas y transaccionales, pero el respaldo cubre errores de operación.

## 3. Aplicar las migraciones

En una PowerShell **nueva y dedicada**, dentro de `catalog-api`, con la rama `f0b-sale-integrity` activa:

1. Proporciona `DATABASE_URL` solo a este proceso, desde tu gestor seguro (por ejemplo, pegándola en `$env:DATABASE_URL = Read-Host`). No edites `.env` ni la imprimas. Usa la misma conexión que en migraciones anteriores: directa o *Session pooler*. **No** uses el *Transaction pooler* (puerto 6543), que no es apto para `migrate`.
2. Confirma en el panel de Supabase que el host corresponde al proyecto de producción.
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
5. Cierra esa PowerShell para que la cadena de conexión no quede en la sesión.

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

## 7. Prueba de humo

Deja registros **permanentes**: las ventas no se borran y los movimientos de inventario son inmutables. Usa un artículo con nombre inequívoco y cancela la venta al final para devolver el stock.

1. En `/dashboard/inventario`, crea el artículo **«PRUEBA HUMO VENTAS 2026-11»** con SKU `HUMO-2611`, regístrale una entrada de 3 unidades y una ficha comercial con precio 1000.
2. En la misma pestaña del panel ya autenticado, abre la consola del navegador (F12) y pega:

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
7. Repite la consulta de orígenes (paso 1): ahora aparece `SALE` con sus referencias.

Si un paso falla, anota el código HTTP y `error` (no hay datos personales en esta prueba) y **no reviertas el esquema**: con las migraciones aplicadas, una corrección es hacia adelante.

## 8. Cierre

- Anota en [estado](estado.md) la fecha de aplicación, los SHA publicados y el resultado de la prueba de humo.
- El artículo, las ventas y los movimientos de prueba quedan como datos de humo identificados por el nombre y el SKU.

## Recuperación de aplicación

- Volver al código anterior es compatible con el esquema nuevo: no necesita revertir las migraciones. Ten en cuenta que el código anterior confirma ventas sin bloquear artículos.
- No elimines las restricciones por SQL para «volver atrás»: quitar la segunda volvería a bloquear las ventas. Cualquier cambio de esquema posterior se hace con una migración nueva revisada.
- Restaurar el respaldo sobre producción pierde las escrituras posteriores; es el último recurso y requiere una decisión explícita.
