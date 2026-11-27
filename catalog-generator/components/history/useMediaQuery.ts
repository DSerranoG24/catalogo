"use client";

import { useSyncExternalStore } from "react";

/** Live result of a CSS media query (false while rendering on the server). */
export function useMediaQuery(query: string) {
  return useSyncExternalStore(
    notify => { const list = window.matchMedia(query); list.addEventListener("change", notify); return () => list.removeEventListener("change", notify); },
    () => window.matchMedia(query).matches,
    () => false);
}
