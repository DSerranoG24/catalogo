import assert from "node:assert/strict";
import test from "node:test";
import { makeInventoryPublicationService } from "./inventory-publication.service";

function fakeDatabase(options: { failCreate?: boolean; missingItem?: boolean } = {}) {
  const calls: string[] = [];
  const tx = {
    $queryRaw: async () => [{ id: "owner" }],
    inventoryItem: { findFirst: async () => options.missingItem ? null : ({ id: "item" }) },
    inventoryItemImage: {
      updateMany: async () => ({ count: 0 }),
      create: async ({ data }: { data: unknown }) => { calls.push("create"); if (options.failCreate) throw new Error("DB_FAIL"); return data; },
    },
  } as any;
  return { calls, $transaction: async (fn: (client: typeof tx) => unknown) => fn(tx) } as any;
}

test("inventory image upload authorizes before Storage", async () => {
  const events: string[] = [];
  const db = fakeDatabase();
  const service = makeInventoryPublicationService(db, { uuid: () => "fixed", upload: async () => { events.push("upload"); return { id: "x", path: "owner/inventory/item/fixed.png", fullPath: "x" }; }, remove: async () => { events.push("remove"); return []; } });
  await service.uploadImage("owner", "item", { buffer: Buffer.from("x"), mimetype: "image/png" }, { isPrimary: true });
  assert.deepEqual(events, ["upload"]);
  assert.equal(db.calls[0], "create");
});

test("foreign inventory item is rejected before Storage upload", async () => {
  let uploads = 0;
  const service = makeInventoryPublicationService(fakeDatabase({ missingItem: true }), { uuid: () => "fixed", upload: async () => { uploads++; return { id: "x", path: "x", fullPath: "x" }; }, remove: async () => [] });
  await assert.rejects(() => service.uploadImage("owner", "foreign", { buffer: Buffer.from("x"), mimetype: "image/png" }), /NOT_FOUND/);
  assert.equal(uploads, 0);
});

test("inventory image upload compensates Storage when Prisma fails", async () => {
  const events: string[] = [];
  const db = fakeDatabase({ failCreate: true });
  const service = makeInventoryPublicationService(db, { uuid: () => "fixed", upload: async (_b, path) => { events.push(`upload:${path}`); return { id: "x", path, fullPath: path }; }, remove: async path => { events.push(`remove:${path}`); return []; } });
  await assert.rejects(() => service.uploadImage("owner", "item", { buffer: Buffer.from("x"), mimetype: "image/png" }));
  assert.deepEqual(events, ["upload:owner/inventory/item/fixed.png", "remove:owner/inventory/item/fixed.png"]);
});

