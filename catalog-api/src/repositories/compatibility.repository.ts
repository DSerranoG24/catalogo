import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../config/prisma";
import { lockInventoryOwner } from "./inventory.repository";
import { nextCompatibilityReview } from "../services/compatibility-review";
import { deviceNameKey, dictionaryMutationDto, compatibilityMutationDto,
  type DeviceListQuery, type CompatibilityPageQuery, type AddCompatibilityInput, type UpdateCompatibilityInput,
  type createDeviceBrandSchema, type createDeviceModelSchema, type addDeviceAliasSchema,
} from "../schemas/compatibility.schema";

const PAGE_SIZE = 25;
type Tx = Prisma.TransactionClient;
type EventDraft = { setId?: string; entityKind: string; entityId: string; eventType: string; before?: unknown; after: unknown };
function json(value: unknown): Prisma.InputJsonObject {
  return z.record(z.string(), z.json()).parse(JSON.parse(JSON.stringify(value)));
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
const names = (ownerId: string) => ({ where: { ownerId, isCanonical: true, retiredAt: null }, take: 1 });
const brandInclude = (ownerId: string) => ({ names: names(ownerId) }) satisfies Prisma.DeviceBrandInclude;
const modelInclude = (ownerId: string) => ({ names: names(ownerId), brand: { include: brandInclude(ownerId) } }) satisfies Prisma.DeviceModelInclude;
const relationInclude = (ownerId: string) => ({ model: { include: modelInclude(ownerId) } }) satisfies Prisma.ItemCompatibilityInclude;
type BrandRow = Prisma.DeviceBrandGetPayload<{ include: ReturnType<typeof brandInclude> }>;
type ModelRow = Prisma.DeviceModelGetPayload<{ include: ReturnType<typeof modelInclude> }>;
type RelationRow = Prisma.ItemCompatibilityGetPayload<{ include: ReturnType<typeof relationInclude> }>;
function label(row: { names: { label: string }[] }) {
  if (!row.names[0]) throw new Error("INVALID_DEVICE_DICTIONARY");
  return row.names[0].label;
}
const brandView = (row: BrandRow) => ({ id: row.id, name: label(row), version: row.version, retiredAt: row.retiredAt?.toISOString() ?? null });
const modelView = (row: ModelRow) => ({ ...brandView(row), brandId: row.brandId, brandName: label(row.brand), brandRetiredAt: row.brand.retiredAt?.toISOString() ?? null, manufacturerCode: row.manufacturerCode });
const aliasView = (row: { id: string; label: string; isCanonical: boolean; retiredAt: Date | null }) => ({ ...row, retiredAt: row.retiredAt?.toISOString() ?? null });
const relationView = (row: RelationRow) => ({
  id: row.id, version: row.version, status: row.status,
  model: { id: row.model.id, name: label(row.model), manufacturerCode: row.model.manufacturerCode, retiredAt: row.model.retiredAt?.toISOString() ?? null,
    brand: { id: row.model.brand.id, name: label(row.model.brand), retiredAt: row.model.brand.retiredAt?.toISOString() ?? null } },
  evidenceType: row.evidenceType, evidenceReference: row.evidenceReference, note: row.note, reviewReason: row.reviewReason,
  createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), verifiedAt: row.verifiedAt?.toISOString() ?? null,
});

