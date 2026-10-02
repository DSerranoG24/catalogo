import { Response, NextFunction } from "express";
import { AuthenticatedRequest } from "../types/auth.types";
import { verifyToken } from "../utils/jwt";
import { findUserById } from "../repositories/user.repository";

export async function authenticate(
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

    const payload = verifyToken(token);

    const user = await findUserById(payload.userId);

    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Usuario no encontrado",
      });
    }

    req.user = {
      id: user.id,
      email: user.email,
    };

    next();
  } catch {
    return res.status(401).json({
      success: false,
      message: "Token inválido o expirado",
    });
  }
}