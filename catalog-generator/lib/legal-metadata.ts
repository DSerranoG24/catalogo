import type { Metadata } from "next";
import { SITE_URL } from "./public-metadata";

export function legalMetadata(path: string, title: string, description: string): Metadata {
  return { title: `${title} | Vitrinaya`, description, robots: { index: true, follow: true }, alternates: { canonical: new URL(path, SITE_URL).href } };
}
