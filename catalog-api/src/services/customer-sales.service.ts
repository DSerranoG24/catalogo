import { makeCustomerSalesRepository } from "../repositories/customer-sales.repository";
import { customerIdSchema } from "../schemas/customer.schema";
import { customerSalesQuerySchema, type CustomerSalesQuery } from "../schemas/customer-sales.schema";

export function makeCustomerSalesService(repository = makeCustomerSalesRepository()) {
  return {
    async list(ownerId: string, customerId: string, query: CustomerSalesQuery) {
      const result = await repository.list(ownerId, customerIdSchema.parse(customerId), customerSalesQuerySchema.parse(query));
      if (!result) throw new Error("CUSTOMER_SALES_NOT_FOUND");
      return result;
    },
  };
}
