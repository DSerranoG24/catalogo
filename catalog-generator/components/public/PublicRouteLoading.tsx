"use client";

import { CSSProperties, useEffect, useState } from "react";
import { Catalog } from "@/lib/api";

type Template = Catalog["template"];
type LoadingKind = "catalog" | "product" | "cart";

const palettes: Record<string, { background: string; foreground: string; muted: string; border: string; surface: string; accent: string }> = {
  TECH: { background: "#07111d", foreground: "#e5edf5", muted: "#9aafc1", border: "#26394b", surface: "#102033", accent: "#4de0c1" },
  GRID: { background: "#07111d", foreground: "#e5edf5", muted: "#9aafc1", border: "#26394b", surface: "#102033", accent: "#4de0c1" },
  FASHION: { background: "#f5eee7", foreground: "#322c29", muted: "#776b64", border: "#dfd2c5", surface: "#eadfd5", accent: "#9a554b" },
  EDITORIAL: { background: "#f5eee7", foreground: "#322c29", muted: "#776b64", border: "#dfd2c5", surface: "#eadfd5", accent: "#9a554b" },
  BEAUTY: { background: "#fff1ee", foreground: "#552e48", muted: "#896879", border: "#efd5dd", surface: "#f9e4e7", accent: "#b55271" },
  GLAMOUR: { background: "#fff4f7", foreground: "#45182f", muted: "#7f425b", border: "#efd0dc", surface: "#f9dfe9", accent: "#c12868" },
  BOUTIQUE: { background: "#fff1ee", foreground: "#552e48", muted: "#896879", border: "#efd5dd", surface: "#f9e4e7", accent: "#b55271" },
  DEFAULT: { background: "#f4f5f1", foreground: "#263b31", muted: "#68756e", border: "#dce4dc", surface: "#e8eee5", accent: "#5b896e" },
};

function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-xl bg-[var(--loading-surface)] ${className}`} />;
}

export default function PublicRouteLoading({ kind }: { kind: LoadingKind }) {
  const [template, setTemplate] = useState<Template | null>(null);

  useEffect(() => {
    const publicId = decodeURIComponent(window.location.pathname.split("/")[2] ?? "");
    if (!publicId) return;
    try {
      const saved = window.sessionStorage.getItem(`catalogo-template-${publicId}`);
      if (saved && saved in palettes) setTemplate(saved as Template);
    } catch {
      // Keep the neutral fallback when session storage is disabled.
    }
  }, []);

  const palette = (template && palettes[template]) || palettes.DEFAULT;
  const style = {
    "--loading-bg": palette.background,
    "--loading-fg": palette.foreground,
    "--loading-muted": palette.muted,
    "--loading-border": palette.border,
    "--loading-surface": palette.surface,
    "--loading-accent": palette.accent,
  } as CSSProperties;

  return (
    <main role="status" aria-label="Cargando catálogo" style={style} className="min-h-screen bg-[var(--loading-bg)] px-5 py-7 text-[var(--loading-fg)] transition-colors duration-300 sm:px-8 sm:py-9">
      <div className="mx-auto max-w-7xl">
        <span className="sr-only">Cargando...</span>
        <Skeleton className="h-3 w-32 bg-[var(--loading-border)]" />
        {kind === "catalog" ? (
          <>
            <div className="mt-7 grid gap-6 rounded-3xl border border-[var(--loading-border)] bg-[var(--loading-surface)] p-6 sm:p-10 lg:grid-cols-2 lg:items-center"><div className="space-y-4"><Skeleton className="h-3 w-28 bg-[var(--loading-accent)]/30" /><Skeleton className="h-12 w-4/5" /><Skeleton className="h-4 w-3/5" /><Skeleton className="h-10 w-36 bg-[var(--loading-accent)]/30" /></div><Skeleton className="aspect-[4/3] rounded-3xl" /></div>
            <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-4">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="h-24 rounded-2xl" />)}</div>
            <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{[0, 1, 2, 3].map((item) => <Skeleton key={item} className="aspect-[4/5] rounded-2xl" />)}</div>
          </>
        ) : kind === "product" ? (
          <div className="mt-7 grid gap-7 lg:grid-cols-[1.15fr_0.85fr]"><Skeleton className="aspect-[4/3] rounded-3xl" /><div className="space-y-5 rounded-3xl border border-[var(--loading-border)] bg-[var(--loading-surface)] p-6 sm:p-8"><Skeleton className="h-3 w-28 bg-[var(--loading-accent)]/30" /><Skeleton className="h-12 w-4/5" /><Skeleton className="h-7 w-28" /><Skeleton className="h-24 w-full" /><Skeleton className="h-12 w-full bg-[var(--loading-accent)]/30" /></div></div>
        ) : (
          <>
            <div className="mt-6 flex items-end justify-between border-y border-[var(--loading-border)] py-6"><div className="space-y-3"><Skeleton className="h-3 w-32 bg-[var(--loading-accent)]/30" /><Skeleton className="h-10 w-48" /></div><Skeleton className="h-8 w-24 rounded-full" /></div>
            <div className="mt-7 grid gap-8 lg:grid-cols-[1fr_0.7fr]"><div className="space-y-3">{[0, 1, 2].map((item) => <Skeleton key={item} className="h-32 rounded-2xl" />)}</div><Skeleton className="h-[34rem] rounded-3xl" /></div>
          </>
        )}
        <p className="mt-8 text-center text-xs text-[var(--loading-muted)]">Preparando la tienda para ti…</p>
      </div>
    </main>
  );
}
