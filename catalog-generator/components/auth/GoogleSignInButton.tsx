"use client";

import Script from "next/script";
import { useRef } from "react";

type GoogleCredential = { credential: string };
type GoogleAccounts = {
  id: {
    initialize: (options: {
      client_id: string;
      callback: (credential: GoogleCredential) => void;
    }) => void;
    renderButton: (
      element: HTMLElement,
      options: { theme: "outline"; size: "large"; width: number; text: "continue_with"; shape?: "rectangular" | "pill"; logo_alignment?: "left" | "center" }
    ) => void;
  };
};

declare global {
  interface Window {
    google?: { accounts: GoogleAccounts };
  }
}

export default function GoogleSignInButton({
  onCredential,
  variant = "default",
}: {
  onCredential: (credential: string) => void;
  /** "login": full-width button with centered logo, spacing controlled by the page. */
  variant?: "default" | "login";
}) {
  const login = variant === "login";
  const container = useRef<HTMLDivElement>(null);
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

  function initializeGoogle() {
    if (!clientId || !container.current || !window.google) return;
    window.google.accounts.id.initialize({
      client_id: clientId,
      callback: ({ credential }) => onCredential(credential),
    });
    container.current.replaceChildren();
    window.google.accounts.id.renderButton(container.current, {
      theme: "outline",
      size: "large",
      width: Math.min(container.current.clientWidth, login ? 400 : 360),
      text: "continue_with",
      ...(login ? { shape: "pill" as const, logo_alignment: "center" as const } : {}),
    });
  }

  if (!clientId) {
    return (
      <div data-google-signin="unconfigured" className={login ? "flex min-h-[52px] items-center justify-center rounded-2xl border border-dashed border-[var(--vy-field-border)] bg-white px-4 py-3 text-center text-sm leading-5 text-[var(--vy-text-muted)]" : "mt-5 rounded-xl border border-dashed border-[#d6dfd7] bg-[#fafbf9] px-4 py-4 text-center text-xs leading-5 text-[#68756e]"}>
        Google Sign-In requiere configurar su Client ID.
      </div>
    );
  }

  return (
    <>
      <div ref={container} data-google-signin="button" className={`${login ? "" : "mt-5 "}flex min-h-10 w-full min-w-0 justify-center`} />
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onReady={initializeGoogle}
      />
    </>
  );
}
