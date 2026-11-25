# Resumen de Inicio: `GET /api/dashboard/summary`

Endpoint privado y de solo lectura con las cifras de la pantalla de Inicio, calculadas en el servidor.

- **Propietario:** siempre el de la sesión; ningún parámetro lo cambia.
- **Formato:** importes en COP como strings decimales calculados con BigInt, fechas en ISO 8601 y días de calendario de `America/Bogota`.
- **Caché:** `Cache-Control: private, no-store`.

Código:
- `catalog-api/src/routes/dashboard.routes.ts`
- `catalog-api/src/services/dashboard-summary.ts` (validación, definiciones y presentación)
- `catalog-api/src/repositories/dashboard-summary.repository.ts` (SQL)

## Petición y errores

| Caso | Respuesta |
| --- | --- |
| `?days=7`, `30` o `90` (por defecto `7`) | 200 con el resumen; `salesSeries` tiene exactamente `days` puntos |
| Sin sesión o sesión expirada | 401, formato del middleware de autenticación |
| `days` con otro valor, parámetros desconocidos (incluido `ownerId`), repetidos o anidados | 400 `INVALID_DASHBOARD_QUERY` |
| Fallo de base de datos | 500 `DASHBOARD_UNAVAILABLE`. El log solo lleva el código, sin detalles ni datos personales. |

## Respuesta

```json
{
  "success": true,
  "generatedAt": "2026-11-25T17:00:00.000Z",
  "today": { "date": "2026-11-25", "salesTotal": "0", "salesCount": 0, "yesterdaySalesTotal": "0" },
  "month": { "salesTotal": "0", "costOfSales": "0", "salesWithoutCostCount": 0, "expensesTotal": null, "estimatedProfit": "0",
             "previousMonth": { "salesTotal": "0", "expensesTotal": null, "estimatedProfit": "0" } },
  "attention": { "lowStockCount": 0, "outOfStockCount": 0, "pendingOrdersCount": 0 },
  "salesSeries": [{ "date": "2026-11-19", "total": "0" }],
  "recent": [{ "kind": "SALE", "id": "…", "status": "DELIVERED", "total": "100000", "at": "…", "customerName": null }],
  "setup": { "hasInventoryItems": false, "hasPublishedCatalog": false, "hasSales": false },
  "modules": { "expenses": false }
}
```

## Definiciones

**Día y periodos**
- **Día:** fecha de calendario en Bogotá. Las fechas se guardan en UTC, así que, por ejemplo, las 23:59:59.999 de Bogotá caen en el día siguiente en UTC pero cuentan en el día de Bogotá.
- **Mes:** del día 1 del mes actual de Bogotá hasta hoy, ambos incluidos.
- **Mes anterior:** el mes de calendario anterior completo, tenga 28, 29, 30 o 31 días.

**Ventas y devoluciones**
- **Ventas de un día:** suma del `total` histórico de las ventas con confirmación (`CONFIRMED`, `DELIVERED` o `RETURNED`, es decir, también las que luego se devolvieron) cuyo `confirmedAt` cae ese día, **menos** el valor de las devoluciones registradas ese día.
  - `CANCELLED` nunca cuenta, ni siquiera el día en que se confirmó. `DRAFT` tampoco.
  - Así, una cancelación posterior cambia las cifras de días pasados.
- **Valor de una devolución:** Σ `(unitPrice − unitDiscount) × receivedQuantity` de sus líneas, tomado de la instantánea de la línea de venta.
  - Es exacto: un CHECK garantiza `lineTotal = (unitPrice − unitDiscount) × quantity`, y el descuento solo existe por línea.
  - Es el valor de venta devuelto, no un reembolso: el contrato de Ventas no registra pagos.
  - Se resta el día de la devolución, aunque la venta sea de otro día o de otro mes, así que un día o un mes pueden quedar en negativo.
- `salesCount`: ventas confirmadas hoy (las devoluciones no restan unidades).
- `salesSeries`: un punto por día del rango, del más antiguo a hoy, con `"0"` en los días sin actividad.