export function makeCompatibilityRepository(database = prisma) {
  async function item(tx: Tx, ownerId: string, id: string) {
    if (!await tx.inventoryItem.findFirst({ where: { id, userId: ownerId }, select: { id: true } })) throw new Error("COMPATIBILITY_RESOURCE_NOT_FOUND");
  }
  async function brand(tx: Tx, ownerId: string, id: string) {
    const row = await tx.deviceBrand.findFirst({ where: { id, ownerId }, include: brandInclude(ownerId) });
    if (!row) throw new Error("COMPATIBILITY_RESOURCE_NOT_FOUND"); return row;
  }
  async function model(tx: Tx, ownerId: string, id: string) {
    const row = await tx.deviceModel.findFirst({ where: { id, ownerId }, include: modelInclude(ownerId) });
    if (!row) throw new Error("COMPATIBILITY_RESOURCE_NOT_FOUND"); return row;
  }
  async function mutation<T extends object>(ownerId: string, operationId: string, resourceKind: string, resourceId: string, input: unknown, schema: z.ZodType<T>, work: (tx: Tx) => Promise<{ result: T; events: EventDraft[] }>) {
    const requestHash = createHash("sha256").update(canonical({ resourceKind, resourceId, input })).digest("hex");
    return database.$transaction(async tx => {
      await lockInventoryOwner(tx, ownerId);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('compatibility-v1'), hashtext(${ownerId}))`;
      const prior = await tx.compatibilityOperation.findUnique({ where: { ownerId_operationId: { ownerId, operationId } } });
      if (prior) {
        if (prior.requestHash !== requestHash || prior.resourceKind !== resourceKind || prior.resourceId !== resourceId) throw new Error("IDEMPOTENCY_CONFLICT");
        return { ...schema.parse(prior.responseSnapshot), idempotent: true };
      }
      const { result, events } = await work(tx);
      const parsed = schema.parse(result);
      await tx.compatibilityOperation.create({ data: { ownerId, operationId, resourceKind, resourceId, requestHash, responseSnapshot: json(parsed) } });
      for (const event of events) await tx.compatibilityEvent.create({ data: {
        ownerId, operationId, setId: event.setId, actorId: ownerId, entityKind: event.entityKind, entityId: event.entityId, eventType: event.eventType,
        before: event.before === undefined ? Prisma.DbNull : json(event.before), after: json(event.after),
      } });
      return { ...parsed, idempotent: false };
    });
  }
  return {
    async brands(ownerId: string, query: DeviceListQuery) {
      const term = deviceNameKey(query.q).replace(/[\\%_]/g, "\\$&");
      const rows = await database.deviceBrand.findMany({ where: { ownerId,
        ...(query.status === "active" ? { retiredAt: null } : query.status === "retired" ? { retiredAt: { not: null } } : {}),
        ...(term ? { names: { some: { ownerId, retiredAt: null, normalizedKey: { contains: term } } } } : {}),
      }, include: brandInclude(ownerId), orderBy: { id: "asc" }, skip: (query.page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1 });
      return { items: rows.slice(0, PAGE_SIZE).map(brandView), page: query.page, pageSize: PAGE_SIZE, hasMore: rows.length > PAGE_SIZE };
    },
    async models(ownerId: string, brandId: string, query: DeviceListQuery) {
      return database.$transaction(async tx => {
        const parent = await brand(tx, ownerId, brandId);
        const term = deviceNameKey(query.q).replace(/[\\%_]/g, "\\$&");
        const rows = await tx.deviceModel.findMany({ where: { ownerId, brandId,
          ...(query.status === "active" ? { retiredAt: null, brand: { retiredAt: null } } : query.status === "retired" ? { OR: [{ retiredAt: { not: null } }, { brand: { retiredAt: { not: null } } }] } : {}),
          ...(term ? { AND: [{ OR: [{ names: { some: { ownerId, retiredAt: null, normalizedKey: { contains: term } } } }, { manufacturerCodeKey: { contains: term } }] }] } : {}),
        }, include: modelInclude(ownerId), orderBy: { id: "asc" }, skip: (query.page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1 });
        return { brand: brandView(parent), items: rows.slice(0, PAGE_SIZE).map(modelView), page: query.page, pageSize: PAGE_SIZE, hasMore: rows.length > PAGE_SIZE };
      });
    },
    async detail(ownerId: string, id: string, kind: "brand" | "model") {
      return database.$transaction(async tx => kind === "brand" ? brandView(await brand(tx, ownerId, id)) : modelView(await model(tx, ownerId, id)));
    },
    async aliases(ownerId: string, id: string, kind: "brand" | "model", page: number) {
      return database.$transaction(async tx => {
        if (kind === "brand") await brand(tx, ownerId, id); else await model(tx, ownerId, id);
        const args = { where: { ownerId, ...(kind === "brand" ? { brandId: id } : { modelId: id }) }, orderBy: { id: "asc" as const }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1 };
        const rows = kind === "brand" ? await tx.deviceBrandName.findMany(args) : await tx.deviceModelName.findMany(args);
        return { items: rows.slice(0, PAGE_SIZE).map(row => aliasView({ id: row.id, label: row.label, isCanonical: row.isCanonical, retiredAt: row.retiredAt })), page, pageSize: PAGE_SIZE, hasMore: rows.length > PAGE_SIZE };
      });
    },
    createBrand(ownerId: string, input: z.infer<typeof createDeviceBrandSchema>) {
      return mutation(ownerId, input.operationId, "BRAND_CREATE", ownerId, input, dictionaryMutationDto, async tx => {
        if (await tx.deviceBrandName.findFirst({ where: { ownerId, normalizedKey: deviceNameKey(input.name) }, select: { id: true } })) throw new Error("NAME_CONFLICT");
        const row = await tx.deviceBrand.create({ data: { ownerId, createdById: ownerId, updatedById: ownerId } });
        const name = await tx.deviceBrandName.create({ data: { ownerId, brandId: row.id, label: input.name, normalizedKey: deviceNameKey(input.name), isCanonical: true } });
        const entity = brandView(await brand(tx, ownerId, row.id));
        return { result: { entity }, events: [
          { entityKind: "BRAND", entityId: row.id, eventType: "CREATED", after: entity },
          { entityKind: "BRAND_NAME", entityId: name.id, eventType: "CANONICAL_CREATED", after: aliasView(name) },
        ] };
      });
    },
    createModel(ownerId: string, input: z.infer<typeof createDeviceModelSchema>) {
      return mutation(ownerId, input.operationId, "MODEL_CREATE", input.brandId, input, dictionaryMutationDto, async tx => {
        const parent = await brand(tx, ownerId, input.brandId); if (parent.retiredAt) throw new Error("DEVICE_RETIRED");
        if (await tx.deviceModelName.findFirst({ where: { ownerId, brandId: input.brandId, normalizedKey: deviceNameKey(input.name) }, select: { id: true } })) throw new Error("NAME_CONFLICT");
        const code = input.manufacturerCode ? deviceNameKey(input.manufacturerCode) : null;
        if (code && await tx.deviceModel.findFirst({ where: { ownerId, brandId: input.brandId, manufacturerCodeKey: code }, select: { id: true } })) throw new Error("MODEL_CODE_CONFLICT");
        const row = await tx.deviceModel.create({ data: { ownerId, brandId: input.brandId, manufacturerCode: input.manufacturerCode, manufacturerCodeKey: code, createdById: ownerId, updatedById: ownerId } });
        const name = await tx.deviceModelName.create({ data: { ownerId, brandId: input.brandId, modelId: row.id, label: input.name, normalizedKey: deviceNameKey(input.name), isCanonical: true } });
        const entity = modelView(await model(tx, ownerId, row.id));
        return { result: { entity }, events: [
          { entityKind: "MODEL", entityId: row.id, eventType: "CREATED", after: entity },
          { entityKind: "MODEL_NAME", entityId: name.id, eventType: "CANONICAL_CREATED", after: aliasView(name) },
        ] };
      });
    },
    addAlias(ownerId: string, id: string, kind: "brand" | "model", input: z.infer<typeof addDeviceAliasSchema>) {
      return mutation(ownerId, input.operationId, kind === "brand" ? "BRAND_ALIAS" : "MODEL_ALIAS", id, input, dictionaryMutationDto, async tx => {
        const parentModel = kind === "model" ? await model(tx, ownerId, id) : null;
        const parent = parentModel ?? await brand(tx, ownerId, id);
        if (parent.retiredAt || parentModel?.brand.retiredAt) throw new Error("DEVICE_RETIRED");
        if (parent.version !== input.expectedVersion) throw new Error("VERSION_CONFLICT");
        const normalizedKey = deviceNameKey(input.label);
        if (kind === "brand") {
          if (await tx.deviceBrandName.findFirst({ where: { ownerId, normalizedKey }, select: { id: true } })) throw new Error("NAME_CONFLICT");
          const name = await tx.deviceBrandName.create({ data: { ownerId, brandId: id, label: input.label, normalizedKey } });
          await tx.deviceBrand.update({ where: { id_ownerId: { id, ownerId } }, data: { version: { increment: 1 }, updatedById: ownerId } });
          const entity = brandView(await brand(tx, ownerId, id));
          return { result: { entity, name: aliasView(name) }, events: [
            { entityKind: "BRAND_NAME", entityId: name.id, eventType: "ALIAS_ADDED", after: { ...aliasView(name), brandId: id } },
            { entityKind: "BRAND", entityId: id, eventType: "UPDATED", before: brandView(parent), after: entity },
          ] };
        }
        const device = await model(tx, ownerId, id);
        if (await tx.deviceModelName.findFirst({ where: { ownerId, brandId: device.brandId, normalizedKey }, select: { id: true } })) throw new Error("NAME_CONFLICT");
        const name = await tx.deviceModelName.create({ data: { ownerId, brandId: device.brandId, modelId: id, label: input.label, normalizedKey } });
        await tx.deviceModel.update({ where: { id_ownerId: { id, ownerId } }, data: { version: { increment: 1 }, updatedById: ownerId } });
        const entity = modelView(await model(tx, ownerId, id));
        return { result: { entity, name: aliasView(name) }, events: [
          { entityKind: "MODEL_NAME", entityId: name.id, eventType: "ALIAS_ADDED", after: { ...aliasView(name), modelId: id } },
          { entityKind: "MODEL", entityId: id, eventType: "UPDATED", before: modelView(device), after: entity },
        ] };
      });
    },
    async list(ownerId: string, itemId: string, query: CompatibilityPageQuery) {
      return database.$transaction(async tx => {
        await item(tx, ownerId, itemId);
        const set = await tx.compatibilitySet.findFirst({ where: { ownerId, inventoryItemId: itemId } });
        const rows = set ? await tx.itemCompatibility.findMany({ where: { ownerId, setId: set.id, ...(query.status === "all" ? {} : { status: query.status }) }, include: relationInclude(ownerId), orderBy: [{ createdAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1 }) : [];
        return { source: { kind: "INVENTORY_ITEM" as const, id: itemId }, set: set ? { id: set.id, version: set.version } : null,
          compatibilities: rows.slice(0, PAGE_SIZE).map(relationView), page: query.page, pageSize: PAGE_SIZE, hasMore: rows.length > PAGE_SIZE };
      }, { isolationLevel: "RepeatableRead" });
    },
    add(ownerId: string, itemId: string, input: AddCompatibilityInput) {
      return mutation(ownerId, input.operationId, "COMPATIBILITY_ADD", itemId, input, compatibilityMutationDto, async tx => {
        await item(tx, ownerId, itemId);
        const device = await model(tx, ownerId, input.modelId);
        if (device.retiredAt || device.brand.retiredAt) throw new Error("DEVICE_RETIRED");
        let set = await tx.compatibilitySet.findFirst({ where: { ownerId, inventoryItemId: itemId } });
        if (set?.retiredAt) throw new Error("DEVICE_RETIRED");
        if (set && await tx.itemCompatibility.findFirst({ where: { ownerId, setId: set.id, modelId: device.id }, select: { id: true } })) throw new Error("COMPATIBILITY_ALREADY_EXISTS");
        if ((set?.version ?? 0) !== input.expectedSetVersion) throw new Error("VERSION_CONFLICT");
        const before = set ? { id: set.id, version: set.version } : undefined;
        if (!set) set = await tx.compatibilitySet.create({ data: { ownerId, inventoryItemId: itemId, createdById: ownerId, updatedById: ownerId } });
        else set = await tx.compatibilitySet.update({ where: { id_ownerId: { id: set.id, ownerId } }, data: { version: { increment: 1 }, updatedById: ownerId } });
        const row = await tx.itemCompatibility.create({ data: { ownerId, setId: set.id, modelId: device.id, createdById: ownerId, updatedById: ownerId }, include: relationInclude(ownerId) });
        const compatibility = relationView(row);
        return { result: { compatibility, setVersion: set.version }, events: [
          { setId: set.id, entityKind: "SET", entityId: set.id, eventType: before ? "UPDATED" : "CREATED", before, after: { id: set.id, version: set.version, inventoryItemId: itemId } },
          { setId: set.id, entityKind: "COMPATIBILITY", entityId: row.id, eventType: "CREATED", after: compatibility },
        ] };
      });
    },
    update(ownerId: string, itemId: string, id: string, input: UpdateCompatibilityInput) {
      return mutation(ownerId, input.operationId, "COMPATIBILITY_UPDATE", `${itemId}/${id}`, input, compatibilityMutationDto, async tx => {
        await item(tx, ownerId, itemId);
        const set = await tx.compatibilitySet.findFirst({ where: { ownerId, inventoryItemId: itemId } });
        if (!set) throw new Error("COMPATIBILITY_RESOURCE_NOT_FOUND");
        const row = await tx.itemCompatibility.findFirst({ where: { ownerId, setId: set.id, id }, include: relationInclude(ownerId) });
        if (!row) throw new Error("COMPATIBILITY_RESOURCE_NOT_FOUND");
        if (set.retiredAt) throw new Error("DEVICE_RETIRED");
        if (set.version !== input.expectedSetVersion || row.version !== input.expectedVersion) throw new Error("VERSION_CONFLICT");
        const next = nextCompatibilityReview(row, input, ownerId);
        if ((next.data.status === "VERIFIED" || next.data.status === "PENDING") && (row.model.retiredAt || row.model.brand.retiredAt)) throw new Error("DEVICE_RETIRED");
        if (!next.changed) return { result: { compatibility: relationView(row), setVersion: set.version }, events: [] };
        const updated = await tx.itemCompatibility.update({ where: { id_ownerId: { id, ownerId } }, data: { ...next.data, version: { increment: 1 }, updatedById: ownerId }, include: relationInclude(ownerId) });
        const updatedSet = await tx.compatibilitySet.update({ where: { id_ownerId: { id: set.id, ownerId } }, data: { version: { increment: 1 }, updatedById: ownerId } });
        return { result: { compatibility: relationView(updated), setVersion: updatedSet.version }, events: [
          { setId: set.id, entityKind: "COMPATIBILITY", entityId: id, eventType: row.status === updated.status ? "EDITED" : "STATUS_CHANGED", before: relationView(row), after: relationView(updated) },
          { setId: set.id, entityKind: "SET", entityId: set.id, eventType: "UPDATED", before: { id: set.id, version: set.version }, after: { id: set.id, version: updatedSet.version } },
        ] };
      });
    },
    async events(ownerId: string, itemId: string, page: number) {
      return database.$transaction(async tx => {
        await item(tx, ownerId, itemId);
        const rows = await tx.compatibilityEvent.findMany({ where: { ownerId, set: { ownerId, inventoryItemId: itemId } }, orderBy: [{ occurredAt: "desc" }, { id: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE + 1,
          select: { id: true, actorId: true, eventType: true, entityKind: true, entityId: true, before: true, after: true, occurredAt: true } });
        return { items: rows.slice(0, PAGE_SIZE), page, pageSize: PAGE_SIZE, hasMore: rows.length > PAGE_SIZE };
      }, { isolationLevel: "RepeatableRead" });
    },
  };
}
