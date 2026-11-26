import { makeExpenseRepository } from "../repositories/expense.repository";
import { expenseOverviewSchema, readExpenseOverview } from "../repositories/expense-overview.repository";
import { makeScheduledExpenseRepository } from "../repositories/scheduled-expense.repository";
import { cancelScheduledSchema, createRecurringSchema, createScheduledSchema, payScheduledSchema, recurringListSchema, recurringStateSchema, scheduledListSchema,
  updateRecurringSchema, updateScheduledSchema } from "../schemas/scheduled-expense.schema";
import { categoryListSchema, categoryStateSchema, createCategorySchema, createExpenseSchema, expenseIdSchema, expenseListSchema, expenseSummarySchema,
  reclassifyExpenseSchema, seedCategoriesSchema, updateCategorySchema, voidExpenseSchema } from "../schemas/expense.schema";

/** Validates every input (strict Zod) before the repository; the owner always comes from the session. */
export function makeExpenseService(repository = makeExpenseRepository(), overview = readExpenseOverview, scheduled = makeScheduledExpenseRepository()) {
  return {
    listCategories: (owner: string, query: unknown) => repository.listCategories(owner, categoryListSchema.parse(query).status),
    seedCategories: (owner: string, body: unknown) => repository.seedCategories(owner, seedCategoriesSchema.parse(body)),
    createCategory: (owner: string, body: unknown) => repository.createCategory(owner, createCategorySchema.parse(body)),
    updateCategory: (owner: string, id: unknown, body: unknown) => repository.updateCategory(owner, expenseIdSchema.parse(id), updateCategorySchema.parse(body)),
    archiveCategory: (owner: string, id: unknown, body: unknown) => repository.setCategoryArchived(owner, expenseIdSchema.parse(id), true, categoryStateSchema.parse(body)),
    reactivateCategory: (owner: string, id: unknown, body: unknown) => repository.setCategoryArchived(owner, expenseIdSchema.parse(id), false, categoryStateSchema.parse(body)),
    listExpenses: (owner: string, query: unknown) => repository.listExpenses(owner, expenseListSchema.parse(query)),
    summary: (owner: string, query: unknown) => repository.summary(owner, expenseSummarySchema.parse(query)),
    overview: (owner: string, query: unknown) => overview(owner, expenseOverviewSchema.parse(query).month),
    // F1b: fixed expenses and scheduled payments (docs/expenses-f1b-contract.md).
    syncScheduled: (owner: string) => scheduled.sync(owner),
    listRecurring: (owner: string, query: unknown) => scheduled.listRecurring(owner, recurringListSchema.parse(query).status),
    createRecurring: (owner: string, body: unknown) => scheduled.createRecurring(owner, createRecurringSchema.parse(body)),
    updateRecurring: (owner: string, id: unknown, body: unknown) => scheduled.updateRecurring(owner, expenseIdSchema.parse(id), updateRecurringSchema.parse(body)),
    recurringState: (owner: string, id: unknown, action: "pause" | "resume" | "end", body: unknown) => scheduled.setRecurringState(owner, expenseIdSchema.parse(id), action, recurringStateSchema.parse(body)),
    listScheduled: (owner: string, query: unknown) => scheduled.listScheduled(owner, scheduledListSchema.parse(query)),
    createScheduled: (owner: string, body: unknown) => scheduled.createScheduled(owner, createScheduledSchema.parse(body)),
    updateScheduled: (owner: string, id: unknown, body: unknown) => scheduled.updateScheduled(owner, expenseIdSchema.parse(id), updateScheduledSchema.parse(body)),
    payScheduled: (owner: string, id: unknown, body: unknown) => scheduled.payScheduled(owner, expenseIdSchema.parse(id), payScheduledSchema.parse(body)),
    cancelScheduled: (owner: string, id: unknown, body: unknown) => scheduled.cancelScheduled(owner, expenseIdSchema.parse(id), cancelScheduledSchema.parse(body)),
    detail: (owner: string, id: unknown) => repository.detail(owner, expenseIdSchema.parse(id)),
    createExpense: (owner: string, body: unknown) => repository.createExpense(owner, createExpenseSchema.parse(body)),
    reclassifyExpense: (owner: string, id: unknown, body: unknown) => repository.reclassifyExpense(owner, expenseIdSchema.parse(id), reclassifyExpenseSchema.parse(body)),
    voidExpense: (owner: string, id: unknown, body: unknown) => repository.voidExpense(owner, expenseIdSchema.parse(id), voidExpenseSchema.parse(body)),
  };
}
export type ExpenseService = ReturnType<typeof makeExpenseService>;
