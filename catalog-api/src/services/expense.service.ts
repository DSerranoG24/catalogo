import { makeExpenseRepository } from "../repositories/expense.repository";
import { categoryListSchema, categoryStateSchema, createCategorySchema, createExpenseSchema, expenseIdSchema, expenseListSchema, expenseSummarySchema,
  reclassifyExpenseSchema, seedCategoriesSchema, updateCategorySchema, voidExpenseSchema } from "../schemas/expense.schema";

/** Validates every input (strict Zod) before the repository; the owner always comes from the session. */
export function makeExpenseService(repository = makeExpenseRepository()) {
  return {
    listCategories: (owner: string, query: unknown) => repository.listCategories(owner, categoryListSchema.parse(query).status),
    seedCategories: (owner: string, body: unknown) => repository.seedCategories(owner, seedCategoriesSchema.parse(body)),
    createCategory: (owner: string, body: unknown) => repository.createCategory(owner, createCategorySchema.parse(body)),
    updateCategory: (owner: string, id: unknown, body: unknown) => repository.updateCategory(owner, expenseIdSchema.parse(id), updateCategorySchema.parse(body)),
    archiveCategory: (owner: string, id: unknown, body: unknown) => repository.setCategoryArchived(owner, expenseIdSchema.parse(id), true, categoryStateSchema.parse(body)),
    reactivateCategory: (owner: string, id: unknown, body: unknown) => repository.setCategoryArchived(owner, expenseIdSchema.parse(id), false, categoryStateSchema.parse(body)),
    listExpenses: (owner: string, query: unknown) => repository.listExpenses(owner, expenseListSchema.parse(query)),
    summary: (owner: string, query: unknown) => repository.summary(owner, expenseSummarySchema.parse(query)),
    detail: (owner: string, id: unknown) => repository.detail(owner, expenseIdSchema.parse(id)),
    createExpense: (owner: string, body: unknown) => repository.createExpense(owner, createExpenseSchema.parse(body)),
    reclassifyExpense: (owner: string, id: unknown, body: unknown) => repository.reclassifyExpense(owner, expenseIdSchema.parse(id), reclassifyExpenseSchema.parse(body)),
    voidExpense: (owner: string, id: unknown, body: unknown) => repository.voidExpense(owner, expenseIdSchema.parse(id), voidExpenseSchema.parse(body)),
  };
}
export type ExpenseService = ReturnType<typeof makeExpenseService>;
