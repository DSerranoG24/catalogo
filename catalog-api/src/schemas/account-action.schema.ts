import { z } from "zod";

export const actionTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const verificationRequestSchema = z.object({}).strict();
export const confirmEmailSchema = z.object({ token: actionTokenSchema }).strict();
export const forgotPasswordSchema = z.object({ email: z.string().trim().max(254).email().transform(email => email.toLowerCase()) }).strict();
export const resetPasswordSchema = z.object({
  token: actionTokenSchema,
  password: z.string().min(8).refine(value => Buffer.byteLength(value, "utf8") <= 72),
  passwordConfirmation: z.string().max(72),
}).strict().refine(value => value.password === value.passwordConfirmation);
export const linkGoogleSchema = z.object({ idToken: z.string().min(1).max(10_000), password: z.string().min(1).max(1024) }).strict();
