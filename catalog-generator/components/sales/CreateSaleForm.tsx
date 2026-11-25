"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { parseSale } from "@/lib/sales-ui.mjs";
import CustomerPicker, { type PickedCustomer } from "./CustomerPicker";
import { useSaleCommand } from "./useSaleCommand";
import FailureNotice from "./FailureNotice";

export default function CreateSaleForm({ onCreated }: { onCreated: (saleId: string) => void }) {
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [message, setMessage] = useState("");
  const command = useSaleCommand();

  function create() {
    setMessage("");
    void command.run({ action: "create", saleId: "new", path: "/sales", method: "POST", body: customer ? { customerId: customer.id } : {}, withRequestId: true, label: "Creando borrador…" }, reply => {
      const sale = parseSale((reply as { result?: unknown } | null)?.result);
      setCustomer(null); setMessage("Borrador creado. Añade los artículos y guárdalo.");
      onCreated(sale.id);
    });
  }
  return <section aria-labelledby="new-sale-heading" className="space-y-4 rounded-2xl border border-[#dce4dc] bg-white p-5">
    <div><h2 id="new-sale-heading" className="text-xl font-semibold">Nueva venta</h2>
      <p className="mt-1 text-sm text-[#52675b]">Crea un borrador; no descuenta existencias hasta confirmarlo.</p></div>
    <CustomerPicker idPrefix="new-sale" value={customer} onChange={setCustomer} disabled={Boolean(command.busy)} />
    <Button loading={command.busy !== null} disabled={command.busy !== null} onClick={create}>Crear borrador de venta</Button>
    {message && <p role="status" className="text-sm">{message}</p>}
    {command.failure && <FailureNotice failure={command.failure} busy={command.busy !== null} onRetry={() => void command.retry()} onReload={command.clearFailure} />}
  </section>;
}
