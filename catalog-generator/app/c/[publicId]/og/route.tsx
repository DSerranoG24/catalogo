import { ImageResponse } from "next/og";
import { readPublicCatalog } from "@/lib/public-catalog.server";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
const MAX_BYTES = 5 * 1024 * 1024;

function allowedImageUrl(value: string): URL {
  const url = new URL(value);
  if (url.protocol !== "https:" || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname)
    || url.port || url.username || url.password
    || !url.pathname.startsWith("/storage/v1/object/sign/product-images/")) throw new Error("Invalid image source");
  return url;
}
function imageMime(bytes: Uint8Array): string | null {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if ([137,80,78,71,13,10,26,10].every((v,i) => bytes[i] === v)) return "image/png";
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.slice(start,end));
  if (ascii(0,4) === "RIFF" && ascii(8,12) === "WEBP") return "image/webp";
  if (["GIF87a", "GIF89a"].includes(ascii(0,6))) return "image/gif";
  return null;
}
async function downloadImage(source: string) {
  const url = allowedImageUrl(source);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(url, { signal: controller.signal, cache: "no-store", redirect: "error", credentials: "omit" });
    if (!response.ok || !response.body) throw new Error("Image unavailable");
    if (Number(response.headers.get("content-length")) > MAX_BYTES) { await response.body.cancel(); throw new Error("Image too large"); }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_BYTES) throw new Error("Image too large");
        chunks.push(value);
      }
    } finally { await reader.cancel(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const mime = imageMime(bytes);
    if (!mime) throw new Error("Unsupported image");
    return new Response(bytes, { headers: { ...headers, "Content-Type": mime } });
  } finally { clearTimeout(timer); }
}
export async function GET(request: Request, { params }: { params: Promise<{ publicId: string }> }) {
  try {
    const { publicId } = await params;
    const catalog = await readPublicCatalog(publicId);
    if (!catalog) return new Response(null, { status: 404, headers });
    const slug = new URL(request.url).searchParams.get("product");
    const product = slug === null ? null : catalog.products.find(p => p.slug === slug);
    if (slug !== null && !product) return new Response(null, { status: 404, headers });
    const source = product ? product.images[0]?.url ?? catalog.logoUrl : catalog.logoUrl;
    if (source) {
      try { return await downloadImage(source); }
      catch { /* A broken logo must not prevent a generated sharing card. */ }
    }
    const generated = new ImageResponse(
      <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", width: "100%", height: "100%", padding: 72, background: "#173f36", color: "white" }}>
        <div style={{ display: "flex", fontSize: 28 }}>CATÁLOGO · {catalog.name.slice(0,100)}</div>
        <div style={{ fontSize: 64, marginTop: 30 }}>{(product?.name ?? catalog.name).slice(0,100)}</div>
        <div style={{ fontSize: 28, marginTop: 30 }}>{(product?.description || catalog.description || "Descubre nuestros productos").slice(0,180)}</div>
      </div>, { width: 1200, height: 630, headers });
    return new Response(await generated.arrayBuffer(), { headers: { ...headers, "Content-Type": "image/png" } });
  } catch {
    return new Response(null, { status: 503, headers: { ...headers, "Retry-After": "30" } });
  }
}
