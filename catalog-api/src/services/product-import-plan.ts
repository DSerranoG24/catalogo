import { createHash, createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { z } from "zod";
import { ImportProductRow } from "../schemas/product-import.schema";

const entrySchema = z.object({
  rowNumber: z.number().int(), hash: z.string(), action: z.enum(["create", "update", "error"]),
  productId: z.string().nullable(), productVersion: z.string().nullable(),
  categoryId: z.string().nullable(), categoryVersion: z.string().nullable(),
  nameKey: z.string(), skuKey: z.string(), bySku: z.boolean(),
  error: z.string().nullable(), conflict: z.boolean(),
  fields: z.array(z.string().max(50)).max(20).default([]),
});
export type ImportPlanEntry = z.infer<typeof entrySchema>;
const planSchema = z.object({
  version: z.literal(1), id: z.string().uuid(), catalogId: z.string().uuid(), userId: z.string(),
  expires: z.number(), totalRows: z.number().int().min(1).max(500), entries: z.array(entrySchema).max(500),
});
export type ImportPlan = z.infer<typeof planSchema>;
const domain = "catalogo:product-import:v1:";
export const importDigest = (value: string) => createHash("sha256").update(value).digest("hex");
export const importNameKey = (value: string) => value.trim().normalize("NFC").toLowerCase();
export function rowDigest(row: ImportProductRow): string {
  return importDigest(JSON.stringify(Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)))));
}
export function newImportPlan(catalogId: string, userId: string, totalRows: number): ImportPlan {
  return { version: 1, id: randomUUID(), catalogId, userId, totalRows, expires: Date.now() + 30 * 60_000, entries: [] };
}
function mac(payload: string, secret: string) {
  if (Buffer.byteLength(secret) < 32) throw new Error("IMPORT_CONFIGURATION");
  return createHmac("sha256", secret).update(domain + payload).digest();
}
export function signImportPlan(plan: ImportPlan, secret: string): string {
  const payload = Buffer.from(JSON.stringify(plan)).toString("base64url");
  return `${payload}.${mac(payload, secret).toString("base64url")}`;
}
export function readImportPlan(token: string, secret: string, catalogId: string, userId: string, totalRows: number): ImportPlan {
  try {
    if (token.length > 524288) throw new Error();
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) throw new Error();
    const actual = Buffer.from(signature, "base64url");
    const expected = mac(payload, secret);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error();
    const plan = planSchema.parse(JSON.parse(Buffer.from(payload, "base64url").toString("utf8")));
    if (plan.catalogId !== catalogId || plan.userId !== userId || plan.totalRows !== totalRows || plan.expires <= Date.now()) throw new Error();
    return plan;
  } catch { throw new Error("INVALID_IMPORT_PREVIEW"); }
}

export function markImportConflicts(entries: ImportPlanEntry[]): void {
  for (const entry of entries) entry.conflict = false;
  const groups = (key: (e: ImportPlanEntry) => string) => {
    const map = new Map<string, ImportPlanEntry[]>();
    for (const e of entries.filter(e => e.action !== "error")) {
      const k = key(e); if (!k) continue;
      const group = map.get(k) ?? []; group.push(e); map.set(k, group);
    }
    return [...map.values()].filter(g => g.length > 1);
  };
  for (const group of [...groups(e => e.productId ?? ""), ...groups(e => e.skuKey)]) for (const e of group) e.conflict = true;
  for (const group of groups(e => e.nameKey)) {
    if (group.some(e => !e.bySku)) for (const e of group) e.conflict = true;
  }
}
