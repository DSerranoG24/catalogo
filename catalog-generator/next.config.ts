import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Resolve public metadata (and missing resources) before streaming a successful response.
  htmlLimitedBots: /.*/,
  async headers() {
    const headers = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "X-Frame-Options", value: "DENY" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    ];

    if (process.env.NODE_ENV === "production") {
      headers.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" });
    }

    return [{ source: "/:path*", headers }, { source: "/admin/:path*", headers: [{ key: "Cache-Control", value: "private, no-store, max-age=0" }] }, ...["/verificar-correo", "/restablecer-contrasena", "/recuperar-contrasena"].map(source => ({
      source, headers: [{ key: "Referrer-Policy", value: "no-referrer" }, { key: "Cache-Control", value: "private, no-store, max-age=0" }],
    }))];
  },
};

export default nextConfig;
