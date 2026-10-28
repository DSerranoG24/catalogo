"use client";

import { useId, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { getDiscountPercent } from "@/lib/product-pricing";

export default function ProductSalePriceInput({ basePrice, salePrice, saving, onPriceChange }: {
  basePrice: string;
  salePrice: string;
  saving: boolean;
  onPriceChange: (price: string) => void;
}) {
  const [percent, setPercent] = useState("");
  const [feedback, setFeedback] = useState<{ text: string; error: boolean; base: string } | null>(null);
  const feedbackId = useId();
  const currentFeedback = feedback?.base === basePrice ? feedback : null;

  function applyPercent() {
    const percentage = Number(percent);
    const base = Number(basePrice);
    let error = "";
    if (!/^\d+$/.test(percent) || !Number.isInteger(percentage) || percentage < 1 || percentage > 99) {
      error = "Introduce un porcentaje entero entre 1 y 99.";
    } else if (!basePrice.trim() || !Number.isSafeInteger(base) || base <= 0 || !Number.isSafeInteger(base * (100 - percentage))) {
      error = "Introduce un precio base entero válido mayor que cero.";
    }
    if (error) { setFeedback({ text: error, error: true, base: basePrice }); return; }
    const calculated = Math.ceil(base * (100 - percentage) / 100);
    if (calculated >= base) {
      setFeedback({ text: "Con este precio base, ese porcentaje no produce un descuento real. Ajusta el porcentaje o el precio de oferta a mano.", error: true, base: basePrice });
      return;
    }
    onPriceChange(String(calculated));
    setFeedback({ text: `Se aplicará un precio de $${calculated.toLocaleString("es-CO")}. Eso equivale a un ${getDiscountPercent(base, calculated)}% de descuento.`, error: false, base: basePrice });
  }

  return <>
    <div data-sale-calculator className="space-y-2">
      <label className="block text-sm font-medium text-[#37443d]">Descuento (%) <span className="font-normal">(opcional)</span>
        <Input type="number" min="1" max="99" step="1" inputMode="numeric" value={percent} aria-invalid={currentFeedback?.error || undefined} aria-describedby={currentFeedback ? feedbackId : undefined}
          onChange={event => { setPercent(event.target.value); setFeedback(null); }} className="mt-2 w-full" />
      </label>
      <Button type="button" variant="secondary" disabled={saving} onClick={applyPercent}>Aplicar porcentaje</Button>
      {currentFeedback && <p id={feedbackId} role={currentFeedback.error ? "alert" : "status"} className={`text-xs leading-5 ${currentFeedback.error ? "text-[#a5432a]" : "text-[#37443d]"}`}>{currentFeedback.text}</p>}
    </div>
    <label className="block text-sm font-medium text-[#37443d]">Precio de oferta
      <Input required type="number" min="0" max={basePrice || undefined} step="1" value={salePrice}
        onChange={event => { setPercent(""); setFeedback(null); onPriceChange(event.target.value); }} placeholder="18000" className="mt-2 w-full" />
      <span className="mt-1.5 block text-xs font-normal text-[#7d6a66]">Debe ser menor al precio normal de ${Number(basePrice || 0).toLocaleString("es-CO")}.</span>
    </label>
  </>;
}
