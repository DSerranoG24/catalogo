// Published entries are immutable. Add a new entry when the displayed text changes.
export const CUSTOMER_CONSENT_VERSIONS = Object.freeze({
  "2026-10-27.v1": Object.freeze({
    date: "2026-10-27",
    text: "Autorizo guardar estos datos para gestionar este pedido. Después podré abrir WhatsApp y enviar al vendedor la lista, mi teléfono y mi dirección.",
  }),
});

export function isAcceptedConsentVersion(value: string): boolean {
  return Object.hasOwn(CUSTOMER_CONSENT_VERSIONS, value);
}
