import { createHash } from "node:crypto";
import { Prisma, type Expense, type ExpenseCategory } from "@prisma/client";
import { prisma } from "../config/prisma";
import { lockInventoryOwner } from "./inventory.repository";
import { isAllowedExpenseDate, toDbDate, fromDbDate } from "../services/expense-dates";
import { normalizeCategoryName, type CreateExpenseInput, type ExpenseInput, type ExpenseListQuery, type ExpenseSummaryQuery,
  type ReclassifyExpenseInput, type VoidExpenseInput } from "../schemas/expense.schema";

// Gastos F1a (docs/expenses-contract.md v1.2). Lock order per mutation:
// users FOR SHARE (open account) -> advisory lock 'expenses-v1' per owner -> receipt -> rows FOR UPDATE.
export class ExpenseError extends Error {
  constructor(public readonly code: string, public readonly details?: Record<string, unknown>) { super(code); }
}
type Tx = Prisma.TransactionClient;
type Keys = { operationId: string; requestId: string };
type EventDraft = { entityKind: "EXPENSE" | "CATEGORY"; entityId: string; eventType: string; before?: unknown; after: unknown };
const PAGE = 25;
export const CATEGORY_QUOTA = 100;
export const SEED_CATEGORIES = [
  ["rent", "Arriendo"], ["utilities", "Servicios públicos"], ["internet-phone", "Internet y telefonía"], ["transport-delivery", "Transporte y domicilios"],
  ["advertising", "Publicidad y redes"], ["maintenance", "Mantenimiento y reparaciones"], ["stationery", "Papelería e insumos"],
  ["fees", "Comisiones bancarias y de plataformas"], ["taxes-procedures", "Impuestos y trámites"], ["payroll-fees", "Nómina y honorarios"], ["other", "Otros gastos"],
] as const;

const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
/** Same rule as Ventas v2.1: requestId identifies a transmission and is not part of the command. */
export function expenseCommandHash(kind: string, resourceId: string, input: object) {
  const { requestId: _transport, ...command } = input as Record<string, unknown>;
  return sha256(JSON.stringify({ kind, resourceId, command }));
}
const jsonSafe = (value: unknown): Prisma.InputJsonObject => JSON.parse(JSON.stringify(value, (_key, v) => typeof v === "bigint" ? v.toString() : v));

type ExpenseRow = Expense & { category?: Pick<ExpenseCategory, "name" | "archivedAt"> | null; replacedBy?: { id: string }[] };
export const categoryView = (c: ExpenseCategory) => ({ id: c.id, name: c.name, seedKey: c.seedKey, position: c.position, archivedAt: c.archivedAt?.toISOString() ?? null, version: c.version });
/** paymentReference is private: only the detail view (withReference) includes it. */
export function expenseView(e: ExpenseRow, withReference = false) {
  return {
    id: e.id, status: e.status, source: e.source, expenseDate: fromDbDate(e.expenseDate), amount: e.amount?.toString() ?? null, currency: e.currency, taxMode: e.taxMode,
    categoryId: e.categoryId, categoryName: e.category?.name ?? null, categoryArchived: Boolean(e.category?.archivedAt), categoryNameSnapshot: e.categoryNameSnapshot,
    paymentMethod: e.paymentMethod, paymentMethodNote: e.paymentMethodNote, description: e.description, supplierName: e.supplierName,
    replacesExpenseId: e.replacesExpenseId, replacedByExpenseId: e.replacedBy?.[0]?.id ?? null,
    recordedAt: e.recordedAt.toISOString(), confirmedAt: e.confirmedAt?.toISOString() ?? null, voidedAt: e.voidedAt?.toISOString() ?? null, voidReason: e.voidReason,
    version: e.version, ...(withReference ? { paymentReference: e.paymentReference } : {}),
  };
}
const withCategory = { category: { select: { name: true, archivedAt: true } }, replacedBy: { select: { id: true } } } satisfies Prisma.ExpenseInclude;

function encodeCursor(e: Expense) { return Buffer.from(JSON.stringify({ d: fromDbDate(e.expenseDate), r: e.recordedAt.toISOString(), i: e.id })).toString("base64url"); }
function decodeCursor(cursor: string) {
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (typeof value?.d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.d) && typeof value?.r === "string" && !Number.isNaN(Date.parse(value.r)) && typeof value?.i === "string") return value as { d: string; r: string; i: string };
  } catch { /* fall through */ }
  throw new ExpenseError("INVALID_EXPENSE_INPUT");
}

