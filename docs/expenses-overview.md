# Resumen mensual de Gastos: `GET /api/expenses/overview`

Lectura privada y mínima que usa la página de Gastos (`/dashboard/gastos`). Entrega agregados que los endpoints de F1a no devuelven:
- el total por día del mes, para la minigráfica;
- el reparto por categoría con su porcentaje;
- el total del mes anterior.

No cambia los endpoints ni las reglas de F1a ([contrato v1.2](expenses-contract.md)). Todo se calcula en el servidor y el navegador nunca suma páginas parciales.

Código: `catalog-api/src/repositories/expense-overview.repository.ts`. Se registra en `expense.service.ts`, `expense.controller.ts` y `expense.routes.ts`.

## Petición

`GET /api/expenses/overview?month=YYYY-MM`.
- `month` es obligatorio y va de `2000-01` a 12 meses después del mes actual en Bogotá.
- Un mes más allá de ese límite, otro formato, un parámetro repetido o un parámetro desconocido (incluido `ownerId`) dan 400 `INVALID_EXPENSE_INPUT`.
- Sin sesión, 401. Ante un fallo de base de datos, 503 `EXPENSE_RETRY_SAME_OPERATION`, con el mismo formato que el resto de Gastos.
- `Cache-Control: private, no-store`. El propietario sale siempre de la sesión.

## Respuesta

```json
{ "success": true, "result": {
  "month": "2026-11", "from": "2026-11-01", "to": "2026-11-25", "generatedAt": "…", "future": false,
  "total": "980000", "count": 14, "voidedCount": 1,
  "previousMonth": { "month": "2026-10", "total": "1000000" },
  "days": [{ "date": "2026-11-01", "total": "600000" }],
  "byCategory": [{ "categoryId": "…", "name": "Arriendo", "archived": false, "total": "600000", "count": 1, "percent": "61" }],
  "scheduled": { "fixed": { "due": 5, "paid": 3, "paidTotal": "720000" },
                 "upcoming": { "count": 2, "plannedTotal": "310000", "withoutAmount": 0 },
                 "overdue": { "count": 0, "plannedTotal": "0", "withoutAmount": 0 },
                 "planned": null, "projected": [] },
  "variable": { "total": "260000", "count": 14 }
} }
```

## Definiciones

- **Qué suma:** solo los gastos `CONFIRMED` (vigentes), por `expenseDate`, que en F1a es una fecha de calendario de Bogotá. Los `VOIDED` no suman y se cuentan en `voidedCount`; `PENDING_CONFIRMATION` y `SKIPPED` (F1b) no cuentan.
- **Rango:** el mes actual va del día 1 a hoy; un mes pasado o futuro, completo. `previousMonth` es el mes de calendario anterior completo.
- **`days`:** un punto por día de `from` a `to`, con `"0"` en los días sin gastos.
- **`byCategory`:** solo las categorías con gastos vigentes en el mes, incluidas las archivadas (`archived: true`). Se ordenan por total de mayor a menor y, si empatan, por nombre.
- **`percent`:** `round(total de la categoría × 100 / total del mes)`, redondeando la mitad hacia arriba, calculado con BigInt y devuelto como string entero. La suma puede no dar exactamente 100.
- **Importes:** strings decimales.

## Pagos programados y gastos variables (F1b)

Definiciones en el [contrato de F1b](expenses-f1b-contract.md#8-cifras). **Los pagos programados nunca suman en `total`**: solo cuenta el gasto `CONFIRMED` creado al pagarlos, en su `expenseDate`.

| Campo | Definición |
| --- | --- |
| `scheduled.fixed` | Ocurrencias de gastos fijos con `dueDate` en el mes completo, en `PENDING` o `PAID` (`due` = m, `paid` = n). `paidTotal` suma los gastos vinculados a las `PAID`. |
| `scheduled.upcoming` | `PENDING` (fijos y únicos) con vencimiento entre hoy y hoy + 7 (decisión F1b-2). `plannedTotal` suma los montos previstos conocidos; `withoutAmount` cuenta los que no tienen. Relativo a hoy en cualquier mes consultado. |
| `scheduled.overdue` | `PENDING` vencidos (antes de hoy), de cualquier mes. Relativo a hoy en cualquier mes consultado. |
| `future` | `true` si el mes es posterior al actual. Entonces `total`, `count`, `variable` y los días valen 0: ningún gasto tiene fecha futura. |
| `scheduled.planned` | Solo en meses futuros (si no, `null`): `count`, `plannedTotal` y `withoutAmount` de los `PENDING` del mes más las fechas proyectadas, y `projectedCount`. |
| `scheduled.projected` | Solo en meses futuros (si no, `[]`): fechas de gastos fijos `ACTIVE` que `sync` todavía no generó, calculadas en memoria y nunca guardadas (`templateId`, `dueDate`, `description`, `plannedAmount`, `categoryId`, `categoryName`, `paymentMethod`, `frequency`, `interval`). |
| `variable` | Gastos `CONFIRMED` del rango del mes sin `scheduledPaymentId`. |

La lectura sigue siendo de solo lectura: no genera ocurrencias ni llama a `sync`; la proyección se calcula en memoria dentro de la misma transacción (reglas en el [contrato, sección 16](expenses-f1b-contract.md#16-meses-futuros-y-proyección-cierre-de-f1b)). La página llama antes a `POST /api/expenses/scheduled/sync`.

Ejemplo de un mes futuro:

```json
{ "month": "2027-01", "from": "2027-01-01", "to": "2027-01-31", "future": true, "total": "0", "count": 0,
  "scheduled": { "fixed": { "due": 0, "paid": 0, "paidTotal": "0" }, "upcoming": { "…": "…" }, "overdue": { "…": "…" },
    "planned": { "count": 3, "plannedTotal": "710000", "withoutAmount": 1, "projectedCount": 2 },
    "projected": [{ "templateId": "…", "dueDate": "2027-01-10", "description": "Arriendo", "plannedAmount": "600000", "categoryId": "…",
      "categoryName": "Arriendo", "paymentMethod": "BANK_TRANSFER", "frequency": "MONTHLY", "interval": 1 }] },
  "variable": { "total": "0", "count": 0 } }
```

## Consultas y pruebas

- **Consultas:** una transacción de solo lectura `RepeatableRead` con el reloj de la base y una sola consulta agregada; en meses futuros, además, dos lecturas filtradas por dueño (fijos `ACTIVE` y ocurrencias existentes del mes) para la proyección. Las tablas `expenses` y `expense_categories` se filtran por el dueño como parámetro.
- **`src/services/expense-overview.test.ts`:**
  - validación de la query;
  - límites de mes (28, 29, 30 y 31 días, y enero frente a diciembre);
  - porcentajes con BigInt e importes mayores que 2^53;
  - respuestas crudas inválidas y filtro por dueño en el SQL;
  - ruta: 401, 400, dueño de la sesión, `no-store` y 503.
- **`test:dashboard-postgres`, etapa `EXPENSES_OVERVIEW`, sobre filas reales de F1a:**
  - total de confirmados, con los anulados aparte;
  - mes anterior;
  - un punto por día (31 o 28);
  - porcentaje por categoría;
  - aislamiento por dueño.
- **`test:scheduled-postgres`, etapas `FUTURE_*`:** pendientes generados más proyectados sin repetir fechas generadas; fijos pausados y terminados sin proyección; un fijo que termina a mitad de mes no se proyecta después de su fin; mensual del 31 en un mes de 30 días; aislamiento por dueño; la lectura no crea filas ni mueve `generatedThrough`. La validación de 12 meses (400 más allá) está en `expense-overview.test.ts`.
