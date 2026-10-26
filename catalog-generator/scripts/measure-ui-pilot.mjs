import fs from "node:fs";
import { gzipSync } from "node:zlib";

// Run from catalog-generator after build; no server, network or environment reads.
const html = fs.readFileSync(".next/server/app/dashboard.html", "utf8");
const scripts = [...html.matchAll(/<script\b([^>]*)src="([^"]+)"([^>]*)>/g)]
  .filter(m => m[2].startsWith("/_next/") && !/nomodule/i.test(m[1] + m[3])).map(m => m[2]);
const stylesheets = [...html.matchAll(/<link\b[^>]*href="([^"]+\.css)"[^>]*>/g)].map(m => m[1]);
function measure(urls) {
  return [...new Set(urls)].reduce((sum, url) => {
    const bytes = fs.readFileSync(".next" + url.replace("/_next", ""));
    return { bytes: sum.bytes + bytes.length, gzip: sum.gzip + gzipSync(bytes).length };
  }, { bytes: 0, gzip: 0 });
}
const globalCss = stylesheets.filter(url => fs.readFileSync(".next" + url.replace("/_next", ""), "utf8").includes("--brand-emerald:"));
console.log(JSON.stringify({ modernDashboardJavaScript: measure(scripts), globalCss: measure(globalCss), dashboardCssTotal: measure(stylesheets) }, null, 2));
