import type { Metadata } from "next";
import SessionStorageCleanup from "@/components/auth/SessionStorageCleanup";
import "./globals.css";

export const metadata: Metadata = {
  title: "Catalogo | Panel de catálogos",
  description: "Administra tus catálogos, categorías y productos.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <SessionStorageCleanup />
        {children}
      </body>
    </html>
  );
}
