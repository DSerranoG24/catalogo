const MAX_QUANTITY = 99;
const PRODUCT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function validQuantity(value) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= MAX_QUANTITY;
}

function validPrice(value) {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

export function parsePublicCart(raw) {
  if (!raw) return { version: 2, items: {} };
  const parsed = JSON.parse(raw);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new Error("INVALID_CART");
  const source = parsed.version === 2 && typeof parsed.items === "object" && parsed.items !== null && !Array.isArray(parsed.items)
    ? parsed.items
    : parsed;
  const items = {};
  for (const [productId, value] of Object.entries(source)) {
    if (!PRODUCT_ID.test(productId)) continue;
    if (typeof value === "number") {
      if (validQuantity(value)) items[productId] = { quantity: value, unitPrice: null };
      continue;
    }
    if (typeof value !== "object" || value === null || Array.isArray(value) || !validQuantity(value.quantity)) continue;
    items[productId] = {
      quantity: value.quantity,
      unitPrice: validPrice(value.unitPrice) ? value.unitPrice : null,
    };
  }
  return { version: 2, items };
}

export function serializePublicCart(cart) {
  return JSON.stringify({ version: 2, items: cart.items });
}

export function publicCartQuantities(cart) {
  return Object.fromEntries(Object.entries(cart.items).map(([id, item]) => [id, item.quantity]));
}

export function setPublicCartQuantity(cart, product, quantity) {
  const items = { ...cart.items };
  if (!validQuantity(quantity)) {
    delete items[product.id];
  } else {
    const previous = items[product.id];
    items[product.id] = {
      quantity,
      unitPrice: previous?.unitPrice ?? product.price,
    };
  }
  return { version: 2, items };
}

export function removePublicCartItem(cart, productId) {
  const items = { ...cart.items };
  delete items[productId];
  return { version: 2, items };
}

export function hydratePublicCartPrices(cart, products) {
  const byId = new Map(products.map(product => [product.id, product]));
  const items = Object.fromEntries(Object.entries(cart.items).map(([id, item]) => {
    const product = byId.get(id);
    if (!product || item.unitPrice !== null) return [id, item];
    return [id, { ...item, unitPrice: product.price }];
  }));
  return { version: 2, items };
}

export function acceptPublicCartPrices(cart, products) {
  const byId = new Map(products.map(product => [product.id, product]));
  const items = Object.fromEntries(Object.entries(cart.items).map(([id, item]) => {
    const product = byId.get(id);
    return [id, product ? { ...item, unitPrice: product.price } : item];
  }));
  return { version: 2, items };
}

export function reconcilePublicCart(cart, products) {
  const byId = new Map(products.map(product => [product.id, product]));
  const rows = Object.entries(cart.items).map(([productId, item]) => {
    const product = byId.get(productId) ?? null;
    return {
      productId,
      item,
      product,
      unavailable: product === null,
      priceChanged: product !== null && item.unitPrice !== null && item.unitPrice !== product.price,
      subtotal: product === null ? 0 : product.price * item.quantity,
    };
  });
  return {
    rows,
    total: rows.reduce((sum, row) => sum + row.subtotal, 0),
    hasPriceChanges: rows.some(row => row.priceChanged),
    hasUnavailable: rows.some(row => row.unavailable),
  };
}

export function canSubmitPublicCart(reconciliation) {
  return reconciliation.rows.length > 0 && !reconciliation.hasPriceChanges && !reconciliation.hasUnavailable;
}
