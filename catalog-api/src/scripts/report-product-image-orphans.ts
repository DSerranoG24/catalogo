import "dotenv/config";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Prisma, PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";

const bucket = "product-images";
const pageSize = 100;
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const uuidPattern = new RegExp(`^${uuid}$`, "i");
const productPath = new RegExp(`^${uuid}/${uuid}/${uuid}\\.(?:jpeg|jpg|png|webp)$`, "i");
const otherPath = new RegExp(`^${uuid}/(?:branding|banners)/${uuid}\\.(?:jpeg|jpg|png|webp)$|^${uuid}/categories/${uuid}/${uuid}\\.(?:jpeg|jpg|png|webp)$`, "i");

type Reference = { source: string; id: string; catalogId: string | null; value: unknown; optional?: boolean };
export type ReferenceSnapshot = { catalogIds: string[]; references: Reference[]; closurePrefixes: string[] };
export type ListedObject = { name: string; id: string | null; created_at?: string | null; updated_at?: string | null; metadata?: { size?: unknown } | null };
type Anomaly = { source: string; id: string; catalogId: string | null; reason: string };
type ReportError = { operation: string; code: string };
type StoredObject = { path: string; createdAt: string | null; updatedAt: string | null; bytes: number | null };
export type ReportDependencies = {
  readReferences(): Promise<ReferenceSnapshot>;
  list(prefix: string, offset: number): Promise<ListedObject[]>;
};

function referenceIndex(snapshot: ReferenceSnapshot) {
  const paths = new Set<string>(), scopes = new Set<string>(), anomalies: Anomaly[] = [];
  let globalBlock = false;
  const anomaly = (reference: Reference, reason: string) => {
    const catalogId = reference.catalogId && uuidPattern.test(reference.catalogId) ? reference.catalogId : null;
    // Do not include the original value: historical URLs can contain credentials or tokens.
    anomalies.push({ source: reference.source, id: reference.id, catalogId, reason });
    if (catalogId) scopes.add(catalogId); else globalBlock = true;
  };
  for (const reference of snapshot.references) {
    if (reference.value === null && reference.optional) continue;
    if (typeof reference.value !== "string" || (!productPath.test(reference.value) && !otherPath.test(reference.value))) {
      anomaly(reference, "UNINTERPRETABLE_REFERENCE"); continue;
    }
    // Even a cross-catalog reference protects the exact object it names.
    paths.add(reference.value);
    if (!reference.catalogId || !reference.value.startsWith(`${reference.catalogId}/`)) {
      scopes.add(reference.value.split("/")[0]);
      anomaly(reference, "REFERENCE_SCOPE_MISMATCH");
    }
  }
  for (const prefix of snapshot.closurePrefixes) {
    if (!uuidPattern.test(prefix)) {
      globalBlock = true;
      anomalies.push({ source: "AccountClosureJob.catalogIds", id: "omitted", catalogId: null, reason: "INVALID_CLOSURE_PREFIX" });
    }
  }
  for (const id of snapshot.catalogIds) {
    if (!uuidPattern.test(id)) {
      globalBlock = true;
      anomalies.push({ source: "Catalog.id", id: "omitted", catalogId: null, reason: "INVALID_CATALOG_ID" });
    }
  }
  return { paths, scopes, anomalies, globalBlock };
}

function timestamp(value: string | null) {
  // Require an explicit timezone; never interpret server dates in the operator's local zone.
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()
    || Number(value.slice(11, 13)) > 23 || Number(value.slice(14, 16)) > 59 || Number(value.slice(17, 19)) > 59) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : null;
}

