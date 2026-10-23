"use client";

import Image from "next/image";
import Link from "next/link";
import { FormEvent, startTransition, useEffect, useState } from "react";
import { Star } from "lucide-react";
import { useRouter } from "next/navigation";
import { publicApiRequest, PublicCatalog, PublicProduct, PublicProductReview, rememberPublicCatalogTemplate } from "@/lib/api";
import FloatingWhatsAppButton from "@/components/public/FloatingWhatsAppButton";
import PublicRouteLoading from "@/components/public/PublicRouteLoading";

type PublicReviewFeed = {
  averageRating: number | null;
  reviewCount: number;
  reviews: PublicProductReview[];
};

const emptyReviewFeed: PublicReviewFeed = { averageRating: null, reviewCount: 0, reviews: [] };

export default function PublicProductDetailPage({
  publicId,
  productSlug,
}: {
  publicId: string;
  productSlug: string;
}) {
  const router = useRouter();
  const [catalog, setCatalog] = useState<PublicCatalog | null>(null);
  const [product, setProduct] = useState<PublicProduct | null>(null);
  const [selectedImage, setSelectedImage] = useState(0);
  const [quantity, setQuantity] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
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
    let active = true;
    publicApiRequest<{ catalog: PublicCatalog }>(`/public/catalogs/${encodeURIComponent(publicId)}`)
      .then(({ catalog: loadedCatalog }) => {
        if (!active) return;
        setCatalog(loadedCatalog);
        rememberPublicCatalogTemplate(loadedCatalog.publicId, loadedCatalog.template);
        setProduct(loadedCatalog.products.find((item) => item.slug === productSlug) ?? null);
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "No se pudo cargar el producto.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [productSlug, publicId]);

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

  if (loading) {
    return <PublicRouteLoading kind="product" />;
  }

  if (!catalog || !product) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f3eb] px-5 text-center">
        <div className="max-w-md">
          <p className="text-xs font-semibold uppercase text-[#bd4d36]">Producto no disponible</p>
          <h1 className="mt-2 font-serif text-3xl text-[#263b31]">No encontramos esta pieza.</h1>
          <p className="mt-3 text-sm text-[#68756e]">{error || "Puede que el enlace haya cambiado o el producto ya no esté publicado."}</p>
          <Link href={`/c/${encodeURIComponent(publicId)}`} className="mt-6 inline-flex min-h-11 items-center bg-[#263b31] px-4 text-sm font-semibold text-white">Volver al catálogo</Link>
        </div>
      </main>
    );
  }

  const image = product.images[selectedImage];
  const isOnSale = product.regularPrice !== null && product.discountPercent !== null;
  const isTech = catalog.template === "TECH" || catalog.template === "GRID";
  const isBeauty = catalog.template === "BEAUTY" || catalog.template === "BOUTIQUE";
  const isFashion = catalog.template === "FASHION" || catalog.template === "EDITORIAL";
  const surface = isTech ? "bg-[#081421]" : isBeauty ? "bg-[#fff8f6]" : isFashion ? "bg-[#f7f2ec]" : "bg-[#f4f3eb]";
  const foreground = isTech ? "text-[#e5f2ff]" : isBeauty ? "text-[#552e48]" : "text-[#322c29]";
  const accent = isTech ? "text-[#56e0c0]" : isBeauty ? "text-[#b55271]" : isFashion ? "text-[#9a554b]" : "text-[#ad553b]";
  const action = isTech ? "bg-[#56e0c0] text-[#071421] hover:bg-[#8af3d8]" : isBeauty ? "bg-[#b55271] hover:bg-[#98425f]" : isFashion ? "bg-[#322c29] hover:bg-[#4c3f39]" : "bg-[#263b31] hover:bg-[#192b22]";
  const reviewSurface = isTech ? "border-[#26394a] bg-[#0e1d2b]" : isBeauty ? "border-[#efd5dd] bg-white" : "border-[#e5d9d0] bg-[#fffaf6]";
  const reviewText = isTech ? "text-[#e5f2ff]" : isBeauty ? "text-[#552e48]" : "text-[#322c29]";
  const reviewMuted = isTech ? "text-[#a9bccd]" : isBeauty ? "text-[#896879]" : "text-[#766b64]";
  const reviewInput = isTech ? "border-[#26394a] bg-[#091725] text-[#e5f2ff] placeholder:text-[#7f94a8] focus:border-[#56e0c0]" : isBeauty ? "border-[#efd5dd] bg-[#fffaf9] text-[#552e48] placeholder:text-[#b495a4] focus:border-[#b55271]" : "border-[#dfd2c5] bg-white text-[#322c29] placeholder:text-[#a89a90] focus:border-[#9a554b]";
  const reviewStar = isTech ? "text-[#56e0c0] focus-visible:outline-[#56e0c0]" : isBeauty ? "text-[#b55271] focus-visible:outline-[#b55271]" : "text-[#c28a35] focus-visible:outline-[#c28a35]";

  return (
    <main className={`min-h-screen ${surface} ${foreground}`}>
      <div className="mx-auto max-w-7xl px-5 pb-16 pt-6 sm:px-8 sm:pt-9">
        <Link href={`/c/${encodeURIComponent(publicId)}#productos`} className={`inline-flex min-h-10 items-center gap-2 text-sm font-semibold transition ${isTech ? "text-[#a9bccd] hover:text-[#56e0c0]" : "text-[#41574b] hover:text-[#bd4d36]"}`}>
          <span aria-hidden="true">←</span> Volver a {catalog.name}
        </Link>
        <div className={`mt-5 border-y py-2.5 text-[10px] font-semibold uppercase ${isTech ? "border-[#26394a] text-[#a9bccd]" : "border-[#e5d9d0] text-[#766b64]"}`}>
          <span className="inline-flex items-center gap-2">{catalog.logoUrl && <img src={catalog.logoUrl} alt="" className="size-8 rounded-full bg-white object-contain" />}<span>{catalog.name}</span></span><span className="px-2 text-[#bd4d36]">/</span><span>{product.category?.name || "Producto"}</span>
        </div>

        <section className="grid gap-8 pb-8 pt-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)] lg:gap-14 lg:pt-10">
          <div className="min-w-0">
            <div className={`relative aspect-[4/3] overflow-hidden border border-black/5 ${isTech ? "bg-[#182c3c]" : isBeauty ? "bg-[#f5dfe6]" : isFashion ? "bg-[#e9ddd2]" : "bg-[#e8e9dc]"}`}>
              {image ? (
                <Image src={image.url} alt={image.alt || product.name} fill unoptimized sizes="(max-width: 1024px) 100vw, 60vw" className="object-cover" priority />
              ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-[linear-gradient(135deg,transparent_49.5%,rgba(37,72,58,0.08)_50%,transparent_50.5%),linear-gradient(45deg,transparent_49.5%,rgba(37,72,58,0.06)_50%,transparent_50.5%)] bg-[length:44px_44px] px-8 text-center">
                  <span className="max-w-2xl text-balance font-serif text-4xl leading-tight text-[#405549] sm:text-6xl">{product.name}</span>
                  <span className="text-[10px] font-semibold uppercase text-[#617568]">Fotografía por añadir</span>
                </div>
              )}
              <span className="absolute bottom-3 left-3 bg-white/90 px-3 py-2 text-xs font-semibold text-[#263b31] backdrop-blur-sm">{product.category?.name || "Selección"}</span>
            </div>
            {product.images.length > 1 && (
              <div className="mt-3 flex gap-2 overflow-x-auto">
                {product.images.map((item, index) => (
                  <button key={item.id} type="button" onClick={() => setSelectedImage(index)} aria-label={`Ver fotografía ${index + 1}`} aria-pressed={selectedImage === index} className={`relative size-16 shrink-0 overflow-hidden border-2 ${selectedImage === index ? "border-[#bd4d36]" : "border-transparent"}`}>
                    <Image src={item.url} alt={item.alt || `${product.name}, foto ${index + 1}`} fill unoptimized sizes="64px" className="object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="flex min-w-0 flex-col py-1 lg:py-5">
            <p className={`text-xs font-semibold uppercase ${accent}`}>{product.brand || catalog.name}</p>
            <h1 className={`mt-3 text-balance font-serif text-4xl leading-[1.08] sm:text-5xl ${isTech ? "font-sans font-semibold tracking-tight text-white" : "text-[#322c29]"}`}>{product.name}</h1>
            {product.model && <p className={`mt-3 text-sm ${isTech ? "text-[#a9bccd]" : "text-[#68756e]"}`}>Modelo {product.model}</p>}
            <div className="mt-6 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <p className={`text-2xl font-bold tabular-nums ${isOnSale ? "text-[#c62828]" : isTech ? "text-white" : "text-[#202b27]"}`}>${product.price.toLocaleString("es-CO")}</p>
              {isOnSale && <>
                <p className="text-base tabular-nums text-[#737d77] line-through">${product.regularPrice!.toLocaleString("es-CO")}</p>
                <span className="bg-[#c62828] px-2 py-1 text-xs font-bold tabular-nums text-white">-{product.discountPercent}%</span>
              </>}
            </div>
            {isOnSale && product.saleEndsAt && <p className="mt-2 text-xs font-semibold text-[#b42318]">Oferta válida hasta {new Date(product.saleEndsAt).toLocaleString("es-CO", { dateStyle: "medium", timeStyle: "short" })}</p>}
            <div className={`my-6 border-y py-5 ${isTech ? "border-[#26394a]" : "border-[#e5d9d0]"}`}>
              <h2 className={`text-xs font-semibold uppercase ${accent}`}>Detalles</h2>
              <p className={`mt-3 whitespace-pre-line text-sm leading-7 ${isTech ? "text-[#a9bccd]" : "text-[#756b64]"}`}>{product.description || "Consulta con la tienda para conocer más detalles de este producto."}</p>
            </div>
            <div className="mt-auto space-y-3">
              <button type="button" onClick={addToOrder} className={`flex min-h-12 w-full items-center justify-center gap-2 px-5 text-sm font-semibold text-white transition ${action}`}>
                {added ? "Añadir otra unidad" : "Añadir al pedido"}<span aria-hidden="true">+</span>
              </button>
              <Link href={quantity > 0 ? `/c/${encodeURIComponent(publicId)}/carrito` : `/c/${encodeURIComponent(publicId)}`} className="flex min-h-11 items-center justify-center border border-[#aebbb0] px-5 text-sm font-semibold text-[#31483b] transition hover:bg-white/70">
                {quantity > 0 ? `Ver carrito · ${quantity} ${quantity === 1 ? "unidad" : "unidades"}` : "Seguir explorando"}
              </Link>
            </div>
          </div>
        </section>

        <section aria-labelledby="reviews-heading" className={`border-t py-8 sm:py-12 ${isTech ? "border-[#26394a]" : isBeauty ? "border-[#efd5dd]" : "border-[#e5d9d0]"}`}>
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
                {reviewError && <p role="alert" className="bg-[#fff1ec] px-3 py-2 text-xs text-[#a5432a]">{reviewError}</p>}
                {reviewNotice && <p role="status" className="bg-[#edf5ed] px-3 py-2 text-xs text-[#24594d]">{reviewNotice}</p>}
                <button type="submit" disabled={reviewSubmitting} className={`min-h-11 rounded-xl px-4 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-60 ${action}`}>{reviewSubmitting ? "Enviando..." : "Enviar reseña"}</button>
              </form>
            </div>

            <div className={`divide-y rounded-2xl border px-5 ${isTech ? "divide-[#26394a] border-[#26394a]" : isBeauty ? "divide-[#efd5dd] border-[#efd5dd]" : "divide-[#e5d9d0] border-[#e5d9d0]"}`}>
              {reviewError && reviewFeed.reviewCount === 0 ? <p className="py-6 text-sm text-[#68756e]">{reviewError}</p> : reviewFeed.reviews.length === 0 ? (
                <p className="py-6 text-sm text-[#68756e]">Todavía no hay reseñas publicadas para este producto.</p>
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
