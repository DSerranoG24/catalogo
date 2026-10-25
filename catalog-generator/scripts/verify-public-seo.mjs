import assert from "node:assert/strict";
import http from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const counts = new Map();
const catalog = {
  publicId: "demo", name: "Tienda de prueba SEO", slug: "demo", description: "Productos locales de prueba",
  logoUrl: null, whatsappPhone: null, whatsappMessage: null, phone: null, address: null,
  businessHours: null, instagramUrl: null, facebookUrl: null, tiktokUrl: null, email: null, mapUrl: null,
  template: "TECH", categories: [], products: [{ id: "p1", name: "Producto de prueba", slug: "producto",
    description: "Descripción de producto", brand: null, model: null, categoryId: null, category: null,
    price: 1000, regularPrice: null, discountPercent: null, saleEndsAt: null, images: [] }],
};
const api = http.createServer((req, res) => {
  if (req.url === "/private-image") { counts.set("forbidden-download", 1); res.writeHead(500); return res.end(); }
  const id = decodeURIComponent(req.url.split("/").pop());
  counts.set(id, (counts.get(id) || 0) + 1);
  res.setHeader("Content-Type", "application/json");
  if (["missing", "archived", "inactive"].includes(id)) { res.writeHead(404); return res.end("{}"); }
  if (id === "temporary") { res.writeHead(503); return res.end("{}"); }
  if (id === "slow") { return; }
  if (id === "invalid") return res.end(JSON.stringify({ catalog: { name: "invalid" } }));
  res.end(JSON.stringify({ catalog: { ...catalog, publicId: id, logoUrl: id === "unsafe" ? "http://127.0.0.1:4317/private-image" : null } }));
});
let next;
async function run() {
  api.listen(4317, "127.0.0.1"); await once(api, "listening");
  next = spawn(process.execPath, [require.resolve("next/dist/bin/next"), "start", "--port", "4318", "--hostname", "127.0.0.1"], {
    env: { ...process.env, NEXT_PUBLIC_CATALOG_API_URL: "http://127.0.0.1:4317/api" }, stdio: ["ignore", "pipe", "pipe"],
  });
  // Keep output drained; error cases deliberately exercise Next's production error boundary.
  next.stdout.resume(); next.stderr.resume();
  const base = "http://127.0.0.1:4318";
  for (let i = 0; i < 100; i++) {
    if (next.exitCode !== null) throw new Error("Next exited before readiness");
    try { await fetch(base + "/login"); break; } catch { await new Promise(r => setTimeout(r, 100)); }
    if (i === 99) throw new Error("Next readiness timeout");
  }
  const readsBeforeMetadataRoutes = [...counts.values()].reduce((sum, value) => sum + value, 0);
  for (const host of [undefined, "untrusted.example"]) {
    const options = host ? { headers: { Host: host } } : {};
    const robotsResponse = await fetch(base + "/robots.txt", options);
    assert.equal(robotsResponse.status, 200);
    assert.match(robotsResponse.headers.get("content-type"), /text\/plain/);
    const robots = await robotsResponse.text();
    assert.equal(robots.trim(), "User-Agent: *\nAllow: /\n\nSitemap: https://catalogo-pink.vercel.app/sitemap.xml");
    assert.ok(!/disallow/i.test(robots));
    const sitemapResponse = await fetch(base + "/sitemap.xml", options);
    assert.equal(sitemapResponse.status, 200);
    assert.match(sitemapResponse.headers.get("content-type"), /application\/xml/);
    const sitemap = await sitemapResponse.text();
    assert.deepEqual([...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]), ["https://catalogo-pink.vercel.app/"]);
    assert.ok(!/lastmod|\/login|\/dashboard|\/carrito|\/c\//.test(sitemap));
  }
  assert.equal([...counts.values()].reduce((sum, value) => sum + value, 0), readsBeforeMetadataRoutes, "Metadata routes must not query the API");
  console.log("robots/sitemap: static canonical URL only, no private paths, no API reads, unaffected by Host.");
  for (const ua of ["WhatsApp/2.24", "facebookexternalhit/1.1", "Mozilla/5.0"]) {
    const before = counts.get("demo") || 0;
    const response = await fetch(base + "/c/demo", { headers: { "User-Agent": ua } });
    assert.equal(response.status, 200);
    const html = await response.text(); const initialHead = html.split("</head>")[0];
    for (const tag of ["og:title", "og:description", "og:image"]) assert.ok(initialHead.includes(`property="${tag}"`), tag);
    assert.ok(initialHead.includes("Tienda de prueba SEO"));
    assert.ok(initialHead.includes("https://catalogo-pink.vercel.app/c/demo/og"));
    assert.match(initialHead, /name="robots" content="index, follow"/);
    assert.equal((counts.get("demo") || 0) - before, 1, "Metadata and page must share one read");
  }
  const product = await fetch(base + "/c/demo/producto/producto");
  assert.equal(product.status, 200); assert.ok((await product.text()).split("</head>")[0].includes("Producto de prueba"));
  for (const path of ["/c/missing", "/c/archived", "/c/inactive", "/c/demo/producto/missing"]) {
    assert.equal((await fetch(base + path)).status, 404, path);
  }
  const landing = await (await fetch(base + "/")).text();
  assert.match(landing.split("</head>")[0], /name="robots" content="index, follow"/);
  const landingCanonical = landing.split("</head>")[0].match(/<link rel="canonical" href="([^"]+)"/);
  assert.ok(landingCanonical);
  assert.equal(new URL(landingCanonical[1]).href, "https://catalogo-pink.vercel.app/");
  for (const path of ["/login", "/dashboard", "/dashboard/catalogos/nuevo", "/c/demo/carrito"]) {
    assert.match(await (await fetch(base + path)).text(), /name="robots" content="noindex, nofollow"/, path);
  }
  for (const id of ["temporary", "invalid", "slow"]) {
    console.log("Checking transient: " + id);
    const start = Date.now(); const response = await fetch(base + "/c/" + id); const html = await response.text();
    assert.notEqual(response.status, 404); assert.ok(html.includes("Reintentar"), id);
    assert.ok(Date.now() - start < 12000, "Explicit timeout must bound the slow API");
  }
  console.log("Checking OG image");
  const og = await fetch(base + "/c/demo/og");
  assert.equal(og.status, 200); assert.match(og.headers.get("content-type"), /image\/png/);
  assert.match(og.headers.get("cache-control"), /no-store/);
  assert.deepEqual([...new Uint8Array(await og.arrayBuffer()).slice(0,8)], [137,80,78,71,13,10,26,10]);
  const unsafe = await fetch(base + "/c/unsafe/og");
  assert.equal(unsafe.status, 200); await unsafe.arrayBuffer();
  assert.equal(counts.get("forbidden-download"), undefined, "Untrusted image URL must not be fetched");
  assert.equal((await fetch(base + "/c/archived/og")).status, 404);
  assert.equal((await fetch(base + "/c/demo/og?product=missing")).status, 404);
  assert.equal((await fetch(base + "/c/temporary/og")).status, 503);
  for (const file of ["PublicCatalogPage.tsx", "PublicProductDetailPage.tsx"]) {
    assert.ok(!fs.readFileSync("components/public/" + file, "utf8").includes("/public/catalogs/${encodeURIComponent(publicId)}`"), "No client catalog refetch");
  }
  console.log("SEO verificado: HTML inicial (3 agentes), una lectura por página, producto, 404, noindex, fallos/timeout y PNG OG. API simulada loopback; sin producción.");
}
run().catch(e => { console.error(e.message, e.cause?.code || "", "Next exit:", next?.exitCode); process.exitCode = 1; }).finally(async () => {
  if (next && next.exitCode === null) { next.kill(); await once(next, "exit"); }
  api.closeAllConnections(); api.close();
});
