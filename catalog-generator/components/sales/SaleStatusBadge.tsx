import { STATUS_LABELS, STATUS_TONES, type DisplayStatus } from "@/lib/sales-ui.mjs";

export default function SaleStatusBadge({ status }: { status: DisplayStatus }) {
  return <span data-sale-status={status} className={`inline-flex min-h-7 items-center whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold ${STATUS_TONES[status]}`}>{STATUS_LABELS[status]}</span>;
}
