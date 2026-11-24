import { makeCompatibilityRepository } from "../repositories/compatibility.repository";
import { compatibilityId, deviceListSchema, modelListSchema, eventPageSchema, compatibilityPageSchema,
  createDeviceBrandSchema, createDeviceModelSchema, addBrandAliasSchema, addDeviceAliasSchema,
  addCompatibilitySchema, updateCompatibilitySchema } from "../schemas/compatibility.schema";

export function makeCompatibilityService(repository = makeCompatibilityRepository()) {
  return {
    brands: (owner: string, query: unknown) => repository.brands(owner, deviceListSchema.parse(query)),
    models: (owner: string, query: unknown) => { const { brandId, ...rest } = modelListSchema.parse(query); return repository.models(owner, brandId, rest); },
    detail: (owner: string, id: unknown, kind: "brand" | "model") => repository.detail(owner, compatibilityId.parse(id), kind),
    aliases: (owner: string, id: unknown, kind: "brand" | "model", query: unknown) => repository.aliases(owner, compatibilityId.parse(id), kind, eventPageSchema.parse(query).page),
    createBrand: (owner: string, body: unknown) => repository.createBrand(owner, createDeviceBrandSchema.parse(body)),
    createModel: (owner: string, body: unknown) => repository.createModel(owner, createDeviceModelSchema.parse(body)),
    addAlias: (owner: string, id: unknown, kind: "brand" | "model", body: unknown) => repository.addAlias(owner, compatibilityId.parse(id), kind, (kind === "brand" ? addBrandAliasSchema : addDeviceAliasSchema).parse(body)),
    list: (owner: string, id: unknown, query: unknown) => repository.list(owner, compatibilityId.parse(id), compatibilityPageSchema.parse(query)),
    add: (owner: string, id: unknown, body: unknown) => repository.add(owner, compatibilityId.parse(id), addCompatibilitySchema.parse(body)),
    update: (owner: string, itemId: unknown, id: unknown, body: unknown) => repository.update(owner, compatibilityId.parse(itemId), compatibilityId.parse(id), updateCompatibilitySchema.parse(body)),
    events: (owner: string, id: unknown, query: unknown) => repository.events(owner, compatibilityId.parse(id), eventPageSchema.parse(query).page),
  };
}
