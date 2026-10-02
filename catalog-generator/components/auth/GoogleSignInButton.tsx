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
      options: { theme: "outline"; size: "large"; width: number; text: "continue_with" }
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
}: {
  onCredential: (credential: string) => void;
}) {
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
      width: Math.min(container.current.clientWidth, 360),
      text: "continue_with",
    });
  }

  if (!clientId) {
    return (
      <div className="mt-5 rounded-md border border-dashed border-[#d6dfd7] px-4 py-3 text-center text-xs text-[#68756e]">
        Google Sign-In requiere configurar su Client ID.
      </div>
    );
  }

  return (
    <>
      <div ref={container} className="mt-5 flex min-h-10 justify-center" />
      <Script
        src="https://accounts.google.com/gsi/client"
        strategy="afterInteractive"
        onReady={initializeGoogle}
      />
    </>
  );
}