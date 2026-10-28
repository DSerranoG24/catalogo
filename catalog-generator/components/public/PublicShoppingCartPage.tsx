"use client";

import Image from "next/image";
import Link from "next/link";
import { CSSProperties, FormEvent, startTransition, useEffect, useRef, useState } from "react";
import { publicApiRequest, PublicCatalog, PublicProduct, rememberPublicCatalogTemplate } from "@/lib/api";
import FloatingWhatsAppButton from "@/components/public/FloatingWhatsAppButton";
import PublicRouteLoading from "@/components/public/PublicRouteLoading";
import type { CatalogThemeStyle } from "@/lib/catalog-theme";
import themeStyles from "./catalog-theme.module.css";
import { CUSTOMER_CONSENT } from "@/lib/customer-consent";

type OrderReceipt = {
  id: string;
  quotationNumber: string | null;
  quotationUrl: string | null;
  total: number;
  items: { productName: string; quantity: number; unitPrice: number; subtotal: number }[];
};

const cartThemes = {
  TECH: { background: "#07111d", foreground: "#e5edf5", muted: "#9aafc1", border: "#26394b", surface: "#102033", card: "#0c1927", accent: "#4de0c1", accentForeground: "#06211e", soft: "#12283a", danger: "#ffb1a1" },
  FASHION: { background: "#f5eee7", foreground: "#322c29", muted: "#776b64", border: "#dfd2c5", surface: "#eadfd5", card: "#fffaf5", accent: "#9a554b", accentForeground: "#ffffff", soft: "#f0e5db", danger: "#a5432a" },
  BEAUTY: { background: "#fff1ee", foreground: "#552e48", muted: "#896879", border: "#efd5dd", surface: "#f9e4e7", card: "#fffaf9", accent: "#b55271", accentForeground: "#ffffff", soft: "#fae8eb", danger: "#a5432a" },
  GLAMOUR: { background: "#fff4f7", foreground: "#45182f", muted: "#7f425b", border: "#efd0dc", surface: "#f9dfe9", card: "#fff9fb", accent: "#c12868", accentForeground: "#ffffff", soft: "#f8e1eb", danger: "#a5432a" },
  DEFAULT: { background: "#f4f3eb", foreground: "#263b31", muted: "#68756e", border: "#d7d9cf", surface: "#e8e9dc", card: "#ffffff", accent: "#263b31", accentForeground: "#ffffff", soft: "#e8eee5", danger: "#a5432a" },
} as const;

