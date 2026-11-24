-- SOLO LECTURA. Comprueba si los datos actuales de Ventas cumplen las reglas de la
-- migración 20261124100000_sale_integrity_checks ANTES de aplicarla.
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

  -- Diagnósticos entre tablas (no son CHECK; no bloquean la migración) -----
  UNION ALL
  SELECT 'DIAGNÓSTICO', 'Sale_subtotal_matches_lines', s.id
    FROM "Sale" s
    LEFT JOIN (SELECT "saleId", sum("unitPrice"::numeric * quantity) AS base,
                      sum("unitDiscount"::numeric * quantity) AS discount
                 FROM "SaleLine" GROUP BY "saleId") t ON t."saleId" = s.id
   WHERE coalesce(t.base, 0) <> s.subtotal::numeric
      OR coalesce(t.discount, 0) <> s."discountTotal"::numeric
  UNION ALL
  SELECT 'DIAGNÓSTICO', 'SaleReturnLine_received_equals_sold', r.id
    FROM "SaleReturnLine" r JOIN "SaleLine" l ON l.id = r."saleLineId"
   WHERE r."receivedQuantity" <> l.quantity
  UNION ALL
  SELECT 'DIAGNÓSTICO', 'Returned_sale_covers_all_lines', s.id
    FROM "Sale" s
   WHERE s.status = 'RETURNED'
     AND EXISTS (SELECT 1 FROM "SaleLine" l WHERE l."saleId" = s.id
                  AND NOT EXISTS (SELECT 1 FROM "SaleReturnLine" r
                                    JOIN "SaleReturn" h ON h.id = r."returnId"
                                   WHERE h."saleId" = s.id AND r."saleLineId" = l.id))
),
catalog AS (
  SELECT * FROM (VALUES
    ('CHECK', 'Sale_currency_check'), ('CHECK', 'Sale_amounts_nonnegative_check'),
    ('CHECK', 'Sale_discount_within_subtotal_check'), ('CHECK', 'Sale_total_equation_check'),
    ('CHECK', 'SaleLine_quantity_positive_check'), ('CHECK', 'SaleLine_amounts_nonnegative_check'),
    ('CHECK', 'SaleLine_discount_within_price_check'), ('CHECK', 'SaleLine_total_equation_check'),
    ('CHECK', 'SaleReturnLine_received_positive_check'), ('CHECK', 'SaleReturnLine_split_nonnegative_check'),
    ('CHECK', 'SaleReturnLine_split_equation_check'),
    ('DIAGNÓSTICO', 'Sale_subtotal_matches_lines'), ('DIAGNÓSTICO', 'SaleReturnLine_received_equals_sold'),
    ('DIAGNÓSTICO', 'Returned_sale_covers_all_lines')
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

ROLLBACK;
