"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest, type Product } from "./api";
import { readFeaturedStatus, type FeaturedStatus } from "./catalog-highlights";

export function useCatalogFeatured(catalogId: string, enabled: boolean, refreshKey: number, onConfirmed: (id: string, selected: boolean) => void) {
  const [snapshot, setSnapshot] = useState<{ catalogId: string; value: FeaturedStatus } | null>(null);
  const status = snapshot?.catalogId === catalogId ? snapshot.value : null;
  const setStatus = useCallback((value: FeaturedStatus) => setSnapshot({ catalogId, value }), [catalogId]);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [available, setAvailable] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(false);
  const requestVersion = useRef(0);
  const read = useCallback(async (signal?: AbortSignal) => readFeaturedStatus(await apiRequest<unknown>(`/catalogs/${catalogId}/featured`, { signal })), [catalogId]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    async function load() {
      const version = ++requestVersion.current;
      try { const next = await read(controller.signal); if (!controller.signal.aborted && version === requestVersion.current) { setStatus(next); setAvailable(true); } }
      catch (failure) { if (!controller.signal.aborted && version === requestVersion.current) { setAvailable(false); setError(failure instanceof Error ? failure.message : "No se pudo consultar el contador."); } }
    }
    void load();
    const focus = () => { if (!busy.current) void load(); };
    window.addEventListener("focus", focus);
    return () => { controller.abort(); window.removeEventListener("focus", focus); };
  }, [enabled, read, refreshKey, setStatus]);
  async function refresh() {
    if (busy.current) return;
    busy.current = true;
    const version = ++requestVersion.current;
    try { const next = await read(); if (mounted.current && version === requestVersion.current) { setStatus(next); setAvailable(true); setError(""); } }
    catch { if (mounted.current && version === requestVersion.current) { setAvailable(false); setError("No se pudo confirmar el estado. Consulta el contador antes de volver a marcar."); } }
    finally { busy.current = false; }
  }
  async function toggle(product: Product) {
    if (busy.current || !available || !status) return;
    const version = ++requestVersion.current;
    busy.current = true; setPendingId(product.id); setError("");
    const selected = status.products.some(row => row.id === product.id);
    let failureMessage = "";
    try { await apiRequest<unknown>(`/products/${product.id}`, { method: "PUT", body: JSON.stringify({ featured: !selected }) }); }
    catch (failure) { failureMessage = failure instanceof Error ? failure.message : "No se pudo cambiar el destacado."; }
    try {
      const next = await read();
      if (mounted.current && version === requestVersion.current) {
        setStatus(next); setAvailable(true); setError(failureMessage);
        onConfirmed(product.id, next.products.some(row => row.id === product.id));
      }
    } catch {
      if (mounted.current && version === requestVersion.current) { setAvailable(false); setError("No se pudo confirmar el resultado. Consulta el contador antes de reintentar."); }
    } finally { busy.current = false; if (mounted.current) setPendingId(null); }
  }
  return { status, pendingId, error, available: available && status !== null, refresh, toggle };
}
