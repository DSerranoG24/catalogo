-- SOLO LECTURA. Comprobación previa a la migración 20261125000000_operating_expenses (Gastos F1a).
--
-- Uso: ejecutar en el editor SQL de la base que se va a migrar. No modifica nada: la
-- transacción es READ ONLY y termina en ROLLBACK. El editor de Supabase muestra solo el
-- resultado de la última sentencia: ejecuta cada SELECT por separado.
--
-- Esperado ANTES de aplicar:
--   1. Objetos con los nombres que crea la migración: 0 filas. Si alguno existe, la migración
--      fallaría completa (sin cambios parciales): no la apliques y revisa.
--   2. Registro de Prisma de esta migración: 0 filas.
--   3. Migraciones de Ventas anteriores: las tres con finished_at y sin rolled_back_at.

BEGIN TRANSACTION READ ONLY;

-- 1. Objetos que crea la migración (deben no existir).
SELECT 'table' AS clase, c.relname AS nombre
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = current_schema() AND c.relkind = 'r'
   AND c.relname IN ('expense_categories', 'recurring_expense_templates', 'expenses', 'expense_operations', 'expense_events')
UNION ALL
SELECT 'type', t.typname
  FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
 WHERE n.nspname = current_schema()
   AND t.typname IN ('ExpenseStatus', 'ExpenseSource', 'ExpensePaymentMethod', 'RecurringExpenseStatus', 'ExpenseFrequency')
UNION ALL
SELECT 'function', p.proname
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = current_schema()
   AND p.proname IN ('expense_history_immutable', 'expense_row_guard', 'expense_transition_guard')
UNION ALL
SELECT 'trigger', tgname FROM pg_trigger
 WHERE tgname IN ('expense_operations_immutable', 'expense_events_immutable', 'expense_categories_guard',
                  'recurring_expense_templates_guard', 'expenses_transition_guard');

-- 2. Registro de Prisma de esta migración (debe estar vacío).
SELECT migration_name, finished_at, rolled_back_at
  FROM _prisma_migrations
 WHERE migration_name = '20261125000000_operating_expenses';

-- 3. Estado de las migraciones anteriores (Ventas F0b, F0c y F0d).
SELECT migration_name, finished_at IS NOT NULL AS aplicada, rolled_back_at IS NOT NULL AS revertida
  FROM _prisma_migrations
 WHERE migration_name IN ('20261124100000_sale_integrity_checks', '20261124200000_inventory_movements_allow_sale_origin',
                          '20261124210000_sale_partial_returns_and_movement_roles')
 ORDER BY started_at;

ROLLBACK;
