import { Request, Response } from "express";
import { z } from "zod";
import {
  registerUser,
  loginUser,
  loginWithGoogle,
} from "../services/auth.service";
import {
  registerSchema,
  loginSchema,
} from "../schemas/auth.schema";

export async function registerController(
  req: Request,
  res: Response
) {
  try {
    const data = registerSchema.parse(req.body);

    const result = await registerUser(data);

    res.status(201).json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "EMAIL_ALREADY_EXISTS") {
        return res.status(409).json({
          success: false,
          message: "El correo ya está registrado",
        });
      }
    }

    return res.status(400).json({
      success: false,
      message: "Datos de registro inválidos",
    });
  }
}

export async function loginController(
  req: Request,
  res: Response
) {
  try {
    const data = loginSchema.parse(req.body);

    const result = await loginUser(data);

    res.json({
      success: true,
      ...result,
    });
  } catch (error) {
    if (error instanceof Error) {
      if (error.message === "INVALID_CREDENTIALS") {
        return res.status(401).json({
          success: false,
          message: "Credenciales inválidas",
        });
      }
    }

    return res.status(400).json({
      success: false,
      message: "Datos de inicio de sesión inválidos",
    });
  }
}

export async function googleAuthController(req: Request, res: Response) {
  try {
    const idToken = z.string().min(1).max(10_000).parse(req.body?.idToken);
    const result = await loginWithGoogle(idToken);
    return res.json({ success: true, ...result });
  } catch (error) {
    if (error instanceof Error && error.message === "GOOGLE_AUTH_NOT_CONFIGURED") {
      return res.status(503).json({ success: false, message: "El inicio de sesión con Google no está configurado." });
    }
    return res.status(401).json({ success: false, message: "No se pudo verificar la cuenta de Google." });
  }
}