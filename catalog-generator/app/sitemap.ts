import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/public-metadata";

export default function sitemap(): MetadataRoute.Sitemap {
  return [{ url: new URL("/", SITE_URL).href }];
}
