-- SOLO LECTURA. Comprobación previa a la migración 20261126000000_scheduled_expense_payments (Gastos F1b).
--
-- Uso: ejecutar en el editor SQL de la base que se va a migrar. No modifica nada: la transacción es
-- READ ONLY y termina en ROLLBACK. El editor de Supabase muestra solo el resultado de la última
-- sentencia: ejecuta cada SELECT por separado.
--
-- Esperado ANTES de aplicar:
--   1. Objetos con los nombres que crea la migración: 0 filas.
--   2. Columna expenses.scheduledPaymentId: 0 filas.
--   3. Registro de Prisma de esta migración: 0 filas.
--   4. Migración de Gastos F1a (20261125000000_operating_expenses): aplicada y sin revertir.
--   5. Gastos y plantillas existentes: informativo (F1b no los modifica; deben cumplir las reglas nuevas,
--      que solo afectan a filas con scheduledPaymentId, inexistentes hasta ahora).

BEGIN TRANSACTION READ ONLY;

-- 1. Objetos que crea la migración (deben no existir).
SELECT 'table' AS clase, c.relname AS nombre
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname = 'scheduled_expense_payments'
UNION ALL
SELECT 'type', t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
 WHERE n.nspname = current_schema() AND t.typname = 'ScheduledExpenseStatus'
UNION ALL
SELECT 'function', p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = current_schema() AND p.proname IN ('scheduled_payment_transition_guard', 'scheduled_payment_coherence')
UNION ALL
SELECT 'index', c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = current_schema() AND c.relkind = 'i'
   AND c.relname IN ('expenses_scheduledPaymentId_confirmed_key', 'expenses_ownerId_scheduledPaymentId_idx')
UNION ALL
SELECT 'constraint', con.conname FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace
 WHERE n.nspname = current_schema() AND con.conname IN ('expenses_scheduled_source_check', 'expenses_scheduledPaymentId_ownerId_fkey')
UNION ALL
SELECT 'trigger', tg.tgname FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = current_schema() AND tg.tgname = 'expenses_scheduled_payment_coherence';

-- 2. Columna nueva en expenses (debe no existir).
SELECT column_name FROM information_schema.columns
 WHERE table_schema = current_schema() AND table_name = 'expenses' AND column_name = 'scheduledPaymentId';

-- 3. Registro de Prisma de esta migración (debe estar vacío).
SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
 WHERE migration_name = '20261126000000_scheduled_expense_payments';

-- 4. Migración de F1a: aplicada (aplicada = true, revertida = false).
SELECT migration_name, finished_at IS NOT NULL AS aplicada, rolled_back_at IS NOT NULL AS revertida FROM _prisma_migrations
 WHERE migration_name = '20261125000000_operating_expenses' ORDER BY started_at;

-- 5. Informativo: volumen actual de Gastos.
SELECT (SELECT count(*) FROM expenses) AS gastos, (SELECT count(*) FROM recurring_expense_templates) AS plantillas;

ROLLBACK;
