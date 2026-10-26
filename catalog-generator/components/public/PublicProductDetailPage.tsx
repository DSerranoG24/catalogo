"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, startTransition, useEffect, useState } from "react";
import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { publicApiRequest, PublicCatalog, PublicProduct, PublicProductReview, rememberPublicCatalogTemplate } from "@/lib/api";
import FloatingWhatsAppButton from "@/components/public/FloatingWhatsAppButton";
import type { CatalogThemeStyle } from "@/lib/catalog-theme";
import themeStyles from "./catalog-theme.module.css";

type PublicReviewFeed = {
  averageRating: number | null;
  reviewCount: number;
  reviews: PublicProductReview[];
};

const emptyReviewFeed: PublicReviewFeed = { averageRating: null, reviewCount: 0, reviews: [] };

export default function PublicProductDetailPage({
  publicId,
  initialCatalog: catalog,
  initialProduct: product,
  themeStyle,
}: {
  publicId: string;
  initialCatalog: PublicCatalog;
  initialProduct: PublicProduct;
  themeStyle?: CatalogThemeStyle;
}) {
  const router = useRouter();
  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(0);
  const [added, setAdded] = useState(false);
  const [reviewFeed, setReviewFeed] = useState(emptyReviewFeed);
  const [reviewName, setReviewName] = useState("");
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewError, setReviewError] = useState("");
  const [reviewNotice, setReviewNotice] = useState("");
  const cartStorageKey = `catalogo-cart-${publicId}`;

  useEffect(() => {
    rememberPublicCatalogTemplate(publicId, catalog.template);
  }, [publicId, catalog.template]);

  useEffect(() => {
    try {
      const storedCart = sessionStorage.getItem(cartStorageKey);
      if (!storedCart) return;
      const parsed: unknown = JSON.parse(storedCart);
      if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return;
      const storedQuantity = (parsed as Record<string, unknown>)[product?.id ?? ""];
      if (typeof storedQuantity === "number" && Number.isInteger(storedQuantity)) {
        startTransition(() => setQuantity(storedQuantity));
      }
    } catch {
      sessionStorage.removeItem(cartStorageKey);
    }
  }, [cartStorageKey, product?.id]);

  useEffect(() => {
    if (!product) return;
    let active = true;
    publicApiRequest<PublicReviewFeed>(`/public/catalogs/${encodeURIComponent(publicId)}/products/${encodeURIComponent(product.slug)}/reviews`)
      .then((result) => {
        if (active) setReviewFeed(result);
      })
      .catch(() => {
        if (active) setReviewError("No se pudieron cargar las opiniones en este momento.");
      });
    return () => {
      active = false;
    };
  }, [product, publicId]);

  function addToOrder() {
    if (!product) return;
    let storedCart: Record<string, unknown> = {};
    try {
      const parsed: unknown = JSON.parse(sessionStorage.getItem(cartStorageKey) ?? "{}");
      if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
        storedCart = parsed as Record<string, unknown>;
      }
    } catch {
      storedCart = {};
    }
    const currentQuantity = storedCart[product.id];
    const nextQuantity = Math.min(99, (typeof currentQuantity === "number" ? currentQuantity : 0) + 1);
    const nextCart = { ...storedCart, [product.id]: nextQuantity };
    sessionStorage.setItem(cartStorageKey, JSON.stringify(nextCart));
    setQuantity(nextQuantity);
    setAdded(true);
    router.push(`/c/${encodeURIComponent(publicId)}/carrito`);
  }

  async function submitReview(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!product) return;
    setReviewSubmitting(true);
    setReviewError("");
    setReviewNotice("");
    try {
      const result = await publicApiRequest<{ message: string }>(`/public/catalogs/${encodeURIComponent(publicId)}/products/${encodeURIComponent(product.slug)}/reviews`, {
        method: "POST",
        body: JSON.stringify({
          displayName: reviewName.trim() || undefined,
          rating: reviewRating,
          comment: reviewComment.trim(),
        }),
      });
      setReviewNotice(result.message);
      setReviewName("");
      setReviewComment("");
      setReviewRating(5);
    } catch (requestError) {
      setReviewError(requestError instanceof Error ? requestError.message : "No se pudo enviar tu reseña.");
    } finally {
      setReviewSubmitting(false);
    }
  }

  const image = product.images[selectedImage];
  const isOnSale = product.regularPrice !== null && product.discountPercent !== null;
  const isTech = catalog.template === "TECH" || catalog.template === "GRID";
  const isBeauty = catalog.template === "BEAUTY" || catalog.template === "BOUTIQUE" || catalog.template === "GLAMOUR";
  const isFashion = catalog.template === "FASHION" || catalog.template === "EDITORIAL";
  const surface = isTech ? "bg-[var(--catalog-background,#081421)]" : isBeauty ? "bg-[var(--catalog-background,#fff8f6)]" : isFashion ? "bg-[var(--catalog-background,#f7f2ec)]" : "bg-[var(--catalog-background,#f4f3eb)]";
  const foreground = isTech ? "text-[var(--catalog-text,#e5f2ff)]" : isBeauty ? "text-[var(--catalog-text,#552e48)]" : "text-[var(--catalog-text,#322c29)]";
  const accent = isTech ? "text-[var(--catalog-primary,#56e0c0)]" : isBeauty ? "text-[var(--catalog-primary,#b55271)]" : isFashion ? "text-[var(--catalog-primary,#9a554b)]" : "text-[var(--catalog-primary,#ad553b)]";
  const action = isTech ? "bg-[var(--catalog-primary,#56e0c0)] text-[var(--catalog-on-primary,#071421)] hover:bg-[var(--catalog-primary-hover,#8af3d8)]" : isBeauty ? "bg-[var(--catalog-primary,#b55271)] hover:bg-[var(--catalog-primary-hover,#98425f)]" : isFashion ? "bg-[var(--catalog-primary,#322c29)] hover:bg-[var(--catalog-primary-hover,#4c3f39)]" : "bg-[var(--catalog-primary,#263b31)] hover:bg-[var(--catalog-primary-hover,#192b22)]";
  const reviewSurface = isTech ? "border-[var(--catalog-border-subtle,#26394a)] bg-[var(--catalog-surface,#0e1d2b)]" : isBeauty ? "border-[var(--catalog-border-subtle,#efd5dd)] bg-[var(--catalog-surface,#ffffff)]" : "border-[var(--catalog-border-subtle,#e5d9d0)] bg-[var(--catalog-surface,#fffaf6)]";
  const reviewText = isTech ? "text-[var(--catalog-text,#e5f2ff)]" : isBeauty ? "text-[var(--catalog-text,#552e48)]" : "text-[var(--catalog-text,#322c29)]";
  const reviewMuted = isTech ? "text-[var(--catalog-text-muted,#a9bccd)]" : isBeauty ? "text-[var(--catalog-text-muted,#896879)]" : "text-[var(--catalog-text-muted,#766b64)]";
  const reviewInput = isTech ? "border-[var(--catalog-border,#26394a)] bg-[var(--catalog-surface,#091725)] text-[var(--catalog-text,#e5f2ff)] placeholder:text-[var(--catalog-text-muted,#7f94a8)] focus:border-[var(--catalog-focus,#56e0c0)]" : isBeauty ? "border-[var(--catalog-border,#efd5dd)] bg-[var(--catalog-surface,#fffaf9)] text-[var(--catalog-text,#552e48)] placeholder:text-[var(--catalog-text-muted,#b495a4)] focus:border-[var(--catalog-focus,#b55271)]" : "border-[var(--catalog-border,#dfd2c5)] bg-[var(--catalog-surface,#ffffff)] text-[var(--catalog-text,#322c29)] placeholder:text-[var(--catalog-text-muted,#a89a90)] focus:border-[var(--catalog-focus,#9a554b)]";
  const reviewStar = isTech ? "text-[var(--catalog-primary,#56e0c0)] focus-visible:outline-[var(--catalog-focus,#56e0c0)]" : isBeauty ? "text-[var(--catalog-primary,#b55271)] focus-visible:outline-[var(--catalog-focus,#b55271)]" : "text-[var(--catalog-text-muted,#c28a35)] focus-visible:outline-[var(--catalog-focus,#c28a35)]";

  return (
    <main style={themeStyle} data-catalog-themed={themeStyle ? "true" : undefined} className={`${themeStyles.root} min-h-screen ${surface} ${foreground}`}>
      <div className="mx-auto max-w-7xl px-5 pb-16 pt-6 sm:px-8 sm:pt-9">
        <Link href={`/c/${encodeURIComponent(publicId)}#productos`} className={`inline-flex min-h-10 items-center gap-2 text-sm font-semibold transition ${isTech ? "text-[var(--catalog-text-muted,#a9bccd)] hover:text-[var(--catalog-primary,#56e0c0)]" : "text-[var(--catalog-text-muted,#41574b)] hover:text-[var(--catalog-primary,#bd4d36)]"}`}>
          <span aria-hidden="true">←</span> Volver a {catalog.name}
        </Link>
        <div className={`mt-5 border-y py-2.5 text-[10px] font-semibold uppercase ${isTech ? "border-[var(--catalog-border-subtle,#26394a)] text-[var(--catalog-text-muted,#a9bccd)]" : "border-[var(--catalog-border-subtle,#e5d9d0)] text-[var(--catalog-text-muted,#766b64)]"}`}>
          <span className="inline-flex items-center gap-2">{catalog.logoUrl && <img src={catalog.logoUrl} alt="" className="size-8 rounded-full bg-[var(--catalog-surface,#ffffff)] object-contain" />}<span>{catalog.name}</span></span><span className="px-2 text-[var(--catalog-primary,#bd4d36)]">/</span><span>{product.category?.name || "Producto"}</span>
        </div>

        <section className="grid gap-8 pb-8 pt-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:gap-14 lg:pt-10">
          <div className="min-w-0">
            <div className={`relative aspect-[4/3] overflow-hidden border border-[var(--catalog-border-subtle-alpha-5,color-mix(in_oklab,var(--color-black)_5%,transparent))] ${isTech ? "bg-[var(--catalog-soft,#182c3c)]" : isBeauty ? "bg-[var(--catalog-soft,#f5dfe6)]" : isFashion ? "bg-[var(--catalog-soft,#e9ddd2)]" : "bg-[var(--catalog-soft,#e8e9dc)]"}`}>
              {image ? (
                <Image src={image.url} alt={image.alt || product.name} fill unoptimized sizes="(max-width: 1024px) 100vw, 60vw" className="object-cover" priority />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[image:var(--catalog-art-background,linear-gradient(135deg,transparent_49.5%,rgba(37,72,58,0.08)_50%,transparent_50.5%),linear-gradient(45deg,transparent_49.5%,rgba(37,72,58,0.06)_50%,transparent_50.5%))] bg-[length:44px_44px] px-8 text-center">
                  <span className="max-w-2xl text-balance font-serif text-4xl leading-tight text-[var(--catalog-text,#405549)] sm:text-6xl">{product.name}</span>
                  <span className="text-[10px] font-semibold uppercase text-[var(--catalog-text-muted,#617568)]">Fotografía por añadir</span>
                </div>
              )}
              <span className="absolute bottom-3 left-3 bg-[var(--catalog-surface-alpha-90,color-mix(in_oklab,var(--color-white)_90%,transparent))] px-3 py-2 text-xs font-semibold text-[var(--catalog-text,#263b31)] backdrop-blur-sm">{product.category?.name || "Selección"}</span>
            </div>
            {product.images.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto">
                {product.images.map((item, index) => (
                  <button key={item.id} type="button" onClick={() => setSelectedImage(index)} aria-label={`Ver fotografía ${index + 1}`} aria-pressed={selectedImage === index} className={`relative size-16 shrink-0 overflow-hidden border-2 ${selectedImage === index ? "border-[var(--catalog-border,#bd4d36)]" : "border-transparent"}`}>
                    <Image src={item.url} alt={item.alt || `${product.name}, foto ${index + 1}`} fill unoptimized sizes="64px" className="object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col py-1 lg:py-5">
            <p className={`text-xs font-semibold uppercase ${accent}`}>{product.brand || catalog.name}</p>
            <h1 className={`mt-3 text-balance font-serif text-4xl leading-[1.08] sm:text-5xl ${isTech ? "font-sans font-semibold tracking-tight text-[var(--catalog-text,#ffffff)]" : "text-[var(--catalog-text,#322c29)]"}`}>{product.name}</h1>
            {product.model && <p className={`mt-3 text-sm ${isTech ? "text-[var(--catalog-text-muted,#a9bccd)]" : "text-[var(--catalog-text-muted,#68756e)]"}`}>Modelo {product.model}</p>}
            <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className={`text-2xl font-bold tabular-nums ${isOnSale ? "text-[var(--catalog-danger,#c62828)]" : isTech ? "text-[var(--catalog-text,#ffffff)]" : "text-[var(--catalog-text,#202b27)]"}`}>${product.price.toLocaleString("es-CO")}</p>
              {isOnSale && <>
                <p className="text-base tabular-nums text-[var(--catalog-text-muted,#737d77)] line-through">${product.regularPrice!.toLocaleString("es-CO")}</p>
                <span className="bg-[var(--catalog-danger,#c62828)] px-2 py-1 text-xs font-bold tabular-nums text-[var(--catalog-danger-label,#ffffff)]">-{product.discountPercent}%</span>
              </>}
            </div>
            {isOnSale && product.saleEndsAt && <p className="mt-2 text-xs font-semibold text-[var(--catalog-danger,#b42318)]">Oferta válida hasta {new Date(product.saleEndsAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}</p>}
            <div className={`my-6 border-y py-5 ${isTech ? "border-[var(--catalog-border-subtle,#26394a)]" : "border-[var(--catalog-border-subtle,#e5d9d0)]"}`}>
              <h2 className={`text-xs font-semibold uppercase ${accent}`}>Detalles</h2>
              <p className={`mt-3 whitespace-pre-line text-sm leading-7 ${isTech ? "text-[var(--catalog-text-muted,#a9bccd)]" : "text-[var(--catalog-text-muted,#756b64)]"}`}>{product.description || "Consulta con la tienda para conocer más detalles de este producto."}</p>
            </div>
            <div className="mt-auto space-y-3">
              <button type="button" onClick={addToOrder} className={`flex min-h-12 w-full items-center justify-center gap-2 px-5 text-sm font-semibold text-[var(--catalog-on-primary,#ffffff)] transition ${action}`}>
                {added ? "Añadir otra unidad" : "Añadir al pedido"}<span aria-hidden="true">+</span>
              </button>
              <Link href={quantity > 0 ? `/c/${encodeURIComponent(publicId)}/carrito` : `/c/${encodeURIComponent(publicId)}`} className="flex min-h-11 items-center justify-center border border-[var(--catalog-border,#aebbb0)] px-5 text-sm font-semibold text-[var(--catalog-text,#31483b)] transition hover:bg-[var(--catalog-surface-alpha-70,color-mix(in_oklab,var(--color-white)_70%,transparent))]">
                {quantity > 0 ? `Ver carrito · ${quantity} ${quantity === 1 ? "unidad" : "unidades"}` : "Seguir explorando"}
              </Link>
            </div>
          </div>
        </section>

        <section aria-labelledby="reviews-heading" className={`border-t py-8 sm:py-12 ${isTech ? "border-[var(--catalog-border-subtle,#26394a)]" : isBeauty ? "border-[var(--catalog-border-subtle,#efd5dd)]" : "border-[var(--catalog-border-subtle,#e5d9d0)]"}`}>
          <div className="grid gap-8 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-14">
            <div>
              <p className={`text-xs font-semibold uppercase ${accent}`}>Experiencias de clientes</p>
              <h2 id="reviews-heading" className={`mt-2 font-serif text-3xl ${foreground}`}>Calificaciones y comentarios</h2>
              <div className="mt-5 flex items-center gap-3">
                <span className={`text-4xl font-semibold tabular-nums ${foreground}`}>{reviewFeed.averageRating?.toFixed(1) ?? "—"}</span>
                <div>
                  <div aria-label={reviewFeed.averageRating ? `${reviewFeed.averageRating.toFixed(1)} de 5 estrellas` : "Sin calificaciones"} className={`flex ${reviewStar}`}>
                    {Array.from({ length: 5 }, (_, index) => <Star key={index} aria-hidden="true" size={17} fill={reviewFeed.averageRating && index < Math.round(reviewFeed.averageRating) ? "currentColor" : "none"} strokeWidth={1.8} />)}
                  </div>
                  <p className={`mt-1 text-xs ${reviewMuted}`}>{reviewFeed.reviewCount} {reviewFeed.reviewCount === 1 ? "reseña publicada" : "reseñas publicadas"}</p>
                </div>
              </div>
              <form onSubmit={submitReview} className={`mt-7 space-y-4 rounded-2xl border p-4 shadow-sm sm:p-5 ${reviewSurface}`}>
                <h3 className={`text-sm font-semibold ${reviewText}`}>Deja tu opinión</h3>
                <fieldset>
                  <legend className={`text-xs font-medium ${reviewMuted}`}>Tu calificación</legend>
                  <div role="radiogroup" aria-label="Tu calificación" className="mt-2 flex gap-1">
                    {Array.from({ length: 5 }, (_, index) => {
                      const rating = index + 1;
                      return <button key={rating} type="button" role="radio" aria-checked={reviewRating === rating} aria-label={`${rating} ${rating === 1 ? "estrella" : "estrellas"}`} onClick={() => setReviewRating(rating)} className={`grid size-9 place-items-center focus-visible:outline-2 ${reviewStar}`}><Star aria-hidden="true" size={21} fill={rating <= reviewRating ? "currentColor" : "none"} strokeWidth={1.8} /></button>;
                    })}
                  </div>
                </fieldset>
                <label className={`block text-xs font-medium ${reviewMuted}`}>Nombre público (opcional)<input maxLength={60} value={reviewName} onChange={(event) => setReviewName(event.target.value)} placeholder="Cómo quieres aparecer" className={`mt-1.5 min-h-11 w-full rounded-xl border px-3 text-sm outline-none focus:ring-2 focus:ring-current/10 ${reviewInput}`} /></label>
                <label className={`block text-xs font-medium ${reviewMuted}`}>Comentario<textarea required minLength={10} maxLength={1200} rows={4} value={reviewComment} onChange={(event) => setReviewComment(event.target.value)} placeholder="¿Qué te pareció el producto?" className={`mt-1.5 w-full resize-y rounded-xl border px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-current/10 ${reviewInput}`} /></label>
                <p className={`text-[11px] leading-5 ${reviewMuted}`}>La reseña se publicará cuando la tienda la apruebe. No se muestra como compra verificada.</p>
                {reviewError && <p role="alert" className="bg-[var(--catalog-danger-surface,#fff1ec)] px-3 py-2 text-xs text-[var(--catalog-danger,#a5432a)]">{reviewError}</p>}
                {reviewNotice && <p role="status" className="bg-[var(--catalog-success-surface,#edf5ed)] px-3 py-2 text-xs text-[var(--catalog-success,#24594d)]">{reviewNotice}</p>}
                <button type="submit" disabled={reviewSubmitting} style={{ color: themeStyle?.["--catalog-on-primary"] ?? (isTech ? "#071421" : "#ffffff") }} className={`min-h-11 rounded-xl px-4 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60 ${action}`}>{reviewSubmitting ? "Enviando..." : "Enviar reseña"}</button>
              </form>
            </div>

            <div className={`divide-y rounded-2xl border px-5 ${isTech ? "divide-[var(--catalog-border-subtle,#26394a)] border-[var(--catalog-border-subtle,#26394a)]" : isBeauty ? "divide-[var(--catalog-border-subtle,#efd5dd)] border-[var(--catalog-border-subtle,#efd5dd)]" : "divide-[var(--catalog-border-subtle,#e5d9d0)] border-[var(--catalog-border-subtle,#e5d9d0)]"}`}>
              {reviewError && reviewFeed.reviewCount === 0 ? <p className="py-6 text-sm text-[var(--catalog-text-muted,#68756e)]">{reviewError}</p> : reviewFeed.reviews.length === 0 ? (
                <p className="py-6 text-sm text-[var(--catalog-text-muted,#68756e)]">Todavía no hay reseñas publicadas para este producto.</p>
              ) : reviewFeed.reviews.map((review) => (
                <article key={review.id} className="py-5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={`text-sm font-semibold ${reviewText}`}>{review.displayName || "Cliente"}</p>
                    <time dateTime={review.createdAt} className={`text-xs ${reviewMuted}`}>{new Date(review.createdAt).toLocaleDateString("es-CO", { dateStyle: "medium" })}</time>
                  </div>
                  <div aria-label={`${review.rating} de 5 estrellas`} className={`mt-2 flex ${reviewStar}`}>
                    {Array.from({ length: 5 }, (_, index) => <Star key={index} aria-hidden="true" size={14} fill={index < review.rating ? "currentColor" : "none"} strokeWidth={1.8} />)}
                  </div>
                  <p className={`mt-2 whitespace-pre-line text-sm leading-6 ${reviewMuted}`}>{review.comment}</p>
                </article>
              ))}
            </div>
          </div>
        </section>
      </div>
      <FloatingWhatsAppButton catalog={catalog} message={catalog.whatsappMessage?.trim() || `Hola, quisiera más información sobre ${product.name}.`} />
    </main>
  );
}
