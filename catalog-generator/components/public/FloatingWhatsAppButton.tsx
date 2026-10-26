import { PublicCatalog } from "@/lib/api";

export default function FloatingWhatsAppButton({
  catalog,
  message,
}: {
  catalog: PublicCatalog;
  message?: string;
}) {
  if (!catalog.whatsappPhone) return null;

  const initialMessage = message?.trim()
    || catalog.whatsappMessage?.trim()
    || `Hola, quisiera más información sobre ${catalog.name}.`;
  const href = `https://wa.me/${catalog.whatsappPhone.replace(/\D/g, "")}?text=${encodeURIComponent(initialMessage)}`;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Pedir más información por WhatsApp"
      className="fixed bottom-5 right-5 z-50 inline-flex min-h-14 items-center gap-2.5 rounded-full bg-[#12813f] px-4 text-sm font-semibold text-white shadow-[0_8px_24px_rgba(16,75,48,0.28)] transition hover:-translate-y-0.5 hover:bg-[#0f7037] focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#128c4a] sm:bottom-7 sm:right-7"
    >
      <svg viewBox="0 0 32 32" className="size-7 shrink-0" aria-hidden="true" fill="currentColor">
        <path d="M16.02 3a12.9 12.9 0 0 0-11.1 19.47L3.2 29l6.69-1.75A12.9 12.9 0 1 0 16.02 3Zm0 23.45c-1.98 0-3.92-.53-5.62-1.53l-.4-.24-3.97 1.04 1.06-3.87-.26-.42a10.5 10.5 0 1 1 9.2 5.02Zm5.76-7.87c-.32-.16-1.89-.93-2.18-1.04-.3-.11-.51-.16-.73.16-.22.33-.84 1.04-1.03 1.26-.19.22-.38.25-.7.08-.33-.16-1.37-.5-2.61-1.6-.97-.86-1.62-1.92-1.81-2.25-.19-.33-.02-.5.14-.66.15-.15.33-.38.49-.57.16-.19.22-.33.33-.54.11-.22.05-.41-.03-.57-.08-.17-.73-1.75-1-2.4-.26-.63-.53-.54-.73-.55h-.62c-.22 0-.57.08-.87.41-.3.33-1.14 1.1-1.14 2.68 0 1.58 1.17 3.1 1.33 3.31.16.22 2.3 3.51 5.57 4.92.78.34 1.39.54 1.86.69.78.25 1.49.22 2.05.13.63-.1 1.89-.77 2.16-1.51.27-.74.27-1.37.19-1.5-.08-.14-.3-.22-.62-.38Z" />
      </svg>
      <span>WhatsApp</span>
    </a>
  );
}
