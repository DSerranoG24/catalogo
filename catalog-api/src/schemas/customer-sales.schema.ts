import { z } from "zod";
import { SaleStatus } from "@prisma/client";

export const customerSalesQuerySchema = z.object({
  cursor: z.uuid().optional(),
  status: z.union([z.literal("all"), z.enum(SaleStatus)]).default("all"),
}).strict();
export type CustomerSalesQuery = z.infer<typeof customerSalesQuerySchema>;
