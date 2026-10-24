import assert from "node:assert/strict";
import test from "node:test";

// Estas pruebas verifican la lógica de decisión del archivado sin base de datos.
// El comportamiento real contra PostgreSQL se verifica en la fase de integración.

type CatalogState = {
  id: string;
  userId: string;
  active: boolean;
  archivedAt: Date | null;
};

type Order = {
  id: string;
  catalogId: string;
};

function isArchived(catalog: CatalogState): boolean {
  return catalog.archivedAt !== null;
}

function isVisibleToPublic(catalog: CatalogState): boolean {
  return catalog.active && catalog.archivedAt === null;
}

function applyArchive(catalog: CatalogState): CatalogState {
  return { ...catalog, archivedAt: new Date() };
}

function applyReactivate(catalog: CatalogState): CatalogState {
  return { ...catalog, archivedAt: null };
}

function canDelete(catalog: CatalogState, orders: Order[]): boolean {
  return orders.filter((order) => order.catalogId === catalog.id).length === 0;
}

test("archiving hides the catalog without changing its active flag", () => {
  const catalog: CatalogState = {
    id: "catalog-1",
    userId: "user-1",
    active: true,
    archivedAt: null,
  };

  const archived = applyArchive(catalog);

  assert.equal(archived.active, true);
  assert.notEqual(archived.archivedAt, null);
  assert.equal(isArchived(archived), true);
  assert.equal(isVisibleToPublic(archived), false);
});

test("an inactive catalog is not the same as an archived one", () => {
  const inactiveOnly: CatalogState = {
    id: "catalog-1",
    userId: "user-1",
    active: false,
    archivedAt: null,
  };

  const archived: CatalogState = {
    id: "catalog-2",
    userId: "user-1",
    active: true,
    archivedAt: new Date(),
  };

  assert.equal(isArchived(inactiveOnly), false);
  assert.equal(isArchived(archived), true);
});

test("reactivating clears the archive date and preserves the active flag", () => {
  const archived: CatalogState = {
    id: "catalog-1",
    userId: "user-1",
    active: true,
    archivedAt: new Date("2026-10-24T10:00:00Z"),
  };

  const reactivated = applyReactivate(archived);

  assert.equal(reactivated.archivedAt, null);
  assert.equal(reactivated.active, true);
  assert.equal(isArchived(reactivated), false);
  assert.equal(isVisibleToPublic(reactivated), true);
});

test("a catalog with orders cannot be deleted", () => {
  const catalog: CatalogState = {
    id: "catalog-1",
    userId: "user-1",
    active: true,
    archivedAt: null,
  };
  const orders: Order[] = [
    { id: "order-1", catalogId: "catalog-1" },
    { id: "order-2", catalogId: "catalog-1" },
  ];

  assert.equal(canDelete(catalog, orders), false);
});

test("a catalog without orders can be deleted", () => {
  const catalog: CatalogState = {
    id: "catalog-1",
    userId: "user-1",
    active: true,
    archivedAt: null,
  };
  const orders: Order[] = [{ id: "order-1", catalogId: "catalog-2" }];

  assert.equal(canDelete(catalog, orders), true);
});

test("archiving preserves the order history", () => {
  const catalog: CatalogState = {
    id: "catalog-1",
    userId: "user-1",
    active: true,
    archivedAt: null,
  };
  const orders: Order[] = [{ id: "order-1", catalogId: "catalog-1" }];

  const archived = applyArchive(catalog);

  // Archivar no toca los pedidos: siguen existiendo y siguen asociados.
  assert.equal(orders.length, 1);
  assert.equal(orders[0].catalogId, archived.id);
  assert.equal(isArchived(archived), true);
});

test("a public catalog is only visible when active and not archived", () => {
  const states: CatalogState[] = [
    { id: "1", userId: "u", active: true, archivedAt: null },   // visible
    { id: "2", userId: "u", active: false, archivedAt: null },  // oculto
    { id: "3", userId: "u", active: true, archivedAt: new Date() }, // archivado
    { id: "4", userId: "u", active: false, archivedAt: new Date() }, // archivado
  ];

  const visible = states.filter(isVisibleToPublic).map((state) => state.id);

  assert.deepEqual(visible, ["1"]);
});
