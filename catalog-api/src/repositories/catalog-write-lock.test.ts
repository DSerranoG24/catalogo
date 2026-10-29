import assert from "node:assert/strict";
import test from "node:test";
import { Prisma } from "@prisma/client";
import { prisma } from "../config/prisma";
import { createProduct, updateProduct, deleteProduct } from "./product.repository";
import { createCategory, updateCategory, deleteCategory } from "./category.repository";

function fixture() {
  let locked = false, writes = 0;
  const database = new Proxy(prisma, {
    get(_target, key) {
      if (key === "$transaction") return async (work: (tx: Prisma.TransactionClient) => Promise<unknown>) => work(database);
      if (key === "$queryRaw") return async (strings: TemplateStringsArray, ...values: unknown[]) => {
        assert.ok(strings.join("").includes("FOR UPDATE"));
        assert.deepEqual(values, ["catalog", "owner"]);
        locked = true; return [{ id: "catalog", archivedAt: null }];
      };
      if (key === "productImage") return { findMany: async () => { assert.ok(locked); return []; } };
      if (key === "product" || key === "category") return {
        findFirst: async (args: { where: { id: string; catalog: { userId: string } } }) => {
          assert.equal(args.where.catalog.userId, "owner"); return { catalogId: "catalog" };
        },
        create: async () => { assert.ok(locked); writes++; return { id: "created" }; },
        updateMany: async () => { assert.ok(locked); writes++; return { count: 1 }; },
        deleteMany: async () => { assert.ok(locked); writes++; return { count: 1 }; },
      };
      throw new Error("Unexpected database call");
    },
  });
  return { database, get writes() { return writes; } };
}

test("all manual product mutations participate in the catalog lock used by import", async () => {
  for (const operation of ["create", "update", "delete"]) {
    const f = fixture();
    if (operation === "create") await createProduct({ catalogId: "catalog", name: "Producto", slug: "producto", price: 1000 }, "owner", f.database);
    if (operation === "update") await updateProduct("product", "owner", { name: "Nuevo" }, f.database);
    if (operation === "delete") await deleteProduct("product", "owner", f.database);
    assert.equal(f.writes, 1);
  }
});

test("all manual category mutations participate in the same catalog lock", async () => {
  for (const operation of ["create", "update", "delete"]) {
    const f = fixture();
    if (operation === "create") await createCategory({ catalogId: "catalog", name: "Categoría", slug: "categoria" }, "owner", f.database);
    if (operation === "update") await updateCategory("category", "owner", { name: "Nueva" }, f.database);
    if (operation === "delete") await deleteCategory("category", "owner", f.database);
    assert.equal(f.writes, 1);
  }
});
