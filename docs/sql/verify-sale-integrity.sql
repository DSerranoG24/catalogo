-- SOLO LECTURA. Comprueba si los datos actuales cumplen las reglas de las migraciones
-- 20261124100000_sale_integrity_checks, 20261124200000_inventory_movements_allow_sale_origin
-- y 20261124210000_sale_partial_returns_and_movement_roles ANTES de aplicarlas.
--
-- Uso: ejecutar completo en el editor SQL de la base que se va a migrar. No modifica
-- nada: la transacción es READ ONLY y termina en ROLLBACK. Solo devuelve IDs, nunca
-- nombres, teléfonos, correos ni motivos.
--
-- Resultado esperado para aplicar la migración: todas las filas de tipo
-- 'CHECK' con violaciones = 0. Si alguna es > 0, NO aplicar la migración: fallará
-- completa (sin cambios parciales) y hay que revisar esas filas con el responsable.
-- Las filas de tipo 'DIAGNÓSTICO' no bloquean la migración (no son CHECK), pero
-- indican incoherencias entre tablas que conviene revisar antes de construir cartera.
--
-- Los cálculos usan numeric para que un dato corrupto no provoque un error de
-- desbordamiento de bigint en lugar de contarse como violación.

BEGIN TRANSACTION READ ONLY;

