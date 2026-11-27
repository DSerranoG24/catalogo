export type ClosurePreview = { unresolvedOrders: number; undeliveredSales: number; pendingOrderBalance: string; balanceDue: string;
  customerCredit: { total: string; customers: number }; refundDue: { total: string; sales: number }; requiresConfirmation: boolean };
export function parseClosurePreview(value: unknown): ClosurePreview;
export function closureNoticeRows(preview: ClosurePreview, format: (value: string) => string): { key: string; label: string; value: string }[];
