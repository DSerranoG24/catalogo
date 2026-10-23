import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "catalogo_session";
const API_BASE_URL = (process.env.CATALOG_API_URL ?? "http://localhost:3000/api").replace(/\/$/, "");
let lastLookupAt = 0;

export async function GET(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return NextResponse.json({ message: "Inicia sesión para buscar productos." }, { status: 401 });

  const code = request.nextUrl.searchParams.get("code")?.trim() ?? "";
  if (!/^\d{8,14}$/.test(code)) {
    return NextResponse.json({ message: "Ingresa un código de barras EAN, UPC o GTIN de 8 a 14 dígitos." }, { status: 400 });
  }

  const now = Date.now();
  if (now - lastLookupAt < 10_000) {
    return NextResponse.json({ message: "Espera unos segundos antes de buscar otro código." }, { status: 429 });
  }

  try {
    const apiUrl = new URL(API_BASE_URL);
    if (process.env.NODE_ENV === "production" && apiUrl.protocol !== "https:") {
      return NextResponse.json({ message: "El servicio requiere una URL HTTPS." }, { status: 500 });
    }
    const authenticated = await fetch(`${API_BASE_URL}/catalogs`, {
      headers: { authorization: `Bearer ${token}`, accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });
    if (!authenticated.ok) {
      return NextResponse.json({ message: "Tu sesión venció. Vuelve a iniciar sesión." }, { status: 401 });
    }

    lastLookupAt = now;
    const lookupUrl = new URL("https://api.upcitemdb.com/prod/trial/lookup");
    lookupUrl.searchParams.set("upc", code);
    const response = await fetch(lookupUrl, {
      headers: { accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(8000),
    });
    const data = await response.json().catch(() => null) as {
      code?: string;
      items?: Array<{ title?: string; brand?: string; model?: string; description?: string; upc?: string; ean?: string }>;
    } | null;

    if (response.status === 429) {
      return NextResponse.json({ message: "El servicio de códigos alcanzó su límite temporal. Inténtalo más tarde." }, { status: 429 });
    }
    if (response.status === 404 || data?.code === "NOT_FOUND" || !data?.items?.length) {
      return NextResponse.json({ message: "No encontramos información para ese código. Puedes completar el producto manualmente." }, { status: 404 });
    }
    if (!response.ok) {
      return NextResponse.json({ message: "No se pudo consultar el código en este momento." }, { status: 502 });
    }

    const item = data.items[0];
    return NextResponse.json({
      product: {
        name: item.title?.slice(0, 150) ?? "",
        brand: item.brand?.slice(0, 100) ?? "",
        model: item.model?.slice(0, 100) ?? "",
        description: item.description?.slice(0, 2000) ?? "",
        code: item.upc || item.ean || code,
      },
    }, { headers: { "cache-control": "no-store", "x-content-type-options": "nosniff" } });
  } catch {
    return NextResponse.json({ message: "No se pudo conectar con el servicio de consulta. Puedes completar el producto manualmente." }, { status: 502 });
  }
}