export async function buildProductImageOrphanReport(deps: ReportDependencies, startedAt = new Date()) {
  const cutoff = new Date(startedAt.getTime() - 24 * 3600_000);
  const errors: ReportError[] = [], objects: StoredObject[] = [];
  let initial: ReferenceSnapshot = { catalogIds: [], references: [], closurePrefixes: [] };
  let final: ReferenceSnapshot = initial;
  try { initial = await deps.readReferences(); }
  catch { errors.push({ operation: "INITIAL_REFERENCES", code: "REFERENCE_READ_FAILED" }); }
  const prefixes = [""], visited = new Set<string>(), seenObjects = new Set<string>();
  if (!errors.length) for (let index = 0; index < prefixes.length; index++) {
    const prefix = prefixes[index];
    if (visited.has(prefix)) continue;
    visited.add(prefix);
    const pages = new Set<string>();
    for (let offset = 0; ; offset += pageSize) {
      let entries: ListedObject[];
      try { entries = await deps.list(prefix, offset); }
      catch { errors.push({ operation: "STORAGE_LIST", code: "LIST_FAILED" }); break; }
      if (!Array.isArray(entries) || entries.length > pageSize) {
        errors.push({ operation: "STORAGE_LIST", code: "INVALID_LIST_RESPONSE" }); break;
      }
      if (entries.some(entry => !entry || typeof entry !== "object")) {
        errors.push({ operation: "STORAGE_LIST", code: "INVALID_LIST_ENTRY" }); break;
      }
      const fingerprint = JSON.stringify(entries.map(entry => [entry.name, entry.id]));
      if (entries.length && pages.has(fingerprint)) {
        errors.push({ operation: "STORAGE_LIST", code: "REPEATED_PAGE" }); break;
      }
      pages.add(fingerprint);
      for (const entry of entries) {
        if (typeof entry.name !== "string" || !/^[a-zA-Z0-9_.-]+$/.test(entry.name) || entry.name === "." || entry.name === "..") {
          errors.push({ operation: "STORAGE_LIST", code: "UNSAFE_ENTRY_NAME" }); continue;
        }
        const path = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.id === null) { prefixes.push(path); continue; }
        if (typeof entry.id !== "string" || !entry.id) {
          errors.push({ operation: "STORAGE_LIST", code: "INVALID_OBJECT_ID" }); continue;
        }
        if (seenObjects.has(path)) continue;
        seenObjects.add(path);
        const size = entry.metadata?.size;
        const created = timestamp(entry.created_at ?? null), updated = timestamp(entry.updated_at ?? null);
        objects.push({ path, createdAt: created === null ? null : new Date(created).toISOString(), updatedAt: updated === null ? null : new Date(updated).toISOString(),
          bytes: typeof size === "number" && Number.isSafeInteger(size) && size >= 0 ? size : null });
      }
      if (entries.length < pageSize) break;
    }
  }
  // Read every source again, even after a partial Storage failure. Protect the union of both reads.
  try { final = await deps.readReferences(); }
  catch { errors.push({ operation: "FINAL_REFERENCES", code: "REFERENCE_READ_FAILED" }); }
  const first = referenceIndex(initial), last = referenceIndex(final);
  const anomalies = [...new Map([...first.anomalies, ...last.anomalies].map(item => [JSON.stringify(item), item])).values()];
  const blockedCatalogIds = new Set([...first.scopes, ...last.scopes]);
  const globalBlock = !!errors.length || first.globalBlock || last.globalBlock;
  const catalogs = new Set(final.catalogIds.filter(id => initial.catalogIds.includes(id)));
  const references = new Set([...first.paths, ...last.paths]);
  const closurePrefixes = new Set([...initial.closurePrefixes, ...final.closurePrefixes]);
  const candidates: (StoredObject & { ageHours: number })[] = [];
  const exclusions: (StoredObject & { reason: string })[] = [];
  const outOfScope: (StoredObject & { reason: string })[] = [];
  for (const object of objects) {
    const catalogId = object.path.split("/")[0];
    if (!productPath.test(object.path)) {
      outOfScope.push({ ...object, reason: otherPath.test(object.path) ? "LOGO_CATEGORY_OR_BANNER" : "UNKNOWN_PATH_FORMAT" }); continue;
    }
    let reason: string | undefined;
    const created = timestamp(object.createdAt), updated = timestamp(object.updatedAt);
    if (!catalogs.has(catalogId)) reason = "CATALOG_MISSING_OR_CHANGED_REVIEW";
    else if (references.has(object.path)) reason = "REFERENCED";
    else if (closurePrefixes.has(catalogId)) reason = "ACCOUNT_CLOSURE_SCOPE";
    else if (globalBlock || blockedCatalogIds.has(catalogId)) reason = "BLOCKED_BY_ANOMALY_OR_ERROR";
    else if (created === null || updated === null || updated < created) reason = "MISSING_OR_INVALID_DATE";
    else if (Math.max(created, updated) >= cutoff.getTime()) reason = "LESS_THAN_OR_EQUAL_TO_24_HOURS";
    if (reason) exclusions.push({ ...object, reason });
    else {
      // The branch above checked both timestamps. Keep a runtime guard rather than an assertion.
      if (created === null || updated === null) throw new Error("INVALID_REPORT_STATE");
      candidates.push({ ...object, ageHours: (startedAt.getTime() - Math.max(created, updated)) / 3600_000 });
    }
  }
  const bytes = (rows: StoredObject[]) => rows.reduce((sum, row) => sum + (row.bytes ?? 0), 0);
  return { mode: "REPORT_ONLY", bucket, startedAt: startedAt.toISOString(), cutoff: cutoff.toISOString(),
    completedAt: new Date().toISOString(), complete: errors.length === 0, globalBlock,
    blockedCatalogIds: [...blockedCatalogIds].sort(),
    limitations: ["Manual review only; this report does not authorize deletion.", "Paginated Storage listing is not an atomic snapshot.", "Recent uploads and unknown dates are excluded; metadata and references may change after this report."],
    counts: { objects: objects.length, candidates: candidates.length, exclusions: exclusions.length,
      outOfScope: outOfScope.length, anomalies: anomalies.length, errors: errors.length,
      objectsWithUnknownSize: objects.filter(object => object.bytes === null).length },
    knownBytes: { total: bytes(objects), candidates: bytes(candidates), exclusions: bytes(exclusions), outOfScope: bytes(outOfScope) },
    candidates, exclusions, outOfScope, anomalies, errors };
}

