import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../types/auth.types";
import { verifiedSession } from "../services/session-version";
import { findUserById } from "../repositories/user.repository";

export function makeAuthenticate(lookup = findUserById) {
return async function authenticate(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const authorization = req.headers.authorization;

    if (!authorization) {
      return res.status(401).json({
        success: false,
        message: "Token requerido",
      });
    }

    const [scheme, token] = authorization.split(" ");

    if (scheme !== "Bearer" || !token) {
      return res.status(401).json({
        success: false,
        message: "Formato de autorización inválido",
      });
    }

    const payload = verifiedSession(token);

    const user = await lookup(payload.userId);

    if (!user || user.closedAt || user.sessionVersion !== payload.sessionVersion) {
      return res.status(401).json({
        success: false,
        message: "Sesión no válida. Inicia sesión de nuevo.",
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
      emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
      hasLocalPassword: Boolean(user.passwordHash),
    };

    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Token inválido o expirado",
    });
  }
}
}
export const authenticate = makeAuthenticate();
