import { makeOrderCustomerRepository } from "../repositories/order-customer.repository";
import { createCustomerSchema } from "../schemas/customer.schema";
import { confirmOrderCustomerSchema, orderCustomerMatchesSchema } from "../schemas/order-customer.schema";

export function makeOrderCustomerService(repository = makeOrderCustomerRepository()) {
  return {
    async matchingPage(ownerId: string, orderId: string, query: unknown) {
      const parsed = orderCustomerMatchesSchema.parse(query);
      return repository.matchingPage(ownerId, orderId, parsed.phone, parsed.page);
    },
    async preview(ownerId: string, orderId: string) {
      const preview = await repository.preview(ownerId, orderId);
      const parsed = createCustomerSchema.safeParse(preview.fields);
      return { ...preview, invalidFields: parsed.success ? [] : [...new Set(parsed.error.issues.map(issue => String(issue.path[0])))] };
    },
    async confirm(ownerId: string, orderId: string, input: unknown) {
      return repository.confirm(ownerId, orderId, confirmOrderCustomerSchema.parse(input));
    },
  };
}
