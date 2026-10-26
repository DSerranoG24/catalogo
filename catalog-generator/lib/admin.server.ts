import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";

// React cache deduplicates metadata/page checks in one render, never across requests.
export const requireAdminAccess = cache(async () => {
  const token = (await cookies()).get("catalogo_session")?.value;
  if (!token) notFound();
  let allowed = false;
  try {
    const base = (process.env.CATALOG_API_URL ?? "http://localhost:3000/api").replace(/\/$/, "");
    const url = new URL(`${base}/admin/access`);
    if (url.username || url.password || (process.env.NODE_ENV === "production" && url.protocol !== "https:")) notFound();
    const response = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(6000) });
    const body: unknown = response.ok ? await response.json() : null;
    allowed = response.ok && typeof body === "object" && body !== null && "success" in body && body.success === true;
  } catch { allowed = false; }
  if (!allowed) notFound();
});
