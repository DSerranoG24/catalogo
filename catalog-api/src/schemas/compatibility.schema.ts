import { z } from "zod";
import { CompatibilityStatus, CompatibilityEvidenceType } from "@prisma/client";

export const compatibilityId = z.uuid();
const version = z.number().int().min(1).max(2147483647);
export function normalizeDeviceName(value: string) {
  return value.normalize("NFC").trim().replace(/\s+/gu, " ");
}
export function deviceNameKey(value: string) { return normalizeDeviceName(value).toLowerCase().normalize("NFC"); }
const safeText = (max: number) => z.string().max(max * 4).regex(/^[^\p{Cc}\p{Cf}]*$/u)
  .transform(normalizeDeviceName).pipe(z.string().min(1).max(max))
  .refine(value => deviceNameKey(value).length <= 320);
const nullableText = (max: number) => z.string().trim().max(max).regex(/^[^\u0000]*$/)
  .transform(value => value || null).nullable();
const operation = { operationId: compatibilityId };
export const createDeviceBrandSchema = z.object({ ...operation, name: safeText(100) }).strict();
export const createDeviceModelSchema = z.object({ ...operation, brandId: compatibilityId, name: safeText(160),
  manufacturerCode: z.union([safeText(100), z.literal("").transform(() => null), z.null()]).optional().default(null),
}).strict();
export const addDeviceAliasSchema = z.object({ ...operation, expectedVersion: version, label: safeText(160) }).strict();
export const addBrandAliasSchema = addDeviceAliasSchema.extend({ label: safeText(100) });
export const deviceListSchema = z.object({
  q: z.string().max(640).regex(/^[^\p{Cc}\p{Cf}]*$/u).transform(normalizeDeviceName).pipe(z.string().max(160)).default(""),
  page: z.string().regex(/^[1-9][0-9]{0,5}$/).transform(Number).pipe(z.number().max(100000)).default(1),
  status: z.enum(["active", "retired", "all"]).default("active"),
}).strict();
export const modelListSchema = deviceListSchema.extend({ brandId: compatibilityId });
export const compatibilityPageSchema = z.object({
  page: deviceListSchema.shape.page,
  status: z.union([z.literal("all"), z.enum(CompatibilityStatus)]).default("all"),
}).strict();
export const eventPageSchema = z.object({ page: deviceListSchema.shape.page }).strict();
export const addCompatibilitySchema = z.object({ ...operation, expectedSetVersion: version.or(z.literal(0)), modelId: compatibilityId }).strict();
export const updateCompatibilitySchema = z.object({ ...operation, expectedSetVersion: version, expectedVersion: version,
  status: z.enum(CompatibilityStatus).optional(), evidenceType: z.enum(CompatibilityEvidenceType).nullable().optional(),
  evidenceReference: nullableText(500).optional(), note: nullableText(1000).optional(), reviewReason: nullableText(500).optional(),
}).strict().refine(value => Object.keys(value).some(key => !["operationId", "expectedSetVersion", "expectedVersion"].includes(key)));

const date = z.iso.datetime();
export const deviceBrandDto = z.object({ id: compatibilityId, name: z.string(), version, retiredAt: date.nullable() });
export const deviceModelDto = deviceBrandDto.extend({ brandId: compatibilityId, brandName: z.string(), brandRetiredAt: date.nullable(), manufacturerCode: z.string().nullable() });
export const aliasDto = z.object({ id: compatibilityId, label: z.string(), isCanonical: z.boolean(), retiredAt: date.nullable() });
export const dictionaryMutationDto = z.object({ entity: z.union([deviceModelDto, deviceBrandDto]), name: aliasDto.optional() });
export const itemCompatibilityDto = z.object({
  id: compatibilityId, version, status: z.enum(CompatibilityStatus),
  model: z.object({ id: compatibilityId, name: z.string(), manufacturerCode: z.string().nullable(), retiredAt: date.nullable(),
    brand: z.object({ id: compatibilityId, name: z.string(), retiredAt: date.nullable() }) }),
  evidenceType: z.enum(CompatibilityEvidenceType).nullable(), evidenceReference: z.string().nullable(), note: z.string().nullable(), reviewReason: z.string().nullable(),
  createdAt: date, updatedAt: date, verifiedAt: date.nullable(),
});
export const compatibilityMutationDto = z.object({ compatibility: itemCompatibilityDto, setVersion: version });
export type DeviceListQuery = z.infer<typeof deviceListSchema>;
export type CompatibilityPageQuery = z.infer<typeof compatibilityPageSchema>;
export type AddCompatibilityInput = z.infer<typeof addCompatibilitySchema>;
export type UpdateCompatibilityInput = z.infer<typeof updateCompatibilitySchema>;
