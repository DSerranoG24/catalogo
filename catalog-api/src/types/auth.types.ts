import { Request } from "express";

export interface AuthenticatedRequest extends Request {
  user?: {
    id: string;
    email: string;
    emailVerifiedAt?: string | null;
    hasLocalPassword?: boolean;
  };
}
