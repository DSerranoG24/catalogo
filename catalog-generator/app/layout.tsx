import type { Metadata } from "next";
import localFont from "next/font/local";
import SessionStorageCleanup from "@/components/auth/SessionStorageCleanup";
import "./globals.css";

const inter = localFont({ src: "./fonts/InterVariable.woff2", weight: "100 900", style: "normal", display: "swap", variable: "--font-app-sans" });

export const metadata: Metadata = {
  metadataBase: new URL("https://catalogo-pink.vercel.app"),
  robots: { index: false, follow: false },
  title: "Vitrinaya | Panel de catálogos",
  description: "Administra tus catálogos, categorías y productos.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className={`${inter.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <SessionStorageCleanup />
        {children}
      </body>
    </html>
  );
}
