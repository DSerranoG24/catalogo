"use client";

import { startTransition, useEffect, useState } from "react";
import { Check, Star, Trash2, X } from "lucide-react";
import { apiRequest, ProductReview } from "@/lib/api";

type ReviewFilter = ProductReview["status"];

const filters: { id: ReviewFilter; label: string }[] = [
  { id: "PENDING", label: "Pendientes" },
  { id: "APPROVED", label: "Publicadas" },
  { id: "REJECTED", label: "Rechazadas" },
];

export default function ReviewModerationPanel({ catalogId }: { catalogId: string }) {
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
    if (!window.confirm(`¿Eliminar definitivamente la reseña de ${review.product.name}?`)) return;
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
    <section className="mx-auto w-full max-w-4xl">
      <header className="border-b border-[#dce4dc] pb-4">
        <p className="text-xs font-semibold uppercase text-[#c65c3d]">Opiniones de clientes</p>
        <h2 className="mt-1 text-xl font-semibold text-[#202b27]">Reseñas</h2>
        <p className="mt-1 text-sm text-[#68756e]">Revisa las reseñas antes de publicarlas en tu catálogo.</p>
      </header>

      <nav aria-label="Filtrar reseñas" className="mt-5 flex gap-2 overflow-x-auto border-b border-[#dce4dc]">
        {filters.map((item) => <button key={item.id} type="button" aria-pressed={filter === item.id} onClick={() => setFilter(item.id)} className={`min-h-11 shrink-0 border-b-2 px-3 text-sm font-semibold transition ${filter === item.id ? "border-[#17665c] text-[#17665c]" : "border-transparent text-[#68756e] hover:text-[#202b27]"}`}>{item.label}</button>)}
      </nav>

      {error && <p role="alert" className="mt-4 border border-[#f0c8b9] bg-[#fff4ef] px-4 py-3 text-sm text-[#a5432a]">{error}</p>}
      {notice && <p role="status" className="mt-4 border border-[#c8ddca] bg-[#eff6ee] px-4 py-3 text-sm text-[#24594d]">{notice}</p>}
      {loading ? <p className="py-10 text-sm text-[#68756e]">Cargando reseñas...</p> : reviews.length === 0 ? (
        <div className="border-b border-[#dce4dc] py-12 text-center">
          <h3 className="font-semibold text-[#202b27]">No hay reseñas {filter === "PENDING" ? "pendientes" : filter === "APPROVED" ? "publicadas" : "rechazadas"}</h3>
          <p className="mt-1 text-sm text-[#68756e]">Las nuevas opiniones aparecerán aquí para revisión.</p>
        </div>
      ) : (
        <ul className="divide-y divide-[#dce4dc]">
          {reviews.map((review) => (
            <li key={review.id} className="py-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase text-[#68756e]">{review.product.name}</p>
                  <p className="mt-1 text-sm font-semibold text-[#202b27]">{review.displayName || "Cliente"}</p>
                  <time dateTime={review.createdAt} className="mt-1 block text-xs text-[#849087]">{new Date(review.createdAt).toLocaleDateString("es-CO", { dateStyle: "medium" })}</time>
                </div>
                <div aria-label={`${review.rating} de 5 estrellas`} className="flex text-[#c62828]">{Array.from({ length: 5 }, (_, index) => <Star key={index} aria-hidden="true" size={16} fill={index < review.rating ? "currentColor" : "none"} />)}</div>
              </div>
              <p className="mt-3 whitespace-pre-line text-sm leading-6 text-[#526157]">{review.comment}</p>
              <div className="mt-4 flex flex-wrap gap-2">
                {review.status !== "APPROVED" && <button type="button" disabled={busyId === review.id} onClick={() => void setReviewStatus(review, "APPROVED")} className="inline-flex min-h-9 items-center gap-2 bg-[#17665c] px-3 text-xs font-semibold text-white disabled:opacity-50"><Check aria-hidden="true" size={15} /> Aprobar</button>}
                {review.status !== "REJECTED" && <button type="button" disabled={busyId === review.id} onClick={() => void setReviewStatus(review, "REJECTED")} className="inline-flex min-h-9 items-center gap-2 border border-[#d7c4bf] px-3 text-xs font-semibold text-[#9f2828] disabled:opacity-50"><X aria-hidden="true" size={15} /> Rechazar</button>}
                <button type="button" disabled={busyId === review.id} onClick={() => void deleteReview(review)} aria-label={`Eliminar reseña de ${review.product.name}`} className="grid size-9 place-items-center text-[#68756e] hover:bg-[#fff1ec] hover:text-[#a5432a] disabled:opacity-50"><Trash2 aria-hidden="true" size={16} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}