"use client";

import { useCallback, useSyncExternalStore } from "react";
import { defaultProductQuery, parseProductQuery, productQueryKeys, type ProductListQuery } from "./product-list-query";

const changeEvent = "vitrinaya-product-query";
function subscribe(notify: () => void) {
  window.addEventListener("popstate", notify);
  window.addEventListener(changeEvent, notify);
  return () => { window.removeEventListener("popstate", notify); window.removeEventListener(changeEvent, notify); };
}
// Native history changes preserve the mounted workspace, import report and manual draft.
export function useProductListQuery() {
  const search = useSyncExternalStore(subscribe, () => window.location.search, () => "");
  const update = useCallback((patch: Partial<ProductListQuery>, replace = false) => {
    const url = new URL(window.location.href);
    const current = parseProductQuery(url.search);
    const next = { ...current, ...patch, page: patch.page ?? 1 };
    for (const key of productQueryKeys) {
      if (next[key] === defaultProductQuery[key]) url.searchParams.delete(key);
      else url.searchParams.set(key, String(next[key]));
    }
    if (replace) window.history.replaceState(null, "", url);
    else window.history.pushState(null, "", url);
    window.dispatchEvent(new Event(changeEvent));
  }, []);
  return { query: parseProductQuery(search), update };
}
