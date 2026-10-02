import { checkDatabaseConnection } from "../repositories/health.repository";

export async function getHealthStatus() {
  await checkDatabaseConnection();

  return {
    api: "ok",
    database: "ok",
  };
}