export function makeExpenseRepository(database: typeof prisma = prisma, clock: () => Date = () => new Date()) {
  async function mutation<T extends object>(ownerId: string, input: Keys, kind: string, resourceId: string, work: (tx: Tx, now: Date) => Promise<{ result: T; events: EventDraft[] }>) {
    const requestHash = expenseCommandHash(kind, resourceId, input);
    return database.$transaction(async tx => {
      await lockInventoryOwner(tx, ownerId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('expenses-v1'), hashtext(${ownerId}))`;
      const prior = await tx.expenseOperation.findUnique({ where: { ownerId_operationId: { ownerId, operationId: input.operationId } } });
      if (prior) {
        if (prior.kind !== kind || prior.resourceId !== resourceId || prior.requestHash !== requestHash) throw new ExpenseError("IDEMPOTENCY_CONFLICT");
        return { ...(prior.responseSnapshot as Record<string, unknown>), idempotent: true };
      }
      const { result, events } = await work(tx, clock());
      const snapshot = jsonSafe(result);
      await tx.expenseOperation.create({ data: { ownerId, operationId: input.operationId, requestId: input.requestId, kind, resourceId, requestHash, responseSnapshot: snapshot } });
      for (const event of events) await tx.expenseEvent.create({ data: { ownerId, operationId: input.operationId, entityKind: event.entityKind, entityId: event.entityId, eventType: event.eventType,
        before: event.before === undefined ? Prisma.DbNull : jsonSafe(event.before), after: jsonSafe(event.after) } });
      return { ...(snapshot as Record<string, unknown>), idempotent: false };
    });
  }
  async function lockedCategory(tx: Tx, ownerId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM expense_categories WHERE id = ${id} AND "ownerId" = ${ownerId} FOR UPDATE`;
    const row = await tx.expenseCategory.findFirst({ where: { id, ownerId } });
    if (!row) throw new ExpenseError("EXPENSE_CATEGORY_NOT_FOUND");
    return row;
  }
  async function activeCategory(tx: Tx, ownerId: string, id: string) {
    const row = await tx.expenseCategory.findFirst({ where: { id, ownerId } });
    if (!row) throw new ExpenseError("EXPENSE_CATEGORY_NOT_FOUND");
    if (row.archivedAt) throw new ExpenseError("EXPENSE_CATEGORY_ARCHIVED");
    return row;
  }
  async function lockedExpense(tx: Tx, ownerId: string, id: string) {
    await tx.$queryRaw`SELECT id FROM expenses WHERE id = ${id} AND "ownerId" = ${ownerId} FOR UPDATE`;
    const row = await tx.expense.findFirst({ where: { id, ownerId }, include: withCategory });
    if (!row) throw new ExpenseError("EXPENSE_NOT_FOUND");
    return row;
  }
  async function ownedCategoryExists(tx: Tx, ownerId: string, id: string) {
    if (!await tx.expenseCategory.findFirst({ where: { id, ownerId }, select: { id: true } })) throw new ExpenseError("EXPENSE_CATEGORY_NOT_FOUND");
  }
  async function nameConflict(tx: Tx, ownerId: string, name: string, exceptId?: string) {
    const existing = await tx.expenseCategory.findFirst({ where: { ownerId, normalizedKey: normalizeCategoryName(name) } });
    if (existing && existing.id !== exceptId) throw new ExpenseError("EXPENSE_CATEGORY_NAME_CONFLICT", { existingId: existing.id, archived: Boolean(existing.archivedAt) });
  }
  async function insertExpense(tx: Tx, ownerId: string, input: ExpenseInput, now: Date, replacesExpenseId?: string) {
    if (!isAllowedExpenseDate(input.expenseDate, now)) throw new ExpenseError("INVALID_EXPENSE_INPUT");
    const category = await activeCategory(tx, ownerId, input.categoryId);
    return tx.expense.create({ data: {
      ownerId, status: "CONFIRMED", source: "MANUAL", expenseDate: toDbDate(input.expenseDate), amount: BigInt(input.amount), categoryId: category.id, categoryNameSnapshot: category.name,
      paymentMethod: input.paymentMethod, paymentMethodNote: input.paymentMethodNote ?? null, paymentReference: input.paymentReference ?? null, description: input.description,
      supplierName: input.supplierName ?? null, replacesExpenseId: replacesExpenseId ?? null, confirmedAt: now,
    }, include: withCategory });
  }
  const allCategories = (tx: Tx, ownerId: string) => tx.expenseCategory.findMany({ where: { ownerId }, orderBy: [{ position: "asc" }, { id: "asc" }] });

  return {
    async listCategories(ownerId: string, status: "active" | "archived" | "all") {
      const rows = await database.expenseCategory.findMany({ where: { ownerId, ...(status === "active" ? { archivedAt: null } : status === "archived" ? { archivedAt: { not: null } } : {}) }, orderBy: [{ position: "asc" }, { id: "asc" }] });
      return { categories: rows.map(categoryView) };
    },
    /** Inserts each missing suggested category once per account; renamed or archived seeds are kept. */
    seedCategories(ownerId: string, input: Keys) {
      return mutation(ownerId, input, "CATEGORY_SEED", ownerId, async tx => {
        const existing = await allCategories(tx, ownerId);
        const events: EventDraft[] = [];
        let position = existing.reduce((max, c) => Math.max(max, c.position), -1) + 1, count = existing.length;
        for (const [seedKey, name] of SEED_CATEGORIES) {
          if (count >= CATEGORY_QUOTA) break;
          if (existing.some(c => c.seedKey === seedKey || c.normalizedKey === normalizeCategoryName(name))) continue;
          const row = await tx.expenseCategory.create({ data: { ownerId, name, normalizedKey: normalizeCategoryName(name), seedKey, position: position++ } });
          count++; events.push({ entityKind: "CATEGORY", entityId: row.id, eventType: "CREATED", after: categoryView(row) });
        }
        return { result: { categories: (await allCategories(tx, ownerId)).map(categoryView), created: events.length }, events };
      });
    },
    createCategory(ownerId: string, input: Keys & { name: string }) {
      return mutation(ownerId, input, "CATEGORY_CREATE", ownerId, async tx => {
        await nameConflict(tx, ownerId, input.name);
        const existing = await allCategories(tx, ownerId);
        if (existing.length >= CATEGORY_QUOTA) throw new ExpenseError("EXPENSE_CATEGORY_QUOTA");
        const row = await tx.expenseCategory.create({ data: { ownerId, name: input.name, normalizedKey: normalizeCategoryName(input.name), position: existing.reduce((max, c) => Math.max(max, c.position), -1) + 1 } });
        return { result: { category: categoryView(row) }, events: [{ entityKind: "CATEGORY", entityId: row.id, eventType: "CREATED", after: categoryView(row) }] };
      });
    },
    updateCategory(ownerId: string, id: string, input: Keys & { expectedVersion: number; name?: string; position?: number }) {
      return mutation(ownerId, input, "CATEGORY_UPDATE", id, async tx => {
        const current = await lockedCategory(tx, ownerId, id);
        if (current.version !== input.expectedVersion) throw new ExpenseError("VERSION_CONFLICT");
        const data: Prisma.ExpenseCategoryUpdateInput = {};
        if (input.name !== undefined && input.name !== current.name) { await nameConflict(tx, ownerId, input.name, id); Object.assign(data, { name: input.name, normalizedKey: normalizeCategoryName(input.name) }); }
        if (input.position !== undefined && input.position !== current.position) data.position = input.position;
        if (!Object.keys(data).length) return { result: { category: categoryView(current) }, events: [] };
        const row = await tx.expenseCategory.update({ where: { id_ownerId: { id, ownerId } }, data: { ...data, version: { increment: 1 } } });
        return { result: { category: categoryView(row) }, events: [{ entityKind: "CATEGORY", entityId: id, eventType: data.name ? "RENAMED" : "REORDERED", before: categoryView(current), after: categoryView(row) }] };
      });
    },
    setCategoryArchived(ownerId: string, id: string, archived: boolean, input: Keys & { expectedVersion: number }) {
      return mutation(ownerId, input, archived ? "CATEGORY_ARCHIVE" : "CATEGORY_REACTIVATE", id, async (tx, now) => {
        const current = await lockedCategory(tx, ownerId, id);
        if (current.version !== input.expectedVersion) throw new ExpenseError("VERSION_CONFLICT");
        if (Boolean(current.archivedAt) === archived) return { result: { category: categoryView(current) }, events: [] };
        const row = await tx.expenseCategory.update({ where: { id_ownerId: { id, ownerId } }, data: { archivedAt: archived ? now : null, version: { increment: 1 } } });
        return { result: { category: categoryView(row) }, events: [{ entityKind: "CATEGORY", entityId: id, eventType: archived ? "ARCHIVED" : "REACTIVATED", before: categoryView(current), after: categoryView(row) }] };
      });
    },
    createExpense(ownerId: string, input: CreateExpenseInput) {
      return mutation(ownerId, input, "EXPENSE_CREATE", ownerId, async (tx, now) => {
        const { operationId: _o, requestId: _r, ...fields } = input;
        const row = await insertExpense(tx, ownerId, fields, now);
        return { result: { expense: expenseView(row, true) }, events: [{ entityKind: "EXPENSE", entityId: row.id, eventType: "CREATED", after: expenseView(row, true) }] };
      });
    },
    /** Category, description and payment-method note only; RECLASSIFIED keeps the previous and new values. */
    reclassifyExpense(ownerId: string, id: string, input: ReclassifyExpenseInput) {
      return mutation(ownerId, input, "EXPENSE_RECLASSIFY", id, async tx => {
        const current = await lockedExpense(tx, ownerId, id);
        if (current.status !== "CONFIRMED") throw new ExpenseError("INVALID_EXPENSE_TRANSITION");
        if (current.version !== input.expectedVersion) throw new ExpenseError("VERSION_CONFLICT");
        if (input.paymentMethodNote !== undefined && current.paymentMethod !== "OTHER") throw new ExpenseError("INVALID_EXPENSE_INPUT");
        const data: Prisma.ExpenseUncheckedUpdateInput = {};
        if (input.categoryId !== undefined && input.categoryId !== current.categoryId) { const category = await activeCategory(tx, ownerId, input.categoryId); data.categoryId = category.id; data.categoryNameSnapshot = category.name; }
        if (input.description !== undefined && input.description !== current.description) data.description = input.description;
        if (input.paymentMethodNote !== undefined && input.paymentMethodNote !== current.paymentMethodNote) data.paymentMethodNote = input.paymentMethodNote;
        if (!Object.keys(data).length) return { result: { expense: expenseView(current, true) }, events: [] };
        const row = await tx.expense.update({ where: { id_ownerId: { id, ownerId } }, data: { ...data, version: { increment: 1 } }, include: withCategory });
        const pick = (e: ExpenseRow) => ({ categoryId: e.categoryId, categoryName: e.categoryNameSnapshot, description: e.description, paymentMethodNote: e.paymentMethodNote });
        return { result: { expense: expenseView(row, true) }, events: [{ entityKind: "EXPENSE", entityId: id, eventType: "RECLASSIFIED", before: pick(current), after: pick(row) }] };
      });
    },
    /** Void with reason; an optional replacement is created in the same transaction. */
    voidExpense(ownerId: string, id: string, input: VoidExpenseInput) {
      return mutation(ownerId, input, "EXPENSE_VOID", id, async (tx, now) => {
        const current = await lockedExpense(tx, ownerId, id);
        if (current.status !== "CONFIRMED") throw new ExpenseError("INVALID_EXPENSE_TRANSITION");
        if (current.version !== input.expectedVersion) throw new ExpenseError("VERSION_CONFLICT");
        const voided = await tx.expense.update({ where: { id_ownerId: { id, ownerId } }, data: { status: "VOIDED", voidedAt: now, voidReason: input.reason, version: { increment: 1 } }, include: withCategory });
        const events: EventDraft[] = [{ entityKind: "EXPENSE", entityId: id, eventType: "VOIDED", before: { status: current.status }, after: { status: "VOIDED", voidReason: input.reason } }];
        let replacement: ExpenseRow | null = null;
        if (input.replacement) {
          replacement = await insertExpense(tx, ownerId, input.replacement, now, id);
          events.push({ entityKind: "EXPENSE", entityId: replacement.id, eventType: "CREATED", after: { ...expenseView(replacement, true), replacesExpenseId: id } });
          events.push({ entityKind: "EXPENSE", entityId: id, eventType: "REPLACED", after: { replacementId: replacement.id } });
        }
        const finalVoided = replacement ? { ...voided, replacedBy: [{ id: replacement.id }] } : voided;
        return { result: { voided: expenseView(finalVoided, true), replacement: replacement ? expenseView(replacement, true) : null }, events };
      });
    },
    async listExpenses(ownerId: string, query: ExpenseListQuery) {
      return database.$transaction(async tx => {
        if (query.categoryId) await ownedCategoryExists(tx, ownerId, query.categoryId);
        const cursor = query.cursor ? decodeCursor(query.cursor) : null;
        const after = cursor ? { OR: [
          { expenseDate: { lt: toDbDate(cursor.d) } },
          { expenseDate: toDbDate(cursor.d), recordedAt: { lt: new Date(cursor.r) } },
          { expenseDate: toDbDate(cursor.d), recordedAt: new Date(cursor.r), id: { lt: cursor.i } },
        ] } : {};
        const rows = await tx.expense.findMany({ where: { ownerId, expenseDate: { gte: toDbDate(query.from), lte: toDbDate(query.to) }, ...(query.status === "all" ? {} : { status: query.status }),
          ...(query.categoryId ? { categoryId: query.categoryId } : {}), ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}), ...after },
          include: withCategory, orderBy: [{ expenseDate: "desc" }, { recordedAt: "desc" }, { id: "desc" }], take: PAGE + 1 });
        const page = rows.slice(0, PAGE);
        return { items: page.map(row => expenseView(row)), nextCursor: rows.length > PAGE ? encodeCursor(page[page.length - 1]) : null, pageSize: PAGE };
      }, { isolationLevel: "RepeatableRead" });
    },
    async summary(ownerId: string, query: ExpenseSummaryQuery) {
      return database.$transaction(async tx => {
        if (query.categoryId) await ownedCategoryExists(tx, ownerId, query.categoryId);
        const where = { ownerId, expenseDate: { gte: toDbDate(query.from), lte: toDbDate(query.to) }, ...(query.categoryId ? { categoryId: query.categoryId } : {}), ...(query.paymentMethod ? { paymentMethod: query.paymentMethod } : {}) };
        const byCategory = await tx.expense.groupBy({ by: ["categoryId"], where: { ...where, status: "CONFIRMED" }, _sum: { amount: true }, _count: { _all: true } });
        const byMethod = await tx.expense.groupBy({ by: ["paymentMethod"], where: { ...where, status: "CONFIRMED" }, _sum: { amount: true }, _count: { _all: true } });
        const voidedCount = await tx.expense.count({ where: { ...where, status: "VOIDED" } });
        const pending = await tx.expense.groupBy({ by: ["status"], where: { ...where, status: "PENDING_CONFIRMATION" }, _sum: { suggestedAmount: true }, _count: { _all: true } });
        const names = await tx.expenseCategory.findMany({ where: { ownerId, id: { in: byCategory.map(row => row.categoryId) } } });
        const total = byCategory.reduce((sum, row) => sum + (row._sum.amount ?? 0n), 0n);
        return {
          confirmedTotal: total.toString(), confirmedCount: byCategory.reduce((sum, row) => sum + row._count._all, 0), voidedCount,
          pendingCount: pending[0]?._count._all ?? 0, pendingSuggestedTotal: (pending[0]?._sum.suggestedAmount ?? 0n).toString(),
          byCategory: byCategory.map(row => { const c = names.find(n => n.id === row.categoryId); return { categoryId: row.categoryId, name: c?.name ?? null, archived: Boolean(c?.archivedAt), total: (row._sum.amount ?? 0n).toString(), count: row._count._all }; })
            .sort((a, b) => (BigInt(b.total) > BigInt(a.total) ? 1 : BigInt(b.total) < BigInt(a.total) ? -1 : 0)),
          byPaymentMethod: byMethod.map(row => ({ paymentMethod: row.paymentMethod, total: (row._sum.amount ?? 0n).toString(), count: row._count._all })),
        };
      }, { isolationLevel: "RepeatableRead" });
    },
    async detail(ownerId: string, id: string) {
      return database.$transaction(async tx => {
        const row = await tx.expense.findFirst({ where: { id, ownerId }, include: withCategory });
        if (!row) throw new ExpenseError("EXPENSE_NOT_FOUND");
        const events = await tx.expenseEvent.findMany({ where: { ownerId, entityKind: "EXPENSE", entityId: id }, orderBy: [{ occurredAt: "asc" }, { id: "asc" }], take: 50,
          select: { id: true, eventType: true, before: true, after: true, occurredAt: true } });
        return { expense: expenseView(row, true), events: events.map(e => ({ ...e, occurredAt: e.occurredAt.toISOString() })) };
      });
    },
  };
}
