"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, startTransition, useEffect, useState } from "react";
import { publicApiRequest, PublicCatalog, PublicProduct } from "@/lib/api";

type OrderReceipt = {
  id: string;
  total: number;
  items: { productName: string; quantity: number; unitPrice: number; subtotal: number }[];
};

export default function PublicShoppingCartPage({ publicId }: { publicId: string }) {
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
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
  const cartStorageKey = `catalogo-cart-${publicId}`;

  useEffect(() => {
    let active = true;
    publicApiRequest<{ catalog: PublicCatalog }>(`/public/catalogs/${encodeURIComponent(publicId)}`)
      .then(({ catalog: loadedCatalog }) => {
        if (!active) return;
        setCatalog(loadedCatalog);
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
      const result = await publicApiRequest<{ order: OrderReceipt }>(`/public/catalogs/${encodeURIComponent(publicId)}/orders`, {
        method: "POST",
        body: JSON.stringify({
          customerName: customerName.trim(),
          customerPhone: customerPhone.trim(),
          customerEmail: customerEmail.trim() || undefined,
          customerAddress: customerAddress.trim(),
          consent: true,
          notes: notes.trim() || undefined,
          items: cartItems.map((product) => ({ productId: product.id, quantity: quantities[product.id] })),
        }),
      });
      const order = result.order;
      const orderLines = order.items.map((item) => `- ${item.quantity} x ${item.productName}: $${item.subtotal.toLocaleString("es-CO")}`);
      const message = [
        `Hola, quiero confirmar la orden ${order.id.slice(0, 8)}.`,
        "",
        ...orderLines,
        `Total: $${order.total.toLocaleString("es-CO")}`,
        "",
        `Cliente: ${customerName.trim()}`,
        `Teléfono: ${customerPhone.trim()}`,
        `Dirección de entrega: ${customerAddress.trim()}`,
        ...(notes.trim() ? [`Nota: ${notes.trim()}`] : []),
      ].join("\n");
      const whatsappNumber = catalog.whatsappPhone.replace(/\D/g, "");
      setReceipt(order);
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
    return <main className="grid min-h-screen place-items-center bg-[#f4f3eb] px-5 text-sm text-[#526257]">Cargando carrito...</main>;
  }

  if (!catalog) {
    return <main className="grid min-h-screen place-items-center bg-[#f4f3eb] px-5 text-center"><div><h1 className="font-serif text-3xl text-[#263b31]">No pudimos abrir el carrito.</h1><p className="mt-2 text-sm text-[#68756e]">{error}</p></div></main>;
  }

  return (
    <main className="min-h-screen bg-[#f4f3eb] text-[#263b31]">
      <div className="mx-auto max-w-7xl px-5 pb-16 pt-6 sm:px-8 sm:pt-9">
        <Link href={`/c/${encodeURIComponent(publicId)}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-[#41574b] transition hover:text-[#bd4d36]">
          <span aria-hidden="true">←</span> Seguir comprando
        </Link>
        <header className="mt-4 flex flex-wrap items-end justify-between gap-4 border-y border-[#d7d9cf] py-5 sm:py-7">
          <div><p className="text-xs font-semibold uppercase text-[#ad553b]">Tu selección · {catalog.name}</p><h1 className="mt-2 font-serif text-4xl leading-tight sm:text-5xl">Carrito</h1></div>
          <p className="text-sm text-[#68756e]">{cartCount} {cartCount === 1 ? "unidad" : "unidades"}</p>
        </header>

        {cartItems.length === 0 && !receipt ? (
          <section className="py-16 text-center sm:py-24">
            <p className="text-xs font-semibold uppercase text-[#ad553b]">Todavía está vacío</p>
            <h2 className="mt-3 font-serif text-3xl text-[#263b31]">Empieza por algo que te guste.</h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-6 text-[#68756e]">Los productos que agregues aparecerán aquí para revisar cantidades y preparar tu pedido.</p>
            <Link href={`/c/${encodeURIComponent(publicId)}`} className="mt-7 inline-flex min-h-12 items-center justify-center bg-[#263b31] px-6 text-sm font-semibold text-white transition hover:bg-[#192b22]">Explorar catálogo</Link>
          </section>
        ) : (
          <div className="grid items-start gap-10 pt-7 lg:grid-cols-[minmax(0,1fr)_minmax(340px,0.7fr)] lg:gap-16 lg:pt-10">
            <section aria-labelledby="cart-items-heading">
              <div className="mb-4 flex items-end justify-between gap-4"><h2 id="cart-items-heading" className="text-lg font-semibold">Productos</h2><span className="text-xs text-[#68756e]">Precio en COP</span></div>
              {cartItems.length > 0 ? (
                <ul className="divide-y divide-[#d7d9cf] border-y border-[#d7d9cf]">
                  {cartItems.map((product) => (
                    <li key={product.id} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 py-4 sm:grid-cols-[6rem_minmax(0,1fr)_auto] sm:gap-5">
                      <Link href={`/c/${encodeURIComponent(publicId)}/producto/${encodeURIComponent(product.slug)}`} aria-label={`Ver ${product.name}`} className="relative aspect-square overflow-hidden border border-black/5 bg-[#e8e9dc]">
                        {product.images[0] ? <Image src={product.images[0].url} alt={product.images[0].alt || product.name} fill unoptimized sizes="96px" className="object-cover" /> : <span className="grid h-full place-items-center px-2 text-center font-serif text-xs text-[#45584d]">{product.name}</span>}
                      </Link>
                      <div className="flex min-w-0 flex-col justify-center">
                        <p className="text-[10px] font-semibold uppercase text-[#ad553b]">{product.category?.name || "Producto"}</p>
                        <Link href={`/c/${encodeURIComponent(publicId)}/producto/${encodeURIComponent(product.slug)}`} className="mt-1 truncate text-sm font-semibold text-[#263b31] hover:underline">{product.name}</Link>
                        <div className="mt-1 flex flex-wrap items-baseline gap-x-2">
                          <p className={`text-xs font-semibold tabular-nums ${product.regularPrice !== null ? "text-[#c62828]" : "text-[#68756e]"}`}>${product.price.toLocaleString("es-CO")} c/u</p>
                          {product.regularPrice !== null && <p className="text-[10px] tabular-nums text-[#737d77] line-through">${product.regularPrice.toLocaleString("es-CO")}</p>}
                        </div>
                        <div className="mt-3 flex items-center gap-2">
                          <button type="button" onClick={() => changeQuantity(product, -1)} aria-label={`Quitar una unidad de ${product.name}`} className="grid size-9 place-items-center border border-[#cbd4cb] bg-white text-lg">−</button>
                          <span aria-live="polite" className="w-7 text-center text-sm tabular-nums">{quantities[product.id]}</span>
                          <button type="button" onClick={() => changeQuantity(product, 1)} aria-label={`Añadir una unidad de ${product.name}`} className="grid size-9 place-items-center border border-[#cbd4cb] bg-white text-lg">+</button>
                        </div>
                      </div>
                      <p className="col-start-2 row-start-2 self-end text-sm font-semibold tabular-nums text-[#263b31] sm:col-start-3 sm:row-start-1 sm:self-center">${(product.price * quantities[product.id]).toLocaleString("es-CO")}</p>
                    </li>
                  ))}
                </ul>
              ) : (
                <div role="status" className="border-y border-[#d7d9cf] py-6">
                  <p className="text-sm font-semibold">Pedido registrado · {receipt?.id.slice(0, 8)}</p>
                  <p className="mt-2 text-sm text-[#68756e]">Tu lista ya está en camino al vendedor.</p>
                  {whatsAppUrl && <a href={whatsAppUrl} target="_blank" rel="noopener noreferrer" className="mt-4 inline-flex min-h-11 items-center bg-[#263b31] px-5 text-sm font-semibold text-white">Enviar por WhatsApp</a>}
                </div>
              )}
            </section>

            {cartItems.length > 0 && (
              <section className="lg:sticky lg:top-20">
                <div className="border border-[#d7d9cf] bg-white p-5 sm:p-6">
                  <p className="text-xs font-semibold uppercase text-[#ad553b]">Cierre de compra</p>
                  <h2 className="mt-1 text-xl font-semibold">Datos de entrega</h2>
                  <form onSubmit={submitOrder} className="mt-5 space-y-4">
                    <label className="block text-sm font-medium text-[#37443d]">Nombre<input required maxLength={100} autoComplete="name" value={customerName} onChange={(event) => setCustomerName(event.target.value)} className="mt-1.5 min-h-11 w-full border border-[#cbd4cb] px-3 outline-none focus:border-[#315c53]" /></label>
                    <label className="block text-sm font-medium text-[#37443d]">Teléfono<input required type="tel" maxLength={24} autoComplete="tel" value={customerPhone} onChange={(event) => setCustomerPhone(event.target.value)} className="mt-1.5 min-h-11 w-full border border-[#cbd4cb] px-3 outline-none focus:border-[#315c53]" /></label>
                    <label className="block text-sm font-medium text-[#37443d]">Correo <span className="font-normal text-[#849087]">(opcional)</span><input type="email" maxLength={254} autoComplete="email" value={customerEmail} onChange={(event) => setCustomerEmail(event.target.value)} className="mt-1.5 min-h-11 w-full border border-[#cbd4cb] px-3 outline-none focus:border-[#315c53]" /></label>
                    <label className="block text-sm font-medium text-[#37443d]">Dirección de entrega<textarea required minLength={5} maxLength={300} autoComplete="street-address" rows={3} value={customerAddress} onChange={(event) => setCustomerAddress(event.target.value)} className="mt-1.5 w-full resize-y border border-[#cbd4cb] px-3 py-2 outline-none focus:border-[#315c53]" /></label>
                    <label className="block text-sm font-medium text-[#37443d]">Nota <span className="font-normal text-[#849087]">(opcional)</span><textarea maxLength={500} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} className="mt-1.5 w-full resize-y border border-[#cbd4cb] px-3 py-2 outline-none focus:border-[#315c53]" /></label>
                    <label className="flex items-start gap-2.5 text-xs leading-5 text-[#68756e]"><input required type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5 size-4 accent-[#315c53]" /><span>Autorizo guardar estos datos para gestionar este pedido. Después podré abrir WhatsApp y enviar al vendedor la lista, mi teléfono y mi dirección.</span></label>
                    {error && <p role="alert" className="bg-[#fff1ec] px-3 py-2 text-sm text-[#a5432a]">{error}</p>}
                    <div className="border-t border-[#e3e7e0] pt-4">
                      <p className="flex justify-between text-sm text-[#68756e]"><span>Subtotal</span><span className="tabular-nums">${cartTotal.toLocaleString("es-CO")}</span></p>
                      <p className="mt-2 flex justify-between text-base font-semibold"><span>Total</span><span className="tabular-nums">${cartTotal.toLocaleString("es-CO")}</span></p>
                    </div>
                    <button type="submit" disabled={submitting || !catalog.whatsappPhone} className="min-h-12 w-full bg-[#263b31] px-4 text-sm font-semibold text-white transition hover:bg-[#192b22] disabled:cursor-not-allowed disabled:opacity-50">{submitting ? "Preparando pedido..." : "Confirmar pedido"}</button>
                    {!catalog.whatsappPhone && <p className="text-xs leading-5 text-[#a5432a]">La tienda todavía no configuró WhatsApp para recibir pedidos.</p>}
                    <p className="text-[11px] leading-5 text-[#849087]">No se solicitan pagos ni datos bancarios. El pedido queda pendiente de confirmación del vendedor.</p>
                  </form>
                </div>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}