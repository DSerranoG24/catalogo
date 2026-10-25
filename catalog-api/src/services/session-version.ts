import jwt from "jsonwebtoken";
import { z } from "zod";
import { verifyToken } from "../utils/jwt";

const versionSchema = z.object({ sessionVersion: z.number().int().nonnegative().optional() });
export function verifiedSession(token: string) {
  const identity = verifyToken(token);
  // The exact same string has already passed signature/expiry verification above.
  const claims = versionSchema.parse(jwt.decode(token));
  return { ...identity, sessionVersion: claims.sessionVersion ?? 0 };
}
