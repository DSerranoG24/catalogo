import { saleBuyer } from "@/lib/sale-buyer.mjs";

type CustomerSale = Parameters<typeof saleBuyer>[0] & { customer?: { fullName: string; archivedAt: string | null } | null };
export default function SaleCustomerSummary({ sale }: { sale: CustomerSale }) {
  const buyer = saleBuyer(sale);
  return <div className="space-y-1">
    <p>Comprador registrado: {buyer.name ?? "Sin cliente identificado"}</p>
    {buyer.phone && <p>Teléfono registrado: {buyer.phone}</p>}
    {buyer.email && <p>Correo registrado: {buyer.email}</p>}
    {sale.customer && <p>Ficha actual: {sale.customer.fullName}{sale.customer.archivedAt ? " (archivado)" : ""}</p>}
  </div>;
}