WITH rules AS (
  -- "Sale" -----------------------------------------------------------------
  SELECT 'CHECK' AS kind, 'Sale_currency_check' AS rule, s.id AS row_id
    FROM "Sale" s WHERE s.currency IS DISTINCT FROM 'COP'
  UNION ALL
  SELECT 'CHECK', 'Sale_amounts_nonnegative_check', s.id
    FROM "Sale" s WHERE s.subtotal < 0 OR s."discountTotal" < 0 OR s.total < 0
  UNION ALL
  SELECT 'CHECK', 'Sale_discount_within_subtotal_check', s.id
    FROM "Sale" s WHERE s."discountTotal" > s.subtotal
  UNION ALL
  SELECT 'CHECK', 'Sale_total_equation_check', s.id
    FROM "Sale" s WHERE s.subtotal::numeric - s."discountTotal"::numeric <> s.total::numeric

  -- "SaleLine" -------------------------------------------------------------
  UNION ALL
  SELECT 'CHECK', 'SaleLine_quantity_positive_check', l.id
    FROM "SaleLine" l WHERE l.quantity <= 0
  UNION ALL
  SELECT 'CHECK', 'SaleLine_amounts_nonnegative_check', l.id
    FROM "SaleLine" l
   WHERE l."unitPrice" < 0 OR l."unitDiscount" < 0 OR l."lineTotal" < 0
      OR (l."unitCost" IS NOT NULL AND l."unitCost" < 0)
  UNION ALL
  SELECT 'CHECK', 'SaleLine_discount_within_price_check', l.id
    FROM "SaleLine" l WHERE l."unitDiscount" > l."unitPrice"
  UNION ALL
  SELECT 'CHECK', 'SaleLine_total_equation_check', l.id
    FROM "SaleLine" l
   WHERE (l."unitPrice"::numeric - l."unitDiscount"::numeric) * l.quantity::numeric <> l."lineTotal"::numeric

  -- "SaleReturnLine" -------------------------------------------------------
  UNION ALL
  SELECT 'CHECK', 'SaleReturnLine_received_positive_check', r.id
    FROM "SaleReturnLine" r WHERE r."receivedQuantity" <= 0
  UNION ALL
  SELECT 'CHECK', 'SaleReturnLine_split_nonnegative_check', r.id
    FROM "SaleReturnLine" r WHERE r."resellableQuantity" < 0 OR r."damagedQuantity" < 0
  UNION ALL
  SELECT 'CHECK', 'SaleReturnLine_split_equation_check', r.id
    FROM "SaleReturnLine" r
   WHERE r."resellableQuantity"::numeric + r."damagedQuantity"::numeric <> r."receivedQuantity"::numeric

  -- inventory_movements (reglas de 20261124200000_inventory_movements_allow_sale_origin)
  UNION ALL
  SELECT 'CHECK', 'inventory_movements_origin_check', m.id
    FROM inventory_movements m WHERE m.origin NOT IN ('MANUAL', 'INVENTORY_BATCH', 'SALE')
  UNION ALL
  SELECT 'CHECK', 'inventory_movements_batch_check', m.id
    FROM inventory_movements m
   WHERE NOT coalesce(
         (m.origin = 'MANUAL'
           AND m."batchId" IS NULL AND m."batchRowId" IS NULL AND m."batchOperationId" IS NULL
           AND m."saleId" IS NULL AND m."saleLineId" IS NULL AND m."saleMovementRole" IS NULL)
      OR (m.origin = 'INVENTORY_BATCH'
           AND m."batchId" IS NOT NULL AND m."batchRowId" IS NOT NULL AND m."batchOperationId" IS NOT NULL
           AND m."actorUserId" IS NOT NULL
           AND m."saleId" IS NULL AND m."saleLineId" IS NULL AND m."saleMovementRole" IS NULL)
      OR (m.origin = 'SALE'
           AND m."saleId" IS NOT NULL AND m."saleLineId" IS NOT NULL AND m."saleMovementRole" IS NOT NULL
           AND m."actorUserId" IS NOT NULL
           AND m."batchId" IS NULL AND m."batchRowId" IS NULL AND m."batchOperationId" IS NULL), false)

  -- inventory_movements (regla de 20261124210000_sale_partial_returns_and_movement_roles):
  -- SALE_CONFIRMATION = OUT; SALE_CANCELLATION y SALE_RETURN_RESELLABLE = IN;
  -- SALE_RETURN_DAMAGED no debe existir (el código nunca lo escribe).
  UNION ALL
  SELECT 'CHECK', 'inventory_movements_sale_role_type_check', m.id
    FROM inventory_movements m
   WHERE m."saleMovementRole" IS NOT NULL
     AND NOT ((m."saleMovementRole"::text = 'SALE_CONFIRMATION' AND m.type = 'OUT')
           OR (m."saleMovementRole"::text IN ('SALE_CANCELLATION', 'SALE_RETURN_RESELLABLE') AND m.type = 'IN'))

  -- Diagnósticos entre tablas (no son CHECK; no bloquean la migración) -----
  UNION ALL
  SELECT 'DIAGNÓSTICO', 'Sale_subtotal_matches_lines', s.id
    FROM "Sale" s
    LEFT JOIN (SELECT "saleId", sum("unitPrice"::numeric * quantity) AS base,
                      sum("unitDiscount"::numeric * quantity) AS discount
                 FROM "SaleLine" GROUP BY "saleId") t ON t."saleId" = s.id
   WHERE coalesce(t.base, 0) <> s.subtotal::numeric
      OR coalesce(t.discount, 0) <> s."discountTotal"::numeric
  -- Devoluciones parciales: lo devuelto en total por línea nunca supera lo vendido.
  -- El trigger nuevo lo impide desde la migración, pero no revisa filas anteriores.
  UNION ALL
  SELECT 'DIAGNÓSTICO', 'SaleReturnLine_cumulative_within_sold', l.id
    FROM "SaleLine" l JOIN "SaleReturnLine" r ON r."saleLineId" = l.id
   GROUP BY l.id, l.quantity
  HAVING sum(r."receivedQuantity")::numeric > l.quantity::numeric
  UNION ALL
  SELECT 'DIAGNÓSTICO', 'SaleReturnLine_line_belongs_to_return_sale', r.id
    FROM "SaleReturnLine" r
    JOIN "SaleReturn" h ON h.id = r."returnId"
    JOIN "SaleLine" l ON l.id = r."saleLineId"
   WHERE h."saleId" <> l."saleId"
  UNION ALL
  SELECT 'DIAGNÓSTICO', 'Returned_sale_fully_returned', s.id
    FROM "Sale" s
   WHERE s.status = 'RETURNED'
     AND EXISTS (SELECT 1 FROM "SaleLine" l WHERE l."saleId" = s.id
                  AND coalesce((SELECT sum(r."receivedQuantity") FROM "SaleReturnLine" r WHERE r."saleLineId" = l.id), 0) < l.quantity)
  UNION ALL
  SELECT 'DIAGNÓSTICO', 'Delivered_sale_fully_returned', s.id
    FROM "Sale" s
   WHERE s.status = 'DELIVERED'
     AND EXISTS (SELECT 1 FROM "SaleLine" l WHERE l."saleId" = s.id)
     AND NOT EXISTS (SELECT 1 FROM "SaleLine" l WHERE l."saleId" = s.id
                      AND coalesce((SELECT sum(r."receivedQuantity") FROM "SaleReturnLine" r WHERE r."saleLineId" = l.id), 0) < l.quantity)
  -- Ventas entregadas y después canceladas (regla anterior a 20261124210000). Se conservan
  -- tal cual; el trigger nuevo solo impide que vuelva a ocurrir. En producción existe al
  -- menos una de prueba.
  UNION ALL
  SELECT 'DIAGNÓSTICO', 'Sale_cancelled_after_delivery', s.id
    FROM "Sale" s WHERE s.status = 'CANCELLED' AND s."deliveredAt" IS NOT NULL
),
catalog AS (
  SELECT * FROM (VALUES
    ('CHECK', 'Sale_currency_check'), ('CHECK', 'Sale_amounts_nonnegative_check'),
    ('CHECK', 'Sale_discount_within_subtotal_check'), ('CHECK', 'Sale_total_equation_check'),
    ('CHECK', 'SaleLine_quantity_positive_check'), ('CHECK', 'SaleLine_amounts_nonnegative_check'),
    ('CHECK', 'SaleLine_discount_within_price_check'), ('CHECK', 'SaleLine_total_equation_check'),
    ('CHECK', 'SaleReturnLine_received_positive_check'), ('CHECK', 'SaleReturnLine_split_nonnegative_check'),
    ('CHECK', 'SaleReturnLine_split_equation_check'),
    ('CHECK', 'inventory_movements_origin_check'), ('CHECK', 'inventory_movements_batch_check'),
    ('CHECK', 'inventory_movements_sale_role_type_check'),
    ('DIAGNÓSTICO', 'Sale_subtotal_matches_lines'), ('DIAGNÓSTICO', 'SaleReturnLine_cumulative_within_sold'),
    ('DIAGNÓSTICO', 'SaleReturnLine_line_belongs_to_return_sale'), ('DIAGNÓSTICO', 'Returned_sale_fully_returned'),
    ('DIAGNÓSTICO', 'Delivered_sale_fully_returned'), ('DIAGNÓSTICO', 'Sale_cancelled_after_delivery')
  ) AS c(kind, rule)
)
SELECT c.kind AS tipo,
       c.rule AS regla,
       count(r.row_id) AS violaciones,
       (array_agg(r.row_id ORDER BY r.row_id) FILTER (WHERE r.row_id IS NOT NULL))[1:5] AS ids_de_ejemplo
  FROM catalog c
  LEFT JOIN rules r ON r.kind = c.kind AND r.rule = c.rule
 GROUP BY c.kind, c.rule
 ORDER BY c.kind, c.rule;

