"use client";

import { Button } from "@/components/ui/Button";

import { startTransition, useEffect, useState } from "react";
import { DestructiveConfirm } from "@/components/ui/Dialog";
import { Check, Star, Trash2, X } from "lucide-react";
import { apiRequest, ProductReview } from "@/lib/api";

type ReviewFilter = ProductReview["status"];

const filters: { id: ReviewFilter; label: string }[] = [
  { id: "PENDING", label: "Pendientes" },
  { id: "APPROVED", label: "Publicadas" },
  { id: "REJECTED", label: "Rechazadas" },
];

export default function ReviewModerationPanel({ catalogId }: { catalogId: string }) {
  const [pendingDelete, setPendingDelete] = useState<ProductReview | null>(null);
  const [filter, setFilter] = useState<ReviewFilter>("PENDING");
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let active = true;
    startTransition(() => {
      setLoading(true);
      setError("");
    });
    apiRequest<{ reviews: ProductReview[] }>(`/reviews/catalog/${catalogId}?status=${filter}`)
      .then(({ reviews: loadedReviews }) => {
        if (active) setReviews(loadedReviews);
      })
      .catch((requestError) => {
        if (active) setError(requestError instanceof Error ? requestError.message : "No se pudieron cargar las reseñas.");
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [catalogId, filter]);

  async function setReviewStatus(review: ProductReview, status: "APPROVED" | "REJECTED") {
    setBusyId(review.id);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/reviews/${review.id}`, { method: "PATCH", body: JSON.stringify({ status }) });
      setReviews((current) => current.filter((item) => item.id !== review.id));
      setNotice(status === "APPROVED" ? "Reseña publicada." : "Reseña rechazada.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo actualizar la reseña.");
    } finally {
      setBusyId("");
    }
  }

  async function deleteReview(review: ProductReview) {
    setBusyId(review.id);
    setError("");
    setNotice("");
    try {
      await apiRequest(`/reviews/${review.id}`, { method: "DELETE" });
      setReviews((current) => current.filter((item) => item.id !== review.id));
      setNotice("Reseña eliminada.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo eliminar la reseña.");
    } finally {
      setBusyId("");
    }
  }

  return (
    <section className="mx-auto w-full max-w-5xl">
      <header className="rounded-3xl border border-[#e2e8e0] bg-white p-5 shadow-[0_16px_44px_-38px_rgba(36,63,47,0.35)] sm:p-6">
        <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[var(--brand-coral-text)]">Opiniones de clientes</p>
        <h2 className="mt-1 text-xl font-semibold tracking-tight text-[#202b27]">Reseñas</h2>
        <p className="mt-1 text-sm text-[#68756e]">Revisa las reseñas antes de publicarlas en tu catálogo.</p>
      </header>

      <nav aria-label="Filtrar reseñas" className="mt-4 flex gap-1 overflow-x-auto rounded-2xl border border-[#e2e8e0] bg-white/75 p-1.5">
        {filters.map((item) => <Button variant="tab" selected={filter === item.id} key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className="shrink-0">{item.label}</Button>)}
      </nav>

      {error && <p role="alert" className="mt-4 border border-[#f0c8b9] bg-[#fff4ef] px-4 py-3 text-sm text-[#a5432a]">{error}</p>}
      {notice && <p role="status" className="mt-4 border border-[#c8ddca] bg-[#eff6ee] px-4 py-3 text-sm text-[#24594d]">{notice}</p>}
      {loading ? <ul aria-label="Cargando reseñas" className="mt-4 space-y-3 animate-pulse">{[0, 1, 2].map((item) => <li key={item} className="rounded-2xl border border-[#e2e8e0] bg-white p-5"><div className="h-3 w-28 rounded-full bg-[#e8eee5]" /><div className="mt-3 h-4 w-40 rounded-full bg-[#edf1ec]" /><div className="mt-4 h-3 w-full rounded-full bg-[#f0f3ee]" /><div className="mt-2 h-3 w-3/4 rounded-full bg-[#f0f3ee]" /></li>)}</ul> : reviews.length === 0 ? (
        <div className="mt-4 rounded-3xl border border-dashed border-[#d2ded2] bg-white/70 py-14 text-center">
          <h3 className="font-semibold text-[#202b27]">No hay reseñas {filter === "PENDING" ? "pendientes" : filter === "APPROVED" ? "publicadas" : "rechazadas"}</h3>
          <p className="mt-1 text-sm text-[#68756e]">Las nuevas opiniones aparecerán aquí para revisión.</p>
        </div>
      ) : (
        <ul className="mt-4 space-y-3">
          {reviews.map((review) => (
            <li key={review.id} className="rounded-2xl border border-[#e2e8e0] bg-white p-5 shadow-[0_14px_36px_-34px_rgba(36,63,47,0.5)] sm:p-6">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase text-[#68756e]">{review.product.name}</p>
                  <p className="mt-1 text-sm font-semibold text-[#202b27]">{review.displayName || "Cliente"}</p>
                  <time dateTime={review.createdAt} className="mt-1 block text-xs text-[#849087]">{new Date(review.createdAt).toLocaleDateString("es-CO", { dateStyle: "medium" })}</time>
                </div>
                <div aria-label={`${review.rating} de 5 estrellas`} className="flex rounded-full bg-[#fff8e8] px-2.5 py-1.5 text-[#c28a35]">{Array.from({ length: 5 }, (_, index) => <Star key={index} aria-hidden="true" size={14} fill={index < review.rating ? "currentColor" : "none"} />)}</div>
              </div>
              <p className="mt-3 whitespace-pre-line text-sm leading-6 text-[#526157]">{review.comment}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {review.status !== "APPROVED" && <Button variant="primary" type="button" disabled={busyId === review.id} onClick={() => void setReviewStatus(review, "APPROVED")} ><Check aria-hidden="true" size={15} /> Aprobar</Button>}
                {review.status !== "REJECTED" && <Button variant="destructive-ghost" type="button" disabled={busyId === review.id} onClick={() => void setReviewStatus(review, "REJECTED")} ><X aria-hidden="true" size={15} /> Rechazar</Button>}
                <Button variant="destructive-ghost" size="sm" iconOnly type="button" disabled={busyId === review.id} onClick={() => setPendingDelete(review)} aria-label={`Eliminar reseña de ${review.product.name}`} ><Trash2 aria-hidden="true" size={16} /></Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <DestructiveConfirm open={pendingDelete !== null} onOpenChange={open => { if (!open) setPendingDelete(null); }} title="Eliminar reseña"
        description={`¿Eliminar definitivamente la reseña de ${pendingDelete?.product.name ?? ""}?`}
        onConfirm={() => { if (pendingDelete) void deleteReview(pendingDelete); }} />
    </section>
  );
}
