import type { Response, NextFunction } from "express";
import type { AuthenticatedRequest } from "../types/auth.types";
import { findUserRoleById } from "../repositories/user.repository";

export function makeRequireAdmin(lookup = findUserRoleById) {
  return async (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    res.setHeader("Cache-Control", "no-store");
    if (!req.user) return res.status(401).json({ success: false, message: "Sesión requerida" });
    try {
      const user = await lookup(req.user.id);
      if (!user || user.role !== "ADMIN") return res.status(404).json({ success: false, error: "ROUTE_NOT_FOUND" });
    } catch {
      return res.status(503).json({ success: false, error: "SERVICE_UNAVAILABLE" });
    }
    return next();
  };
}
export const requireAdmin = makeRequireAdmin();
