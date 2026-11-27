// Pure helpers for the Sales panel. Money is always a decimal string or BigInt, never a Number.

const MAX_BIGINT = 9223372036854775807n;
const MAX_INT = 2147483647;
const uuid = v => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const object = v => v !== null && typeof v === "object" && !Array.isArray(v);
const moneyText = v => typeof v === "string" && /^(0|[1-9][0-9]*)$/.test(v);
const optionalDate = v => v === null || v === undefined || (typeof v === "string" && Number.isFinite(Date.parse(v)));
const text = v => v === null || v === undefined || typeof v === "string";
const count = v => Number.isSafeInteger(v) && v >= 0;

export const SALE_STATUSES = ["DRAFT", "CONFIRMED", "DELIVERED", "PARTIALLY_RETURNED", "RETURNED", "CANCELLED"];
export const STATUS_LABELS = {
  DRAFT: "Borrador", CONFIRMED: "Confirmada", DELIVERED: "Entregada",
  PARTIALLY_RETURNED: "Devuelta parcialmente", RETURNED: "Devuelta", CANCELLED: "Cancelada",
};
// Text and background pairs keep at least 4.5:1 contrast.
export const STATUS_TONES = {
  DRAFT: "border-[#cfd6cf] bg-[#f3f5f2] text-[#3f4a43]",
  CONFIRMED: "border-[#b9d3ec] bg-[#eef5fc] text-[#1f4f7a]",
  DELIVERED: "border-[#b8dcc6] bg-[#ecf7f0] text-[#1f5b37]",
  PARTIALLY_RETURNED: "border-[#ecd3a3] bg-[#fdf5e6] text-[#7a4f0b]",
  RETURNED: "border-[#d6c7ea] bg-[#f5f0fb] text-[#55337c]",
  CANCELLED: "border-[#efc2bd] bg-[#fdf0ee] text-[#8a2b20]",
};

