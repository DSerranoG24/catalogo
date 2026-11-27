"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiRequest, ApiError } from "@/lib/api";
import { describeFailure, parseSale, type Failure, type Sale } from "@/lib/sales-ui.mjs";

export type TicketLine = { itemId: string; name: string; sku: string; price: string; quantity: number; unitDiscount: string };
export type TicketCustomer = { id: string; fullName: string; phone: string };
type Wanted = { lines: { inventoryItemId: string; quantity: number; unitDiscount: string }[]; customerId: string | null };
export type DraftState = "empty" | "saving" | "saved" | "error";

const STORAGE_KEY = "vitrinaya-sell-draft";
const wantedOf = (lines: TicketLine[], customer: TicketCustomer | null): Wanted =>
  ({ lines: lines.map(line => ({ inventoryItemId: line.itemId, quantity: line.quantity, unitDiscount: line.unitDiscount })), customerId: customer?.id ?? null });
const sameLines = (sale: Sale, wanted: Wanted) => sale.lines.length === wanted.lines.length && wanted.lines.every(line => {
  const saved = sale.lines.find(row => row.inventoryItemId === line.inventoryItemId);
  return saved && saved.quantity === line.quantity && saved.unitDiscount === line.unitDiscount;
});
/** True when the saved draft is exactly the ticket on screen: only then are its totals shown as valid. */
export const isSynced = (sale: Sale | null, lines: TicketLine[], customer: TicketCustomer | null) =>
  Boolean(sale && lines.length && sameLines(sale, wantedOf(lines, customer)) && (sale.customerId ?? null) === (customer?.id ?? null));
const reply = (value: unknown) => parseSale((value as { result?: unknown } | null)?.result);

/**
 * The ticket lives in a server DRAFT (POST /sales, then PATCH /sales/:id): totals always come from the server.
 * Saves are debounced and serialized. Each intention keeps its operationId across retries (create once per ticket,
 * one key per payload and version), so a lost answer never creates a second draft or a second edit.
 */
export function useSellDraft() {
  const [lines, setLines] = useState<TicketLine[]>([]);
  const [customer, setCustomer] = useState<TicketCustomer | null>(null);
  const [sale, setSale] = useState<Sale | null>(null);
  const [state, setState] = useState<DraftState>("empty");
  const [failure, setFailure] = useState<Failure | null>(null);
  // Only a stored draft id needs restoring; it is read once, in the browser.
  const [restoring, setRestoring] = useState(() => typeof window !== "undefined" && Boolean(localStorage.getItem(STORAGE_KEY)));
  const saleRef = useRef<Sale | null>(null), wantedRef = useRef<Wanted>(wantedOf([], null));
  const loop = useRef<Promise<Sale | null> | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const createKey = useRef(crypto.randomUUID()), patchKeys = useRef(new Map<string, string>());
  const wanted = useMemo(() => wantedOf(lines, customer), [lines, customer]);
  useEffect(() => { wantedRef.current = wanted; }, [wanted]);

  const adopt = useCallback((next: Sale | null) => {
    saleRef.current = next; setSale(next);
    if (next) localStorage.setItem(STORAGE_KEY, next.id); else localStorage.removeItem(STORAGE_KEY);
  }, []);

  // Restores the draft of an interrupted ticket (another tab, a reload) if it is still a DRAFT.
  useEffect(() => {
    let active = true;
    const id = localStorage.getItem(STORAGE_KEY);
    if (!id) return;
    apiRequest<unknown>(`/sales/${encodeURIComponent(id)}`).then(reply).then(found => {
      if (!active) return;
      if (found.status !== "DRAFT") { localStorage.removeItem(STORAGE_KEY); return; }
      adopt(found);
      setLines(found.lines.map(line => ({ itemId: line.inventoryItemId, name: line.itemName, sku: line.sku, price: line.unitPrice, quantity: line.quantity, unitDiscount: line.unitDiscount })));
      setCustomer(found.customerId && found.customer ? { id: found.customerId, fullName: found.customer.fullName, phone: found.customer.phone ?? "" } : null);
      setState(found.lines.length ? "saved" : "empty");
    }, () => { if (active) localStorage.removeItem(STORAGE_KEY); }).finally(() => { if (active) setRestoring(false); });
    return () => { active = false; };
  }, [adopt]);

  /** One save towards what the ticket wants now; loops until the server matches or fails. */
  const saveOnce = useCallback(async () => {
    const want = wantedRef.current;
    let current = saleRef.current;
    if (!current) {
      current = reply(await apiRequest<unknown>("/sales", { method: "POST", body: JSON.stringify({ operationId: createKey.current, requestId: crypto.randomUUID(), ...(want.customerId ? { customerId: want.customerId } : {}) }) }));
      adopt(current);
    }
    if (sameLines(current, want) && (current.customerId ?? null) === want.customerId) return current;
    const body = { expectedVersion: current.version, lines: want.lines, ...((current.customerId ?? null) !== want.customerId ? { customerId: want.customerId } : {}) };
    const fingerprint = JSON.stringify([current.id, body]);
    const operationId = patchKeys.current.get(fingerprint) ?? crypto.randomUUID(); patchKeys.current.set(fingerprint, operationId);
    try {
      const saved = reply(await apiRequest<unknown>(`/sales/${current.id}`, { method: "PATCH", body: JSON.stringify({ operationId, ...body }) }));
      patchKeys.current.delete(fingerprint); adopt(saved); return saved;
    } catch (error) {
      // Another tab changed the draft: read it and try again from its version (the ticket on screen wins).
      if (error instanceof ApiError && error.code === "VERSION_CONFLICT") { adopt(reply(await apiRequest<unknown>(`/sales/${current.id}`))); return null; }
      throw error;
    }
  }, [adopt]);

  const flush = useCallback((): Promise<Sale | null> => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    if (loop.current) return loop.current;
    if (!wantedRef.current.lines.length) return Promise.resolve(saleRef.current);
    setState("saving"); setFailure(null);
    loop.current = (async () => {
      for (let attempt = 0; attempt < 6; attempt++) {
        const want = wantedRef.current, current = saleRef.current;
        if (current && sameLines(current, want) && (current.customerId ?? null) === want.customerId) return current;
        if (!want.lines.length) return current;
        await saveOnce();
      }
      throw new Error("DRAFT_NOT_SETTLED");
    })().then(result => { setState("saved"); return result; }, error => { setState("error"); setFailure(describeFailure(error)); throw error; })
      .finally(() => { loop.current = null; });
    return loop.current;
  }, [saveOnce]);

  // Debounced autosave of every change (an empty ticket keeps its draft as it was: the API needs at least one line).
  const key = JSON.stringify(wanted);
  useEffect(() => {
    if (restoring || !wanted.lines.length) { if (!wanted.lines.length && !restoring) setState(saleRef.current ? "saved" : "empty"); return; }
    if (isSynced(saleRef.current, lines, customer)) return;
    setState("saving");
    timer.current = setTimeout(() => { void flush().catch(() => undefined); }, 450);
    return () => { if (timer.current) clearTimeout(timer.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, restoring]);

  /** Starts a new ticket. The previous draft stays on the server (Historial) unless it was confirmed. */
  const reset = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    createKey.current = crypto.randomUUID(); patchKeys.current.clear();
    adopt(null); setLines([]); setCustomer(null); setState("empty"); setFailure(null);
  }, [adopt]);

  return { lines, setLines, customer, setCustomer, sale, state, failure, restoring, synced: isSynced(sale, lines, customer), flush, reset, adopt };
}
