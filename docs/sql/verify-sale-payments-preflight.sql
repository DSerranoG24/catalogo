-- SOLO LECTURA. Comprobación previa a la migración 20261126100000_sale_payments_ledger (Pagos de la venta, F2a-1).
--
-- Uso: ejecutar en el editor SQL de la base que se va a migrar. No modifica nada: la transacción es
-- READ ONLY y termina en ROLLBACK. El editor de Supabase muestra solo el resultado de la última
-- sentencia: ejecuta cada SELECT por separado.
--
-- Esperado ANTES de aplicar:
--   1. Objetos con los nombres que crea la migración: 0 filas.
--   2. Columnas nuevas de "Sale": 0 filas.
--   3. Registro de Prisma de esta migración: 0 filas.
--   4. Migración de Gastos F1b (20261126000000_scheduled_expense_payments): aplicada y sin revertir.
--   5. Ventas por estado: informativo. Todas quedarán LEGACY (sin pagos registrados); la migración no las reescribe.
--   6. Ventas con el mismo par (id, userId): 0 filas (imposible con id como clave primaria; lo exige el índice único nuevo).
--   7. Transacciones abiertas sobre "Sale" o con más de un minuto: informativo. La migración espera como máximo
--      5 s por el bloqueo de "Sale" (lock_timeout) y, si no lo obtiene, falla sin cambios.

BEGIN TRANSACTION READ ONLY;

-- 1. Objetos que crea la migración (deben no existir).
SELECT 'table' AS clase, c.relname AS nombre
  FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = current_schema() AND c.relkind = 'r'
   AND c.relname IN ('sale_payment_entries', 'customer_credit_entries', 'sale_money_operations', 'receivable_settings')
UNION ALL
SELECT 'type', t.typname FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
 WHERE n.nspname = current_schema() AND t.typname IN ('SalePaymentMode', 'SalePaymentMethod', 'SalePaymentEntryKind', 'CustomerCreditEntryKind')
UNION ALL
SELECT 'function', p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
 WHERE n.nspname = current_schema() AND p.proname IN ('money_append_only_guard', 'receivable_settings_guard', 'sale_payment_columns_guard',
   'sale_payment_entry_insert_guard', 'customer_credit_entry_insert_guard', 'sale_payment_balance_check', 'sale_payment_balance_trigger',
   'customer_credit_balance_trigger')
UNION ALL
SELECT 'index', c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = current_schema() AND c.relkind = 'i' AND c.relname = 'Sale_id_userId_key'
UNION ALL
SELECT 'constraint', con.conname FROM pg_constraint con JOIN pg_namespace n ON n.oid = con.connamespace
 WHERE n.nspname = current_schema() AND con.conname = 'Sale_payment_columns_check'
UNION ALL
SELECT 'trigger', tg.tgname FROM pg_trigger tg JOIN pg_class c ON c.oid = tg.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = current_schema() AND tg.tgname IN ('sale_payment_columns_guard', 'sale_payment_status_balance', 'sale_return_line_payment_balance');

-- 2. Columnas nuevas de "Sale" (deben no existir).
SELECT column_name FROM information_schema.columns
 WHERE table_schema = current_schema() AND table_name = 'Sale' AND column_name IN ('paymentMode', 'paymentTermDays', 'paymentDueDate');

-- 3. Registro de Prisma de esta migración (debe estar vacío).
SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations
 WHERE migration_name = '20261126100000_sale_payments_ledger';

-- 4. Migración de F1b: aplicada (aplicada = true, revertida = false).
SELECT migration_name, finished_at IS NOT NULL AS aplicada, rolled_back_at IS NOT NULL AS revertida FROM _prisma_migrations
 WHERE migration_name = '20261126000000_scheduled_expense_payments' ORDER BY started_at;

-- 5. Informativo: ventas por estado (todas quedarán LEGACY).
SELECT status, count(*) AS ventas FROM "Sale" GROUP BY status ORDER BY status;

-- 6. Pares (id, userId) repetidos en "Sale" (debe estar vacío).
SELECT id, "userId", count(*) AS repeticiones FROM "Sale" GROUP BY id, "userId" HAVING count(*) > 1;

-- 7. Informativo: transacciones que podrían retrasar el bloqueo de "Sale".
SELECT pid, state, now() - xact_start AS duracion FROM pg_stat_activity
 WHERE xact_start IS NOT NULL AND pid <> pg_backend_pid() AND now() - xact_start > interval '1 minute';

ROLLBACK;