-- Totales de contexto (solo conteos).
SELECT (SELECT count(*) FROM "Sale") AS ventas,
       (SELECT count(*) FROM "SaleLine") AS lineas,
       (SELECT count(*) FROM "SaleReturnLine") AS lineas_devueltas;

-- Orígenes existentes en inventory_movements. Antes de 20261124200000 solo deberían
-- aparecer MANUAL e INVENTORY_BATCH; después aparece SALE, siempre con referencias de venta.
SELECT origin,
       count(*) AS movimientos,
       count(*) FILTER (WHERE "saleId" IS NOT NULL OR "saleLineId" IS NOT NULL OR "saleMovementRole" IS NOT NULL) AS con_referencias_de_venta,
       count(*) FILTER (WHERE "batchId" IS NOT NULL) AS con_referencias_de_lote
  FROM inventory_movements
 GROUP BY origin
 ORDER BY origin;

-- Restricciones que la segunda migración reemplaza por nombre. Deben aparecer las dos;
-- si falta alguna o tiene otro nombre, la migración falla sin aplicar cambios.
SELECT conname AS restriccion, pg_get_constraintdef(oid) AS definicion_actual
  FROM pg_constraint
 WHERE conrelid = 'inventory_movements'::regclass
   AND conname IN ('inventory_movements_origin_check', 'inventory_movements_batch_check')
 ORDER BY conname;

-- Roles y tipos de los movimientos de venta. Esperado: SALE_CONFIRMATION/OUT,
-- SALE_CANCELLATION/IN y SALE_RETURN_RESELLABLE/IN; ninguna fila SALE_RETURN_DAMAGED.
SELECT "saleMovementRole"::text AS rol, type AS tipo, count(*) AS movimientos
  FROM inventory_movements
 WHERE "saleMovementRole" IS NOT NULL
 GROUP BY "saleMovementRole", type
 ORDER BY 1, 2;

-- Objetos que crea 20261124210000. Antes de aplicarla debe devolver 0 filas: si alguno
-- ya existe, la migración fallaría sin aplicar cambios.
SELECT 'constraint' AS clase, conname AS nombre FROM pg_constraint
 WHERE conrelid = 'inventory_movements'::regclass AND conname = 'inventory_movements_sale_role_type_check'
UNION ALL
SELECT 'index', relname FROM pg_class WHERE relname = 'SaleReturnLine_saleLineId_idx'
UNION ALL
SELECT 'function', proname FROM pg_proc WHERE proname IN ('sale_return_line_guard', 'sale_status_transition_guard')
UNION ALL
SELECT 'trigger', tgname FROM pg_trigger WHERE tgname IN ('sale_return_line_guard', 'sale_status_transition_guard');

-- Migraciones de Ventas registradas por Prisma. Antes de aplicar 20261124210000 deben
-- figurar las dos primeras con finished_at y ninguna fila de la tercera.
SELECT migration_name, finished_at, rolled_back_at
  FROM _prisma_migrations
 WHERE migration_name IN ('20261124100000_sale_integrity_checks', '20261124200000_inventory_movements_allow_sale_origin',
                          '20261124210000_sale_partial_returns_and_movement_roles')
 ORDER BY started_at;

ROLLBACK;