async function readSnapshot(database: PrismaClient): Promise<ReferenceSnapshot> {
  return database.$transaction(async tx => {
    await tx.$executeRaw`SET TRANSACTION READ ONLY`;
    const snapshot: ReferenceSnapshot = { catalogIds: [], references: [], closurePrefixes: [] };
    // Bounded result pages, one consistent database snapshot per read.
    async function pages<T extends { id: string }>(read: (cursor: string | undefined) => Promise<T[]>, visit: (row: T) => void) {
      let cursor: string | undefined;
      for (;;) { const rows = await read(cursor); rows.forEach(visit); if (rows.length < 500) break; cursor = rows[rows.length - 1].id; }
    }
    const paging = (cursor: string | undefined) => ({ take: 500, orderBy: { id: "asc" as const }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    await pages(cursor => tx.catalog.findMany({ ...paging(cursor), select: { id: true, logoUrl: true } }), row => {
      snapshot.catalogIds.push(row.id);
      snapshot.references.push({ source: "Catalog.logoUrl", id: row.id, catalogId: row.id, value: row.logoUrl, optional: true });
    });
    await pages(cursor => tx.productImage.findMany({ ...paging(cursor), select: { id: true, url: true, product: { select: { catalogId: true } } } }), row => {
      snapshot.references.push({ source: "ProductImage.url", id: row.id, catalogId: row.product.catalogId, value: row.url });
    });
    await pages(cursor => tx.category.findMany({ ...paging(cursor), select: { id: true, catalogId: true, imageUrl: true } }), row => {
      snapshot.references.push({ source: "Category.imageUrl", id: row.id, catalogId: row.catalogId, value: row.imageUrl, optional: true });
    });
    await pages(cursor => tx.catalogBanner.findMany({ ...paging(cursor), select: { id: true, catalogId: true, imagePath: true } }), row => {
      snapshot.references.push({ source: "CatalogBanner.imagePath", id: row.id, catalogId: row.catalogId, value: row.imagePath });
    });
    await pages(cursor => tx.productImageCleanupTask.findMany({ ...paging(cursor), select: { id: true, catalogId: true, bucket: true, path: true } }), row => {
      snapshot.references.push({ source: "ProductImageCleanupTask.path", id: row.id, catalogId: row.catalogId,
        value: row.bucket === bucket ? row.path : null });
    });
    await pages(cursor => tx.accountClosureJob.findMany({ ...paging(cursor), select: { id: true, catalogIds: true, pendingPaths: true } }), row => {
      snapshot.closurePrefixes.push(...row.catalogIds);
      for (const path of row.pendingPaths) snapshot.references.push({ source: "AccountClosureJob.pendingPaths", id: row.id,
        catalogId: row.catalogIds.find(id => path.startsWith(`${id}/`)) ?? null, value: path });
    });
    return snapshot;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 120000 });
}

// SDK transport is restricted to listing this bucket, even if supplied a privileged key.
export function listingOnlyFetch(baseUrl: string, transport: typeof fetch = fetch): typeof fetch {
  const origin = new URL(baseUrl).origin;
  return async (input, init) => {
    const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
    const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
    if (url.origin !== origin || url.pathname !== `/storage/v1/object/list/${bucket}` || method !== "POST") throw new Error("READ_ONLY_STORAGE_TRANSPORT");
    return transport(input, { ...init, redirect: "error" });
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 1 || !args[0] || args[0].startsWith("--")) throw new Error("OUTPUT_REQUIRED");
  const output = resolve(args[0]);
  if (!output.toLowerCase().endsWith(".json")) throw new Error("JSON_OUTPUT_REQUIRED");
  if (!process.env.DATABASE_URL || !process.env.SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) throw new Error("CONFIGURATION_REQUIRED");
  const database = new PrismaClient({ log: [] });
  try {
    const client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SECRET_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: listingOnlyFetch(process.env.SUPABASE_URL) },
    });
    const report = await buildProductImageOrphanReport({ readReferences: () => readSnapshot(database),
      list: async (prefix, offset) => {
        const result = await client.storage.from(bucket).list(prefix, { limit: pageSize, offset, sortBy: { column: "name", order: "asc" } });
        if (result.error) throw new Error("STORAGE_LIST_FAILED");
        return result.data;
      },
    });
    // Refuse to overwrite an existing file, including configuration accidentally supplied as output.
    await writeFile(output, JSON.stringify(report, null, 2) + "\n", { encoding: "utf8", flag: "wx" });
    console.log(JSON.stringify({ mode: report.mode, complete: report.complete, counts: report.counts, knownBytes: report.knownBytes }));
    if (!report.complete || report.globalBlock || report.anomalies.length) process.exitCode = 2;
  } finally { await database.$disconnect(); }
}

if (require.main === module) void main().catch(() => {
  console.error("REPORT_FAILED: comprueba configuración, permisos y que la salida JSON no exista. No se han ejecutado borrados.");
  process.exitCode = 1;
});
