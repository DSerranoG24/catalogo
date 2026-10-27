import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/public-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["/", "/contacto", "/privacidad", "/terminos"].map(path => ({ url: new URL(path, SITE_URL).href }));
}
