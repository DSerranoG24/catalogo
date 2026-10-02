import { Request, Response } from "express";
import { getHealthStatus } from "../services/health.service";

export async function healthController(
  _req: Request,
  res: Response
) {
  try {
    const status = await getHealthStatus();

    res.json({
      success: true,
      ...status,
    });
  } catch (error) {
    console.error("Database health check failed:", error);

    res.status(500).json({
      success: false,
      api: "ok",
      database: "error",
    });
  }
}