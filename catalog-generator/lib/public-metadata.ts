import type { Metadata } from "next";
export const SITE_URL = "https://catalogo-pink.vercel.app";
export function publicMetadata(publicId: string, title: string, description: string, productSlug?: string): Metadata {
  const path = `/c/${encodeURIComponent(publicId)}`;
  const canonical = `${SITE_URL}${path}${productSlug ? `/producto/${encodeURIComponent(productSlug)}` : ""}`;
  const image = `${SITE_URL}${path}/og${productSlug ? `?product=${encodeURIComponent(productSlug)}` : ""}`;
  return {
    title, description, alternates: { canonical }, robots: { index: true, follow: true },
    openGraph: { title, description, url: canonical, type: "website", locale: "es_CO", images: [{ url: image, alt: title }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}