export default function PublicShoppingCartPage({ publicId }: { publicId: string }) {
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [catalogTheme, setCatalogTheme] = useState<CatalogThemeStyle>();
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [cartReady, setCartReady] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [customerAddress, setCustomerAddress] = useState("");
  const [notes, setNotes] = useState("");
  const [consent, setConsent] = useState(false);
  const [receipt, setReceipt] = useState<OrderReceipt | null>(null);
  const [whatsAppUrl, setWhatsAppUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const pendingOrderRef = useRef<{ key: string; payload: string } | null>(null);
  const cartStorageKey = `catalogo-cart-${publicId}`;

  useEffect(() => {
    let active = true;
    publicApiRequest<{ catalog: PublicCatalog }>(`/public/catalogs/${encodeURIComponent(publicId)}`)
      .then(async ({ catalog: loadedCatalog }) => {
        // A cosmetic chunk failure must not prevent the buyer from opening checkout.
        const resolvedTheme = loadedCatalog.themePreset
          ? await import("@/lib/catalog-theme")
            .then(({ resolveCatalogTheme }) => resolveCatalogTheme(loadedCatalog.template, loadedCatalog.themePreset))
            .catch(() => undefined)
          : undefined;
        if (!active) return;
        setCatalogTheme(resolvedTheme);
        setCatalog(loadedCatalog);
        rememberPublicCatalogTemplate(loadedCatalog.publicId, loadedCatalog.template);
        try {
          const storedCart = sessionStorage.getItem(cartStorageKey);
          const parsed: unknown = storedCart ? JSON.parse(storedCart) : {};
          const validIds = new Set(loadedCatalog.products.map((product) => product.id));
          const restored = typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
            ? Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, number] =>
              validIds.has(entry[0]) && typeof entry[1] === "number" && Number.isInteger(entry[1]) && entry[1] > 0 && entry[1] <= 99
            ))
            : {};
          startTransition(() => {
            setQuantities(restored);
            setCartReady(true);
          });
        } catch {
          sessionStorage.removeItem(cartStorageKey);
          startTransition(() => setCartReady(true));
        }
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "No se pudo cargar el carrito.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [cartStorageKey, publicId]);

  useEffect(() => {
    if (cartReady) sessionStorage.setItem(cartStorageKey, JSON.stringify(quantities));
  }, [cartReady, cartStorageKey, quantities]);

  const cartItems = catalog?.products.filter((product) => (quantities[product.id] ?? 0) > 0) ?? [];
  const cartCount = Object.values(quantities).reduce((sum, quantity) => sum + quantity, 0);
  const cartTotal = cartItems.reduce((sum, product) => sum + product.price * (quantities[product.id] ?? 0), 0);

  function changeQuantity(product: PublicProduct, delta: number) {
    setQuantities((current) => {
      const nextQuantity = Math.max(0, Math.min(99, (current[product.id] ?? 0) + delta));
      const next = { ...current };
      if (nextQuantity === 0) delete next[product.id];
      else next[product.id] = nextQuantity;
      return next;
    });
  }

  async function submitOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!catalog?.whatsappPhone) {
      setError("Esta tienda todavía no configuró WhatsApp para recibir pedidos.");
      return;
    }
    setSubmitting(true);
    setError("");
    setReceipt(null);
    setWhatsAppUrl("");
    try {
      const orderPayload = {
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
        customerEmail: customerEmail.trim() || undefined,
        customerAddress: customerAddress.trim(),
        consent: true,
        customerConsentVersion: CUSTOMER_CONSENT.version,
        notes: notes.trim() || undefined,
        items: cartItems.map((product) => ({ productId: product.id, quantity: quantities[product.id] })),
      };
      const payloadSignature = JSON.stringify(orderPayload);
      if (!pendingOrderRef.current || pendingOrderRef.current.payload !== payloadSignature) {
        pendingOrderRef.current = { key: crypto.randomUUID(), payload: payloadSignature };
      }
      const result = await publicApiRequest<{ order: OrderReceipt }>(`/public/catalogs/${encodeURIComponent(publicId)}/orders`, {
        method: "POST",
        body: JSON.stringify({ ...orderPayload, idempotencyKey: pendingOrderRef.current.key }),
      });
      const order = result.order;
      const orderLines = order.items.map((item) => `- ${item.quantity} x ${item.productName}: $${item.subtotal.toLocaleString("es-CO")}`);
      const message = [
        `Hola, quiero confirmar la orden ${order.quotationNumber ?? order.id.slice(0, 8)}.`,
        "",
        ...orderLines,
        `Total: $${order.total.toLocaleString("es-CO")}`,
        ...(order.quotationUrl ? ["", `Cotización: ${order.quotationUrl}`, "Solicitud sujeta a confirmación. Validez: 15 días."] : []),
        "",
        `Cliente: ${customerName.trim()}`,
        `Teléfono: ${customerPhone.trim()}`,
        `Dirección de entrega: ${customerAddress.trim()}`,
        ...(notes.trim() ? [`Nota: ${notes.trim()}`] : []),
      ].join("\n");
      const whatsappNumber = catalog.whatsappPhone.replace(/\D/g, "");
      setReceipt(order);
      pendingOrderRef.current = null;
      setWhatsAppUrl(`https://wa.me/${whatsappNumber}?text=${encodeURIComponent(message)}`);
      setQuantities({});
      sessionStorage.removeItem(cartStorageKey);
      setConsent(false);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo registrar el pedido.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <PublicRouteLoading kind="cart" />;
  }

  if (!catalog) {
    return <main className="grid min-h-screen place-items-center bg-[#f4f3eb] px-5 text-center"><div><h1 className="font-serif text-3xl text-[#263b31]">No pudimos abrir el carrito.</h1><p className="mt-2 text-sm text-[#68756e]">{error}</p></div></main>;
  }

  const normalizedTemplate = catalog.template === "GRID" ? "TECH"
    : catalog.template === "EDITORIAL" ? "FASHION"
      : catalog.template === "BOUTIQUE" ? "BEAUTY"
        : catalog.template;
  const theme = normalizedTemplate in cartThemes
    ? cartThemes[normalizedTemplate as keyof typeof cartThemes]
    : cartThemes.DEFAULT;
  const themeStyle = {
    "--cart-bg": theme.background,
    "--cart-fg": theme.foreground,
    "--cart-muted": theme.muted,
    "--cart-border": theme.border,
    "--cart-surface": theme.surface,
    "--cart-card": theme.card,
    "--cart-accent": theme.accent,
    "--cart-accent-fg": theme.accentForeground,
    "--cart-soft": theme.soft,
    "--cart-danger": theme.danger,
    ...catalogTheme,
  } as CSSProperties;
  const controlClass = "mt-1.5 min-h-11 w-full rounded-xl border border-[var(--catalog-border,var(--cart-border))] bg-[var(--cart-bg)] px-3 text-[var(--cart-fg)] outline-none transition placeholder:text-[var(--cart-muted)] focus:border-[var(--cart-accent)] focus:ring-4 focus:ring-[var(--catalog-focus-ring,color-mix(in_oklab,var(--cart-accent)_10%,transparent))]";
  const areaClass = "mt-1.5 w-full rounded-xl border border-[var(--catalog-border,var(--cart-border))] bg-[var(--cart-bg)] px-3 py-2 text-[var(--cart-fg)] outline-none transition placeholder:text-[var(--cart-muted)] focus:border-[var(--cart-accent)] focus:ring-4 focus:ring-[var(--catalog-focus-ring,color-mix(in_oklab,var(--cart-accent)_10%,transparent))]";

  return (
    <main data-cart-theme={normalizedTemplate} data-catalog-themed={catalogTheme ? "true" : undefined} style={themeStyle} className={`${themeStyles.root} min-h-screen bg-[var(--cart-bg)] text-[var(--cart-fg)] transition-colors duration-300`}>
      <div className="mx-auto max-w-7xl px-5 pb-16 pt-6 sm:px-8 sm:pt-9">
        <Link href={`/c/${encodeURIComponent(publicId)}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[var(--cart-muted)] transition hover:text-[var(--cart-accent)]">
          <span aria-hidden="true">←</span> Seguir comprando
        </Link>
        <header className="mt-4 flex flex-wrap items-end justify-between gap-4 border-y border-[var(--cart-border)] py-5 sm:py-7">
          <div className="flex items-center gap-3">{catalog.logoUrl && <Image src={catalog.logoUrl} alt="" width={48} height={48} unoptimized className="size-12 rounded-xl bg-[var(--cart-card)] object-contain p-1" />}<div><p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--cart-accent)]">Tu selección · {catalog.name}</p><h1 className="mt-2 font-serif text-4xl leading-tight sm:text-5xl">Carrito</h1></div></div>
          <p className="rounded-full border border-[var(--cart-border)] bg-[var(--cart-card)] px-3 py-1.5 text-sm text-[var(--cart-muted)]">{cartCount} {cartCount === 1 ? "unidad" : "unidades"}</p>
        </header>

        {cartItems.length === 0 && !receipt ? (
          <section className="mx-auto my-10 max-w-2xl rounded-3xl border border-[var(--cart-border)] bg-[var(--cart-card)] px-6 py-16 text-center shadow-sm sm:my-14 sm:py-20">
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--cart-accent)]">Todavía está vacío</p>
            <h2 className="mt-3 font-serif text-3xl">Empieza por algo que te guste.</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[var(--cart-muted)]">Los productos que agregues aparecerán aquí para revisar cantidades y preparar tu pedido.</p>
            <Link href={`/c/${encodeURIComponent(publicId)}`} className="mt-7 inline-flex min-h-12 items-center justify-center rounded-xl bg-[var(--cart-accent)] px-6 text-sm font-semibold text-[var(--cart-accent-fg)] transition hover:brightness-[var(--catalog-hover-brightness,1.1)]">Explorar catálogo</Link>
          </section>
        ) : (
          <div className="grid items-start gap-10 pt-7 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.7fr)] lg:gap-16 lg:pt-10">
            <section aria-labelledby="cart-items-heading">
              <div className="mb-4 flex items-end justify-between gap-4"><h2 id="cart-items-heading" className="text-lg font-semibold">Productos</h2><span className="text-xs text-[var(--cart-muted)]">Precio en COP</span></div>
              {cartItems.length > 0 ? (
                <ul className="divide-y divide-[var(--cart-border)] overflow-hidden rounded-2xl border border-[var(--cart-border)] bg-[var(--cart-card)] px-4 sm:px-5">
                  {cartItems.map((product) => (
                    <li key={product.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 py-4 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:gap-5">
                      <Link href={`/c/${encodeURIComponent(publicId)}/producto/${encodeURIComponent(product.slug)}`} aria-label={`Ver ${product.name}`} className="relative aspect-square overflow-hidden rounded-xl border border-[var(--cart-border)] bg-[var(--cart-surface)]">
                        {product.images[0] ? <Image src={product.images[0].url} alt={product.images[0].alt || product.name} fill unoptimized sizes="96px" className="object-cover" /> : <span className="grid h-full place-items-center px-2 text-center font-serif text-xs text-[var(--cart-muted)]">{product.name}</span>}
                      </Link>
                      <div className="flex min-w-0 flex-col justify-center">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--cart-accent)]">{product.category?.name || "Producto"}</p>
                        <Link href={`/c/${encodeURIComponent(publicId)}/producto/${encodeURIComponent(product.slug)}`} className="mt-1 truncate text-sm font-semibold hover:underline">{product.name}</Link>
                        <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                          <p className={`text-xs font-semibold tabular-nums ${product.regularPrice !== null ? "text-[var(--cart-danger)]" : "text-[var(--cart-muted)]"}`}>${product.price.toLocaleString("es-CO")} c/u</p>
                          {product.regularPrice !== null && <p className="text-[10px] tabular-nums text-[var(--cart-muted)] line-through">${product.regularPrice.toLocaleString("es-CO")}</p>}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button type="button" onClick={() => changeQuantity(product, -1)} aria-label={`Quitar una unidad de ${product.name}`} className="grid size-9 place-items-center rounded-lg border border-[var(--catalog-border,var(--cart-border))] bg-[var(--cart-bg)] text-lg transition hover:border-[var(--cart-accent)]">−</button>
                          <span aria-live="polite" className="w-7 text-center text-sm tabular-nums">{quantities[product.id]}</span>
                          <button type="button" onClick={() => changeQuantity(product, 1)} aria-label={`Añadir una unidad de ${product.name}`} className="grid size-9 place-items-center rounded-lg border border-[var(--catalog-border,var(--cart-border))] bg-[var(--cart-bg)] text-lg transition hover:border-[var(--cart-accent)]">+</button>
                        </div>
                      </div>
                      <p className="col-start-2 row-start-2 self-end text-sm font-semibold tabular-nums sm:col-start-3 sm:row-start-1 sm:self-center">${(product.price * quantities[product.id]).toLocaleString("es-CO")}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <div role="status" className="rounded-2xl border border-[var(--cart-border)] bg-[var(--cart-card)] p-5">
                  <p className="text-sm font-semibold">Pedido registrado · {receipt?.id.slice(0, 8)}</p>
                  <p className="mt-2 text-sm text-[var(--cart-muted)]">Tu pedido quedó registrado. Continúa en WhatsApp para contactar al vendedor; el mensaje todavía no se ha enviado.</p>
                  {whatsAppUrl && <a href={whatsAppUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center rounded-xl bg-[var(--cart-accent)] px-5 text-sm font-semibold text-[var(--cart-accent-fg)]">Enviar por WhatsApp</a>}
                </div>
              )}
            </section>

            {cartItems.length > 0 && (
              <section className="lg:sticky lg:top-6">
                <div className="rounded-2xl border border-[var(--cart-border)] bg-[var(--cart-card)] p-5 shadow-[0_18px_50px_-40px_rgba(0,0,0,0.35)] sm:p-6">
                  <p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--cart-accent)]">Cierre de compra</p>
                  <h2 className="mt-1 text-xl font-semibold">Datos de entrega</h2>
                  <form onSubmit={submitOrder} className="mt-5 space-y-4">
                    <label className="block text-sm font-medium">Nombre<input required maxLength={100} autoComplete="name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} className={controlClass} /></label>
                    <label className="block text-sm font-medium">Teléfono<input required type="tel" maxLength={24} autoComplete="tel" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} className={controlClass} /></label>
                    <label className="block text-sm font-medium">Correo <span className="font-normal text-[var(--cart-muted)]">(opcional)</span><input type="email" maxLength={254} autoComplete="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} className={controlClass} /></label>
                    <label className="block text-sm font-medium">Dirección de entrega<textarea required minLength={5} maxLength={300} autoComplete="street-address" rows={3} value={customerAddress} onChange={(event) => setCustomerAddress(event.target.value)} className={areaClass} /></label>
                    <label className="block text-sm font-medium">Nota <span className="font-normal text-[var(--cart-muted)]">(opcional)</span><textarea maxLength={500} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} className={areaClass} /></label>
                    <label className="flex items-start gap-2.5 text-xs leading-5 text-[var(--cart-muted)]"><input required type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 size-4 accent-[var(--cart-accent)]" /><span>{CUSTOMER_CONSENT.text} <a href="/privacidad" className="underline underline-offset-4">Consultar la política de privacidad</a>.</span></label>
                    {error && <p role="alert" className="bg-[var(--catalog-danger-surface,#fff1ec)] px-3 py-2 text-sm text-[var(--catalog-danger,#a5432a)]">{error}</p>}
                    <div className="border-t border-[var(--catalog-border-subtle,#e3e7e0)] pt-4">
                      <p className="flex justify-between text-sm text-[var(--cart-muted)]"><span>Subtotal</span><span className="tabular-nums">${cartTotal.toLocaleString("es-CO")}</span></p>
                      <p className="mt-2 flex justify-between text-base font-semibold"><span>Total</span><span className="tabular-nums">${cartTotal.toLocaleString("es-CO")}</span></p>
                    </div>
                    <button type="submit" disabled={submitting || !catalog.whatsappPhone} className="min-h-12 w-full rounded-xl bg-[var(--cart-accent)] px-4 text-sm font-semibold text-[var(--cart-accent-fg)] transition hover:brightness-[var(--catalog-hover-brightness,1.1)] disabled:cursor-not-allowed disabled:opacity-50">{submitting ? "Preparando pedido..." : "Confirmar pedido"}</button>
                    {!catalog.whatsappPhone && <p className="text-xs leading-5 text-[var(--cart-danger)]">La tienda todavía no configuró WhatsApp para recibir pedidos.</p>}
                    <p className="text-[11px] leading-5 text-[var(--cart-muted)]">La disponibilidad y la entrega quedan por confirmar con el vendedor. No se solicitan pagos ni datos bancarios; el pedido queda pendiente de confirmación.</p>
                  </form>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
      <FloatingWhatsAppButton catalog={catalog} />
    </main>
  );
}
