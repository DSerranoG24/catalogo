import { z } from "zod";

/** POST /auth/close. confirmOpenBalances: the owner saw GET /auth/close/preview and accepts closing with money or deliveries open. */
export const accountClosureSchema = z.object({ confirmation: z.literal("CERRAR CUENTA"), password: z.string().max(128).optional(), idToken: z.string().max(10000).optional(),
  confirmOpenBalances: z.boolean().optional() }).strict();
