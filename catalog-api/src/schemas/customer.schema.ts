import { z } from "zod";

const fullName = z.string().max(500).transform(value => value.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1).max(160).regex(/^[^\u0000-\u001f\u007f]*$/));
export const customerPhoneSchema = z.string().trim().min(1).max(40)
  .regex(/^\+?(?:[0-9]+|\([0-9]+\))(?:[ .-]?(?:[0-9]+|\([0-9]+\)))*$/)
  .transform(value => value.replace(/[^0-9]/g, ""))
  .pipe(z.string().regex(/^[0-9]{7,15}$/));
const nullableText = (max: number) => z.string().trim().max(max).regex(/^[^\u0000]*$/)
  .transform(value => value || null).nullable().optional();
const fields = {
  fullName,
  phone: customerPhoneSchema,
  email: z.string().trim().max(254).pipe(z.union([z.email(), z.literal("")]))
    .transform(value => value || null).nullable().optional(),
  address: nullableText(300),
  notes: nullableText(2000),
};

export const createCustomerSchema = z.object(fields).strict();
export const updateCustomerSchema = z.object(fields).partial().strict()
  .refine(value => Object.values(value).some(field => field !== undefined), "Indica al menos un campo para actualizar");
export const customerIdSchema = z.uuid();
export const customerListSchema = z.object({
  q: z.string().trim().max(160).transform(value => value.replace(/\s+/g, " ")).default(""),
  status: z.enum(["active", "archived", "all"]).default("active"),
  page: z.string().regex(/^[1-9][0-9]{0,4}$/).transform(Number).pipe(z.number().max(10000)).default(1),
}).strict();
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type CustomerListQuery = z.infer<typeof customerListSchema>;
