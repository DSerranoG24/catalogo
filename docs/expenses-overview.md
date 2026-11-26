# Resumen mensual de Gastos: `GET /api/expenses/overview`

Lectura privada y mínima que usa la página de Gastos (`/dashboard/gastos`). Entrega agregados que los endpoints de F1a no devuelven:
- el total por día del mes, para la minigráfica;
- el reparto por categoría con su porcentaje;
- el total del mes anterior.

No cambia los endpoints ni las reglas de F1a ([contrato v1.2](expenses-contract.md)). Todo se calcula en el servidor y el navegador nunca suma páginas parciales.

Código: `catalog-api/src/repositories/expense-overview.repository.ts`. Se registra en `expense.service.ts`, `expense.controller.ts` y `expense.routes.ts`.

## Petición

`GET /api/expenses/overview?month=YYYY-MM`.
- `month` es obligatorio y va de `2000-01` al mes actual en Bogotá.
- Un mes futuro, otro formato, un parámetro repetido o un parámetro desconocido (incluido `ownerId`) dan 400 `INVALID_EXPENSE_INPUT`.
- Sin sesión, 401. Ante un fallo de base de datos, 503 `EXPENSE_RETRY_SAME_OPERATION`, con el mismo formato que el resto de Gastos.
- `Cache-Control: private, no-store`. El propietario sale siempre de la sesión.

## Respuesta

```json
{ "success": true, "result": {
  "month": "2026-11", "from": "2026-11-01", "to": "2026-11-25", "generatedAt": "…",
  "total": "980000", "count": 14, "voidedCount": 1,
  "previousMonth": { "month": "2026-10", "total": "1000000" },
  "days": [{ "date": "2026-11-01", "total": "600000" }],
  "byCategory": [{ "categoryId": "…", "name": "Arriendo", "archived": false, "total": "600000", "count": 1, "percent": "61" }],
  "scheduled": { "fixed": { "due": 5, "paid": 3, "paidTotal": "720000" },
                 "upcoming": { "count": 2, "plannedTotal": "310000", "withoutAmount": 0 },
                 "overdue": { "count": 0, "plannedTotal": "0", "withoutAmount": 0 } },
  "variable": { "total": "260000", "count": 14 }
} }
```

## Definiciones

- **Qué suma:** solo los gastos `CONFIRMED` (vigentes), por `expenseDate`, que en F1a es una fecha de calendario de Bogotá. Los `VOIDED` no suman y se cuentan en `voidedCount`; `PENDING_CONFIRMATION` y `SKIPPED` (F1b) no cuentan.
- **Rango:** el mes actual va del día 1 a hoy; un mes pasado, completo. `previousMonth` es el mes de calendario anterior completo.
- **`days`:** un punto por día de `from` a `to`, con `"0"` en los días sin gastos.
- **`byCategory`:** solo las categorías con gastos vigentes en el mes, incluidas las archivadas (`archived: true`). Se ordenan por total de mayor a menor y, si empatan, por nombre.
- **`percent`:** `round(total de la categoría × 100 / total del mes)`, redondeando la mitad hacia arriba, calculado con BigInt y devuelto como string entero. La suma puede no dar exactamente 100.
- **Importes:** strings decimales.

## Pagos programados y gastos variables (F1b)

Definiciones en el [contrato de F1b](expenses-f1b-contract.md#8-cifras). **Los pagos programados nunca suman en `total`**: solo cuenta el gasto `CONFIRMED` creado al pagarlos, en su `expenseDate`.

| Campo | Definición |
| --- | --- |
| `scheduled.fixed` | Ocurrencias de gastos fijos con `dueDate` en el mes completo, en `PENDING` o `PAID` (`due` = m, `paid` = n). `paidTotal` suma los gastos vinculados a las `PAID`. |
| `scheduled.upcoming` | `PENDING` (fijos y únicos) con vencimiento entre hoy y hoy + 7 (decisión F1b-2). `plannedTotal` suma los montos previstos conocidos; `withoutAmount` cuenta los que no tienen. Solo en el mes actual; en otro mes es `null`. |
| `scheduled.overdue` | `PENDING` vencidos (antes de hoy), de cualquier mes. Solo en el mes actual; en otro mes es `null`. |
| `variable` | Gastos `CONFIRMED` del rango del mes sin `scheduledPaymentId`. |

La lectura sigue siendo de solo lectura: no genera ocurrencias. La página llama antes a `POST /api/expenses/scheduled/sync`.

## Consultas y pruebas

- **Consultas:** una transacción de solo lectura `RepeatableRead` con el reloj de la base y una sola consulta agregada. Las tablas `expenses` y `expense_categories` se filtran por el dueño como parámetro.
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
