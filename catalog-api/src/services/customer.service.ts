import { makeCustomerRepository } from "../repositories/customer.repository";
import type { CreateCustomerInput, UpdateCustomerInput } from "../schemas/customer.schema";

function warnings(duplicatePhone: boolean) {
  return duplicatePhone ? [{ code: "CUSTOMER_PHONE_MATCH", message: "Ya existe otro cliente con este teléfono. Revisa la coincidencia; la operación se completó." }] : [];
}

export function makeCustomerService(repository = makeCustomerRepository()) {
  return {
    async create(ownerId: string, input: CreateCustomerInput) {
      const result = await repository.create(ownerId, input);
      return { customer: result.customer, warnings: warnings(result.duplicatePhone) };
    },
    list: repository.list,
    async detail(ownerId: string, id: string) {
      const customer = await repository.detail(ownerId, id);
      if (!customer) throw new Error("CUSTOMER_NOT_FOUND");
      return customer;
    },
    async update(ownerId: string, id: string, input: UpdateCustomerInput) {
      const result = await repository.update(ownerId, id, input);
      return { customer: result.customer, warnings: warnings(result.duplicatePhone) };
    },
    archive: (ownerId: string, id: string) => repository.setArchived(ownerId, id, true),
    reactivate: (ownerId: string, id: string) => repository.setArchived(ownerId, id, false),
  };
}
