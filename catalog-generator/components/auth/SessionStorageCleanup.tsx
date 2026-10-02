"use client";

import { useEffect } from "react";

export default function SessionStorageCleanup() {
  useEffect(() => {
    const storageKey = "catalogo-session";
    const storedSession = window.localStorage.getItem(storageKey);
    if (!storedSession) return;

    try {
      const parsed: unknown = JSON.parse(storedSession);
      if (typeof parsed !== "object" || parsed === null || "token" in parsed) {
        window.localStorage.removeItem(storageKey);
      }
    } catch {
      window.localStorage.removeItem(storageKey);
    }
  }, []);

  return null;
}