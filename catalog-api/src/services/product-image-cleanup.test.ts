import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { deleteProduct } from "../repositories/product.repository";
import { deleteProductImage } from "../repositories/product-image.repository";
import { assertProductImagePath } from "../repositories/product-image-cleanup.repository";
import { runProductImageCleanupBatch } from "./product-image-cleanup-worker";
import { makeProductBulkService } from "./product-bulk.service";

const catalogId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const fileId = "33333333-3333-4333-8333-333333333333";
const path = `${catalogId}/${productId}/${fileId}.jpeg`;
const date = new Date("2026-10-28T12:00:00Z");
function fixture() {
  let images = [{ id: "image", productId, url: path, product: { catalogId } }];
  let products = [{ id: productId, catalogId, name: "Producto", updatedAt: date, price: 100, salePrice: null,
    saleStartsAt: null, saleEndsAt: null, categoryId: null, needsCompletion: false, active: true }];
  let tasks: { id: string; path: string; bucket: string; catalogId: string; attempts: number; nextAttemptAt: Date }[] = [];
  let active = false, failEnqueue = false, failCommit = false;
  const database = new Proxy(prisma, { get(_target, key) {
    if (key === "$transaction") return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => {
      const before = structuredClone({ images, products, tasks }); active = true;
      try { const result = await work(database); if (failCommit) throw new Error("commit-failed"); return result; }
      catch (error) { ({ images, products, tasks } = before); throw error; } finally { active = false; }
    };
    if (key === "$queryRaw") return async (sql: TemplateStringsArray | Prisma.Sql) => {
      assert.ok(active);
      if (Array.isArray(sql) && sql.join("").includes("product_image_cleanup_tasks")) return tasks.filter(task => task.nextAttemptAt <= new Date()).slice(0, 1);
      return [{ id: catalogId, archivedAt: null }];
    };
    if (key === "$executeRaw") return async () => { assert.ok(active); return 0; };
    if (key === "product") return {
      findFirst: async () => { assert.ok(active); return products[0] ?? null; },
      findMany: async () => { assert.ok(active); return products; },
      deleteMany: async () => { assert.ok(active); const count = products.length; products = []; images = []; return { count }; },
    };
    if (key === "productImage") return {
      findMany: async () => { assert.ok(active); return images; },
      findFirst: async (args: Prisma.ProductImageFindFirstArgs) => { assert.ok(active); return images.find(image => args.where?.url ? image.url === args.where.url : image.id === args.where?.id) ?? null; },
      deleteMany: async () => { assert.ok(active); const count = images.length; images = []; return { count }; },
    };
    if (key === "productImageCleanupTask") return {
      createMany: async (args: { data: { path: string; bucket: string; catalogId: string }[] }) => {
        assert.ok(active); if (failEnqueue) throw new Error("queue-failed");
        for (const data of args.data) tasks.push({ ...data, id: `task-${tasks.length}`, attempts: 0, nextAttemptAt: new Date(0) });
        return { count: args.data.length };
      },
      findUniqueOrThrow: async () => { assert.ok(active); assert.ok(tasks[0]); return tasks[0]; },
      update: async (args: { data: { nextAttemptAt: Date } }) => { assert.ok(active); assert.ok(tasks[0]); tasks[0].attempts++; tasks[0].nextAttemptAt = args.data.nextAttemptAt; return tasks[0]; },
      delete: async () => { assert.ok(active); return tasks.shift(); },
    };
    throw new Error(`Unexpected delegate ${String(key)}`);
  } });
  return { database, get images() { return images; }, get products() { return products; }, get tasks() { return tasks; },
    failQueue() { failEnqueue = true; }, failCommit(value: boolean) { failCommit = value; } };
}

test("individual deletion enqueues exact image paths and queue failure rolls back the product and images", async () => {
  const f = fixture(); await deleteProduct(productId, "owner", f.database);
  assert.equal(f.products.length, 0); assert.equal(f.images.length, 0); assert.equal(f.tasks[0]?.path, path);
  const failed = fixture(); failed.failQueue();
  await assert.rejects(deleteProduct(productId, "owner", failed.database), /queue-failed/);
  assert.equal(failed.products.length, 1); assert.equal(failed.images.length, 1); assert.equal(failed.tasks.length, 0);
});