/** "$ 200.000" (non-breaking space). Accepts a decimal string or a BigInt. */
export function formatCop(value) {
  const amount = typeof value === "bigint" ? value : BigInt(String(value));
  const negative = amount < 0n;
  const digits = (negative ? -amount : amount).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}$ ${digits}`;
}

/** Digits only, within BIGINT; returns the normalized string or null. */
export function parseMoneyInput(raw) {
  const value = String(raw ?? "").trim();
  if (!/^\d{1,19}$/.test(value)) return null;
  const amount = BigInt(value);
  return amount <= MAX_BIGINT ? amount.toString() : null;
}

export function parseQuantityInput(raw) {
  const value = String(raw ?? "").trim();
  if (!/^[1-9]\d{0,9}$/.test(value)) return null;
  const quantity = Number(value);
  return quantity <= MAX_INT ? quantity : null;
}

function validLine(l) {
  return object(l) && uuid(l.id) && uuid(l.inventoryItemId) && Number.isSafeInteger(l.quantity) && l.quantity > 0
    && typeof l.itemName === "string" && typeof l.sku === "string"
    && moneyText(l.unitPrice) && moneyText(l.unitDiscount) && moneyText(l.lineTotal) && (l.unitCost === null || l.unitCost === undefined || moneyText(l.unitCost));
}
function validReturn(r) {
  return object(r) && uuid(r.id) && typeof r.reason === "string" && optionalDate(r.createdAt) && Array.isArray(r.lines)
    && r.lines.every(l => object(l) && uuid(l.saleLineId) && count(l.receivedQuantity) && count(l.resellableQuantity) && count(l.damagedQuantity));
}
const RAW_STATUSES = ["DRAFT", "CONFIRMED", "DELIVERED", "CANCELLED", "RETURNED"];

/** Validates a sale DTO from the API. Missing `returns` (old receipts) is treated as none. */
export function parseSale(value) {
  const ok = object(value) && uuid(value.id) && RAW_STATUSES.includes(value.status) && Number.isSafeInteger(value.version) && value.version > 0
    && value.currency === "COP" && moneyText(value.subtotal) && moneyText(value.discountTotal) && moneyText(value.total)
    && optionalDate(value.createdAt) && optionalDate(value.confirmedAt) && optionalDate(value.deliveredAt) && optionalDate(value.cancelledAt) && optionalDate(value.returnedAt)
    && text(value.customerNameSnapshot) && text(value.customerName) && Array.isArray(value.lines) && value.lines.every(validLine)
    && (value.returns === undefined || (Array.isArray(value.returns) && value.returns.every(validReturn)));
  if (!ok) throw new Error("La respuesta de ventas no es válida. Recarga antes de continuar.");
  return { ...value, returns: value.returns ?? [] };
}
export function parseSaleList(value) {
  if (!object(value) || !Array.isArray(value.result)) throw new Error("La lista de ventas no es válida. Recarga antes de continuar.");
  return value.result.map(parseSale);
}

/** Sold, returned and pending units per sale line id. */
export function lineBalances(sale) {
  const returned = new Map();
  for (const ret of sale.returns ?? []) for (const line of ret.lines) returned.set(line.saleLineId, (returned.get(line.saleLineId) ?? 0) + line.receivedQuantity);
  return new Map(sale.lines.map(line => { const r = returned.get(line.id) ?? 0; return [line.id, { sold: line.quantity, returned: r, pending: Math.max(line.quantity - r, 0) }]; }));
}
export function hasPendingUnits(sale) { return [...lineBalances(sale).values()].some(b => b.pending > 0); }

/** Status shown to the user: a DELIVERED sale with some returns is "Devuelta parcialmente". */
export function displayStatus(sale) {
  if (sale.status === "DELIVERED" && (sale.returns ?? []).some(r => r.lines.length)) return "PARTIALLY_RETURNED";
  return sale.status;
}

/** Which actions the panel offers for this sale. The server enforces them again. */
export function allowedActions(sale) {
  const draft = sale.status === "DRAFT";
  return {
    editDraft: draft,
    confirm: draft && sale.lines.length > 0,
    confirmAndDeliver: draft && sale.lines.length > 0,
    deliver: sale.status === "CONFIRMED",
    cancel: sale.status === "CONFIRMED",
    registerReturn: sale.status === "DELIVERED" && hasPendingUnits(sale),
  };
}

export function itemCount(sale) { return sale.lines.reduce((sum, line) => sum + line.quantity, 0); }
export function buyerName(sale) { return sale.customerNameSnapshot ?? sale.customerName ?? sale.customer?.fullName ?? null; }

/** Client-side estimate while editing a draft; the server recomputes on save. */
export function draftEstimate(lines) {
  let subtotal = 0n, discountTotal = 0n;
  const rows = lines.map(line => {
    const quantity = parseQuantityInput(line.quantity), discount = parseMoneyInput(line.unitDiscount);
    if (line.unitPrice === null || quantity === null || discount === null) return { lineTotal: null };
    const price = BigInt(line.unitPrice), q = BigInt(quantity), d = BigInt(discount);
    if (d > price) return { lineTotal: null };
    subtotal += price * q; discountTotal += d * q;
    return { lineTotal: ((price - d) * q).toString() };
  });
  return { rows, subtotal: subtotal.toString(), discountTotal: discountTotal.toString(), total: (subtotal - discountTotal).toString() };
}

/** Errors that block saving a draft (Spanish). Returns [] when valid. */
export function validateDraft(lines) {
  const errors = [];
  if (!lines.length) errors.push("Añade al menos un artículo.");
  if (lines.length > 100) errors.push("Una venta admite como máximo 100 artículos distintos.");
  const seen = new Set();
  for (const line of lines) {
    if (seen.has(line.inventoryItemId)) errors.push(`${line.itemName} está repetido; usa una sola línea.`);
    seen.add(line.inventoryItemId);
    if (line.unitPrice === null) { errors.push(`${line.itemName} no tiene ficha comercial: configura su precio en Inventario.`); continue; }
    if (parseQuantityInput(line.quantity) === null) errors.push(`Cantidad no válida en ${line.itemName}: usa un entero mayor que cero.`);
    const discount = parseMoneyInput(line.unitDiscount);
    if (discount === null) errors.push(`Descuento no válido en ${line.itemName}: usa pesos enteros sin puntos.`);
    else if (BigInt(discount) > BigInt(line.unitPrice)) errors.push(`El descuento de ${line.itemName} supera su precio.`);
  }
  return errors;
}

/** Builds the return payload; at most the pending units of each line. */
export function buildReturn(sale, rows, reason) {
  const errors = [], lines = [];
  const balances = lineBalances(sale);
  for (const line of sale.lines) {
    const row = rows[line.id] ?? { resellable: "0", damaged: "0" };
    const resellable = /^\d+$/.test(String(row.resellable).trim()) ? Number(String(row.resellable).trim()) : NaN;
    const damaged = /^\d+$/.test(String(row.damaged).trim()) ? Number(String(row.damaged).trim()) : NaN;
    if (!Number.isSafeInteger(resellable) || !Number.isSafeInteger(damaged)) { errors.push(`Cantidades no válidas en ${line.itemName}.`); continue; }
    const received = resellable + damaged, pending = balances.get(line.id).pending;
    if (received > pending) errors.push(`${line.itemName}: como máximo ${pending} pendiente${pending === 1 ? "" : "s"}.`);
    else if (received > 0) lines.push({ saleLineId: line.id, receivedQuantity: received, resellableQuantity: resellable, damagedQuantity: damaged });
  }
  if (!lines.length && !errors.length) errors.push("Indica al menos una unidad devuelta.");
  const trimmed = String(reason ?? "").trim();
  if (trimmed.length < 3 || trimmed.length > 300) errors.push("Escribe un motivo de 3 a 300 caracteres.");
  return { errors, lines, reason: trimmed };
}

/** Same intention => same fingerprint => same operationId. */
export function intentFingerprint(action, saleId, body) { return JSON.stringify({ action, saleId, body }); }

const ERRORS = {
  STOCK_INSUFFICIENT: { title: "No hay existencias suficientes", detail: "Algún artículo no tiene unidades para esta venta.", action: "reload" },
  PRICE_CHANGED: { title: "El precio de un artículo cambió", detail: "La ficha comercial cambió después de guardar el borrador. Recárgalo con los precios actuales, revisa el total y confirma de nuevo.", action: "refreshPrices" },
  VERSION_CONFLICT: { title: "La venta cambió", detail: "Otra pestaña o persona la modificó. Recarga la venta y revisa antes de seguir.", action: "reload" },
  INVALID_TRANSITION: { title: "Esa acción ya no está disponible", detail: "La venta cambió de estado. Recarga para ver su estado actual.", action: "reload" },
  RETURN_EXCEEDS_SOLD: { title: "Devolverías más de lo pendiente", detail: "Ya se registró otra devolución. Recarga la venta para ver lo pendiente por línea.", action: "reload" },
  IDEMPOTENCY_CONFLICT: { title: "Operación ya registrada con otros datos", detail: "Recarga la venta antes de repetir la acción.", action: "reload" },
  PRICE_REQUIRED: { title: "Falta la ficha comercial", detail: "Un artículo no tiene precio configurado. Configúralo en Inventario.", action: null },
  INVALID_DISCOUNT: { title: "Descuento no válido", detail: "El descuento unitario no puede superar el precio.", action: null },
  ITEM_NOT_FOUND: { title: "Artículo no disponible", detail: "Un artículo ya no está en tu inventario. Quítalo del borrador.", action: null },
  RETURN_LINE_DUPLICATE: { title: "Línea repetida", detail: "Cada línea solo puede aparecer una vez por devolución.", action: null },
  RETURN_LINE_NOT_FOUND: { title: "Línea no encontrada", detail: "Recarga la venta e intenta de nuevo.", action: "reload" },
  CUSTOMER_ARCHIVED: { title: "Cliente archivado", detail: "Elige otro cliente o deja la venta sin cliente.", action: null },
  CUSTOMER_NOT_FOUND: { title: "Cliente no encontrado", detail: "Elige otro cliente o deja la venta sin cliente.", action: null },
  NOT_FOUND: { title: "Venta no encontrada", detail: "Puede que ya no exista en tu cuenta. Vuelve al listado.", action: "reload" },
  // Payments of a sale (F2a-2b).
  SALE_BALANCE_DUE: { title: "Falta dinero para entregar", detail: "Por ahora una venta se entrega pagada por completo. Registra el resto del pago o confírmala para entregar después.", action: null },
  PAYMENT_EXCEEDS_BALANCE: { title: "Los pagos superan lo que falta", detail: "El total de la venta cambió o ya tenía pagos. Recarga el ticket y revisa los importes.", action: "reload" },
  CREDIT_INSUFFICIENT: { title: "El saldo a favor no alcanza", detail: "El cliente tiene menos saldo a favor del que intentas usar. Revisa el importe o usa otro medio.", action: "reload" },
  CUSTOMER_REQUIRED_FOR_CREDIT: { title: "Falta el cliente", detail: "Para usar saldo a favor, la venta debe tener el cliente que lo tiene.", action: null },
  LEGACY_SALE_PAYMENTS_UNSUPPORTED: { title: "Esta venta no registra pagos", detail: "Es una venta anterior al registro de pagos. Gestiónala desde Historial.", action: null },
  INVALID_PAYMENT_STATE: { title: "La venta ya no admite este pago", detail: "Cambió de estado. Recarga para ver su estado actual.", action: "reload" },
  INVALID_PAYMENT_INPUT: { title: "Revisa los pagos", detail: "Algún importe o medio de pago no es válido. Corrígelo e intenta de nuevo.", action: null },
  INVALID_SALE_INPUT: { title: "Revisa los datos de la venta", detail: "Algún dato del ticket no es válido. Corrígelo e intenta de nuevo.", action: null },
  CREDIT_ALREADY_USED: { title: "Ese saldo a favor ya se usó", detail: "Recarga para ver el saldo actual del cliente.", action: "reload" },
  CUSTOMER_CHANGE_BLOCKED: { title: "No se puede cambiar el cliente", detail: "La venta ya se entregó o usa saldo a favor del cliente anterior.", action: "reload" },
};

/** Maps an API or network failure to a Spanish message and a clear next action. */
export function describeFailure(error) {
  const status = typeof error?.status === "number" ? error.status : null;
  if (status === null) return { title: "Sin conexión con el servidor", detail: "No sabemos si la acción se registró. Reintenta: se enviará la misma operación y no se duplicará.", action: "retry" };
  if (status === 401) return { title: "Tu sesión expiró", detail: "Inicia sesión de nuevo para continuar.", action: "login" };
  const known = ERRORS[error.code];
  if (known) return { ...known };
  if (status >= 500) return { title: "El servidor no pudo completar la acción", detail: "Reintenta: se enviará la misma operación y no se duplicará.", action: "retry" };
  return { title: "No se pudo completar la acción", detail: "Revisa los datos e intenta de nuevo.", action: null };
}

/** Items of the sale whose current stock is below the sold quantity (for STOCK_INSUFFICIENT). */
export function insufficientItems(lines, items) {
  return lines.flatMap(line => {
    const item = items.find(candidate => candidate.id === line.inventoryItemId);
    return item && item.stock < line.quantity ? [{ name: line.itemName, sku: line.sku, available: item.stock, requested: line.quantity }] : [];
  });
}

export function formatDate(value) {
  if (!value) return null;
  return new Intl.DateTimeFormat("es-CO", { dateStyle: "medium", timeStyle: "short", timeZone: "America/Bogota" }).format(new Date(value));
}
