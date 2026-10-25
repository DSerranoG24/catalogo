import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Server } from "node:http";
import app from "../app.js";
import { prisma } from "../config/prisma.js";

function requireDisposableLocalDatabase() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) throw new Error("Set DATABASE_URL to the disposable local catalogo_test database.");

  const parsedUrl = new URL(databaseUrl);
  if (
    !["127.0.0.1", "localhost", "::1"].includes(parsedUrl.hostname)
    || parsedUrl.pathname !== "/catalogo_test"
  ) {
    throw new Error("Refusing to run: DATABASE_URL must target the local catalogo_test database.");
  }
}

async function main() {
  requireDisposableLocalDatabase();

  const userId = randomUUID();
  const catalogIds: string[] = [];
  const previousPublicApiUrl = process.env.PUBLIC_API_URL;
  let server: Server | undefined;

  try {
    const user = await prisma.user.create({
      data: { id: userId, email: `${userId}@catalogo-test.invalid` },
      select: { id: true },
    });

    const catalogs = await Promise.all(["uno", "dos"].map((suffix) =>
      prisma.catalog.create({
        data: {
          userId: user.id,
          name: `Idempotencia ${suffix}`,
          slug: `idempotencia-${suffix}-${randomUUID()}`,
        },
        select: { id: true, publicId: true },
      })
    ));
    catalogIds.push(...catalogs.map(({ id }) => id));

    const products = await Promise.all(catalogs.map((catalog, index) =>
      prisma.product.create({
        data: {
          catalogId: catalog.id,
          name: `Producto de prueba ${index + 1}`,
          slug: `producto-${randomUUID()}`,
          price: 1250 + index * 250,
          stock: 10,
        },
        select: { id: true, price: true },
      })
    ));

    server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve, reject) => {
      server?.once("listening", resolve);
      server?.once("error", reject);
    });

    const address = server.address();
    assert.ok(address && typeof address !== "string");
    const apiBase = `http://127.0.0.1:${address.port}/api`;
    process.env.PUBLIC_API_URL = apiBase;

    async function submit(catalogIndex: number, key?: string) {
      const product = products[catalogIndex];
      const catalog = catalogs[catalogIndex];
      assert.ok(product && catalog);

      const response = await fetch(
        `${apiBase}/public/catalogs/${encodeURIComponent(catalog.publicId)}/orders`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...(key ? { idempotencyKey: key } : {}),
            customerName: "Prueba local",
            customerPhone: "3001234567",
            customerAddress: "Calle 10 # 20-30",
            consent: true,
            total: 1,
            items: [{ productId: product.id, quantity: 2 }],
          }),
        }
      );
      const body = await response.json() as {
        success: boolean;
        order?: { id: string; total: number; quotationNumber: string; quotationUrl: string };
        message?: string;
      };

      assert.equal(response.status, 201, body.message ?? "Expected HTTP 201 from local API");
      assert.equal(body.success, true);
      assert.ok(body.order);
      assert.equal(body.order.total, product.price * 2, "server must calculate the total from database prices");
      assert.match(body.order.quotationNumber, /^COT-[0-9]{6,}$/);
      assert.ok(body.order.quotationUrl.startsWith(`${apiBase}/public/catalogs/`));
      return body.order;
    }

    const concurrentKey = `concurrent-${randomUUID()}`;
    const [concurrentA, concurrentB] = await Promise.all([
      submit(0, concurrentKey),
      submit(0, concurrentKey),
    ]);
    assert.equal(concurrentA.id, concurrentB.id);
    assert.equal(concurrentA.quotationNumber, concurrentB.quotationNumber);
    assert.ok(concurrentA.quotationUrl === concurrentB.quotationUrl, "Idempotency must preserve the capability without logging it");
    const concurrentRows = await prisma.order.count({
      where: { catalogId: catalogs[0].id, idempotencyKey: concurrentKey },
    });
    assert.equal(concurrentRows, 1);

    const retry = await submit(0, concurrentKey);
    assert.equal(retry.id, concurrentA.id);
    assert.ok(retry.quotationUrl === concurrentA.quotationUrl, "Retry must preserve the quotation link");

    const distinctKeyA = `distinct-a-${randomUUID()}`;
    const distinctKeyB = `distinct-b-${randomUUID()}`;
    const [distinctA, distinctB] = await Promise.all([submit(0, distinctKeyA), submit(0, distinctKeyB)]);
    assert.notEqual(distinctA.id, distinctB.id);
    assert.notEqual(distinctA.quotationNumber, distinctB.quotationNumber);
    const distinctRows = await prisma.order.count({
      where: {
        catalogId: catalogs[0].id,
        idempotencyKey: { in: [distinctKeyA, distinctKeyB] },
      },
    });
    assert.equal(distinctRows, 2);

    const crossCatalogKey = `cross-catalog-${randomUUID()}`;
    const [catalogOneOrder, catalogTwoOrder] = await Promise.all([
      submit(0, crossCatalogKey),
      submit(1, crossCatalogKey),
    ]);
    assert.notEqual(catalogOneOrder.id, catalogTwoOrder.id);
    const crossCatalogRows = await prisma.order.count({
      where: { idempotencyKey: crossCatalogKey, catalogId: { in: catalogIds } },
    });
    assert.equal(crossCatalogRows, 2);

    const [withoutKeyA, withoutKeyB] = await Promise.all([submit(0), submit(0)]);
    assert.notEqual(withoutKeyA.id, withoutKeyB.id);
    assert.notEqual(withoutKeyA.quotationNumber, withoutKeyB.quotationNumber);

    const beforeArchive = await prisma.catalog.findUniqueOrThrow({ where: { id: catalogs[0].id }, select: { quotationCounter: true } });
    await prisma.catalog.update({ where: { id: catalogs[0].id }, data: { archivedAt: new Date() } });
    const blocked = await fetch(`${apiBase}/public/catalogs/${catalogs[0].publicId}/orders`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerName: "Prueba local", customerPhone: "3001234567", customerAddress: "Direccion de prueba", consent: true, items: [{ productId: products[0].id, quantity: 1 }] }),
    });
    assert.equal(blocked.status, 404);
    const afterArchive = await prisma.catalog.findUniqueOrThrow({ where: { id: catalogs[0].id }, select: { quotationCounter: true } });
    assert.equal(afterArchive.quotationCounter, beforeArchive.quotationCounter);

    console.log(JSON.stringify({
      database: "catalogo_test@127.0.0.1",
      concurrentSameKey: { orderId: concurrentA.id, responsesShareId: true, rows: concurrentRows },
      repeatedRequest: { sameReceipt: retry.id === concurrentA.id },
      distinctKeys: { differentOrderIds: distinctA.id !== distinctB.id, rows: distinctRows },
      sameKeyAcrossCatalogs: { differentOrderIds: catalogOneOrder.id !== catalogTwoOrder.id, rows: crossCatalogRows },
      withoutKey: { differentOrderIds: withoutKeyA.id !== withoutKeyB.id },
      serverSideTotal: { expected: products[0].price * 2, returned: concurrentA.total, clientSent: 1 },
      quotations: { concurrentNumbersDiffer: true, idempotentLinkPreserved: true, archivedOrderRejected: true },
    }, null, 2));
  } finally {
    if (previousPublicApiUrl === undefined) delete process.env.PUBLIC_API_URL;
    else process.env.PUBLIC_API_URL = previousPublicApiUrl;
    if (server?.listening) {
      await new Promise<void>((resolve, reject) => {
        server?.close((error?: Error) => error ? reject(error) : resolve());
      });
    }
    // Only this run's fixtures in the guarded disposable database; RESTRICT requires orders first.
    await prisma.order.deleteMany({ where: { catalogId: { in: catalogIds }, catalog: { userId } } });
    await prisma.catalog.deleteMany({ where: { id: { in: catalogIds }, userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  }
}

main().catch(() => {
  console.error("Local idempotency/quotation verification failed. No receipt or token is logged.");
  process.exitCode = 1;
});
