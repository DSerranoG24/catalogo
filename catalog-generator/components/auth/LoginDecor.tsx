// Decorative pieces of /login. All are aria-hidden, static (no animation) and carry no information.

/** Blue waves at the bottom of the brand panel (desktop) or of the mobile header. */
export function LoginWaves({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 600 220" preserveAspectRatio="none" className={`pointer-events-none absolute inset-x-0 bottom-0 w-full ${className}`}>
      <defs>
        <linearGradient id="login-wave-a" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#0760ED" stopOpacity="0.85" />
          <stop offset="1" stopColor="#178DFF" stopOpacity="0.35" />
        </linearGradient>
        <linearGradient id="login-wave-b" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#0450E5" stopOpacity="0.55" />
          <stop offset="1" stopColor="#0450E5" stopOpacity="0.9" />
        </linearGradient>
      </defs>
      <path fill="url(#login-wave-a)" d="M0 70C110 40 190 120 300 112S480 40 600 52V220H0z" />
      <path fill="url(#login-wave-b)" d="M0 128C120 92 230 168 350 150S520 96 600 104V220H0z" />
      <path fill="#011C4F" fillOpacity="0.55" d="M0 176C140 150 260 206 400 190S560 160 600 166V220H0z" />
    </svg>
  );
}

/** Curved stroke under «en orden.». */
export function SloganUnderline({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden="true" focusable="false" viewBox="0 0 320 24" preserveAspectRatio="none" className={`pointer-events-none block ${className}`}>
      <defs>
        <linearGradient id="login-underline" x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#0760ED" />
          <stop offset="0.6" stopColor="#178DFF" />
          <stop offset="1" stopColor="#178DFF" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M6 18C90 4 210 2 314 14" fill="none" stroke="url(#login-underline)" strokeWidth="6" strokeLinecap="round" />
    </svg>
  );
}