**Costo y utilidad**
- `costOfSales` del periodo: Σ `unitCost × quantity` de las líneas de las ventas confirmadas en el periodo, **menos** Σ `unitCost × resellableQuantity` de las devoluciones registradas en el periodo.
  - Lo revendible vuelve al inventario y deja de ser costo de venta.
  - Lo dañado mantiene su costo, que es una pérdida.
  - Las líneas sin `unitCost` no suman costo, y cada venta con al menos una de esas líneas cuenta una vez en `salesWithoutCostCount`. Ese contador solo se informa para el mes actual.
- `expensesTotal`: gastos `CONFIRMED` (F1a) por `expenseDate`; los anulados y los pendientes no cuentan.
  - Activo desde la integración de F1a (`DASHBOARD_MODULES.expenses = true` en `dashboard-summary.ts`): lee la tabla `expenses` de la migración `20261125000000_operating_expenses`. Con el interruptor apagado vale `null` y `modules.expenses` es `false`.
- `estimatedProfit` = `salesTotal − costOfSales − (expensesTotal ?? 0)`. Puede ser negativo.

**Atención, recientes y configuración**
- `lowStockCount`: artículos con `minimumStock > 0` y `0 < stock ≤ minimumStock`.
- `outOfStockCount`: artículos con `stock = 0`.
- `pendingOrdersCount`: pedidos `PENDING` sin anonimizar de cualquier catálogo del dueño, incluidos los archivados.
- `recent`: las 5 últimas ventas con confirmación, en cualquier estado salvo `DRAFT` y por `confirmedAt`. Incluye las canceladas, con su `status`. `customerName` es la instantánea o, en ventas antiguas, el nombre heredado.
- `setup.hasPublishedCatalog`: catálogo activo, no archivado y con al menos un producto activo, la misma regla que las métricas de admin.
- `setup.hasSales`: alguna venta con confirmación en cualquier estado.

## Consultas por petición

Número fijo de sentencias, todas en una transacción `READ ONLY` con aislamiento `RepeatableRead`, de modo que todas las cifras salen de la misma instantánea:
1. `SET TRANSACTION READ ONLY`
2. `SET LOCAL statement_timeout = '3000ms'`
3. `SELECT CURRENT_TIMESTAMP`, el reloj de la base, que también da `generatedAt`.
4. El resumen: una sola consulta SQL con CTE que agrega en PostgreSQL y devuelve `jsonb`, con los importes como `numeric::text`.
5. Con el módulo de gastos activo (hoy lo está), una consulta más sobre `expenses`.

No hay N+1. Todas las tablas propias se filtran por el dueño como parámetro (8 apariciones en el resumen y 1 en gastos).

## Ensayo y EXPLAIN

`'postgresql://<usuario>@127.0.0.1:<puerto>/catalogo_test' | npm.cmd run test:dashboard-postgres`, después de `npm.cmd run build`. Solo admite una base local `catalogo_test`.

**Qué comprueba**, sobre las 39 migraciones en un esquema desechable:
- bordes de las 23:59:59.999 y las 00:00 de Bogotá;
- meses de 28, 29, 30 y 31 días;
- canceladas y borradores excluidos;
- devoluciones en otro día y otro mes;
- ventas sin costo e importes mayores que 2^53;
- tres cuentas aisladas, una de ellas nueva y sin datos;
- el módulo de gastos sobre filas reales de F1a (confirmados y anulados), con bordes de mes de Bogotá y aislamiento por dueño;
- EXPLAIN.

**Resultado del 25/11/2026**, con 200 000 ventas, 20 000 de ellas del dueño:
- Dueño con 20 000 ventas y rango de 90 días: **43 ms**. Para `hasSales` el planificador elige una lectura secuencial que se detiene en la primera fila (0,011 ms).
- Cuenta sin ventas: **0,37 ms**, sin lectura secuencial de `"Sale"`. `hasSales` y `recent` filtran con `status IN (…)` para poder usar el índice `("userId", status, "createdAt")`.

**Índice propuesto (no aplicado):** `CREATE INDEX CONCURRENTLY "Sale_userId_confirmedAt_idx" ON "Sale" ("userId", "confirmedAt")`. Convertiría en lecturas de rango la ventana de ventas y `recent` (`ORDER BY confirmedAt DESC LIMIT 5`), que hoy filtran por `userId` y ordenan en memoria. Con los volúmenes medidos no hace falta. Conviene revisarlo si una cuenta pasa de unas 100 000 ventas.