test("bulk deletion captures every image inside the confirmation transaction; queue failure aborts deletion", async () => {
  for (const fail of [false, true]) {
    const f = fixture(); f.images.push({ ...f.images[0], id: "second", url: path.replace(".jpeg", ".jpg") });
    const service = makeProductBulkService(f.database), secret = "cleanup-test-signing-key-at-least-32-bytes";
    const preview = await service.preview(catalogId, "owner", { items: [{ id: productId, updatedAt: date.toISOString() }], operation: { action: "delete" } }, secret);
    const token = preview.token; assert.ok(token); if (fail) f.failQueue();
    const confirm = () => service.confirm(catalogId, "owner", token, secret, "ELIMINAR 1");
    if (fail) { await assert.rejects(confirm(), /queue-failed/); assert.equal(f.products.length, 1); assert.equal(f.tasks.length, 0); }
    else { await confirm(); assert.equal(f.tasks.length, 2); assert.equal(f.products.length, 0); }
  }
});

test("removing one photo removes its reference and queues instead of deleting Storage first", async () => {
  const f = fixture(); await deleteProductImage("image", "owner", f.database);
  assert.equal(f.images.length, 0); assert.equal(f.products.length, 1); assert.equal(f.tasks[0]?.path, path);
  const failed = fixture(); failed.failQueue();
  await assert.rejects(deleteProductImage("image", "owner", failed.database), /queue-failed/);
  assert.equal(failed.images.length, 1); assert.equal(failed.tasks.length, 0);
});

test("worker confirms remote removal before deleting task; failure persists task with delayed retry", async () => {
  const f = fixture(); await deleteProduct(productId, "owner", f.database);
  assert.equal(await runProductImageCleanupBatch({ remove: async () => { throw new Error("offline"); } }, f.database), false);
  assert.equal(f.tasks.length, 1); assert.equal(f.tasks[0].attempts, 1); assert.ok(f.tasks[0].nextAttemptAt > new Date());
  let called = false;
  await runProductImageCleanupBatch({ remove: async () => { called = true; } }, f.database); assert.equal(called, false);
  f.tasks[0].nextAttemptAt = new Date(0);
  assert.equal(await runProductImageCleanupBatch({ remove: async paths => { assert.deepEqual(paths, [path]); assert.equal(f.tasks.length, 1); } }, f.database), true);
  assert.equal(f.tasks.length, 0);
});

test("remote success followed by failed commit is safely retried without losing the task", async () => {
  const f = fixture(); await deleteProduct(productId, "owner", f.database); let removes = 0;
  const storage = { remove: async () => { removes++; } }; f.failCommit(true);
  await assert.rejects(runProductImageCleanupBatch(storage, f.database), /commit-failed/);
  assert.equal(f.tasks.length, 1); f.failCommit(false);
  await runProductImageCleanupBatch(storage, f.database); assert.equal(removes, 2); assert.equal(f.tasks.length, 0);
});

test("only owned product paths are accepted, including jpg/jpeg/png/webp", () => {
  for (const ext of ["jpeg", "jpg", "png", "webp"]) assert.doesNotThrow(() => assertProductImagePath(path.replace(".jpeg", `.${ext}`), catalogId));
  for (const invalid of [`${catalogId}/branding/${fileId}.jpg`, `${catalogId}/categories/${productId}/${fileId}.jpg`, `${catalogId}/banners/${fileId}.jpg`, path.replace(catalogId, productId), path + "?token=bad", path.replace(productId, "..")]) {
    assert.throws(() => assertProductImagePath(invalid, catalogId));
  }
});

test("worker retains invalid, foreign, wrong-bucket or still-referenced tasks without touching Storage", async () => {
  for (const kind of ["logo", "category", "banner", "foreign", "bucket", "reference"]) {
    const f = fixture(); await deleteProductImage("image", "owner", f.database); const task = f.tasks[0];
    if (kind === "logo") task.path = `${catalogId}/branding/${fileId}.jpg`;
    if (kind === "category") task.path = `${catalogId}/categories/${productId}/${fileId}.jpg`;
    if (kind === "banner") task.path = `${catalogId}/banners/${fileId}.jpg`;
    if (kind === "foreign") task.catalogId = productId;
    if (kind === "bucket") task.bucket = "other";
    if (kind === "reference") f.images.push({ id: "shared", productId, url: path, product: { catalogId } });
    let removals = 0;
    await runProductImageCleanupBatch({ remove: async () => { removals++; } }, f.database);
    assert.equal(removals, 0);
    assert.equal(f.tasks.length, 1); assert.equal(f.tasks[0].attempts, 1);
  }
});
