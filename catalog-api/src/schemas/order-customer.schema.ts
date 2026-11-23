import { z } from "zod";
import { createCustomerSchema, customerPhoneSchema } from "./customer.schema";

export const orderCustomerPreviewSchema = z.object({}).strict();
export const orderCustomerMatchesSchema = z.object({ phone: customerPhoneSchema, page: z.string().regex(/^[1-9][0-9]{0,4}$/).transform(Number).pipe(z.number().max(10000)).default(1) }).strict();
export const confirmOrderCustomerSchema = z.discriminatedUnion("action", [
  z.object({ operationId: z.uuid(), action: z.literal("CREATE"), customer: createCustomerSchema, associateSale: z.boolean().default(false) }).strict(),
  z.object({ operationId: z.uuid(), action: z.literal("USE_EXISTING"), customerId: z.uuid(), phone: customerPhoneSchema, associateSale: z.boolean().default(false) }).strict(),
]);
export type ConfirmOrderCustomer = z.infer<typeof confirmOrderCustomerSchema>;
