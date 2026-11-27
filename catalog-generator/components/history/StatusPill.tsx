import { STATUS_LABELS, type DisplayStatus } from "@/lib/sales-ui.mjs";
import { VY_STATUS_TONES } from "@/lib/sale-detail-ui.mjs";

export default function StatusPill({ status }: { status: DisplayStatus }) {
  return <span data-sale-status={status} className={`inline-flex min-h-7 shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 text-xs font-semibold ${VY_STATUS_TONES[status]}`}>{STATUS_LABELS[status]}</span>;
}
