import { NextRequest, NextResponse } from "next/server";

const SESSION_COOKIE = "catalogo_session";
const MAX_REQUEST_BYTES = 5 * 1024 * 1024 + 64 * 1024;
const API_BASE_URL = (
  process.env.CATALOG_API_URL ?? "http://localhost:3000/api"
).replace(/\/$/, "");

type RouteContext = { params: Promise<{ path: string[] }> };

async function readBodyWithLimit(request: NextRequest, limit: number) {
  if (!request.body) return new ArrayBuffer(0);

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > limit) {
      await reader.cancel();
      throw new Error("REQUEST_TOO_LARGE");
    }
    chunks.push(value);
  }

  const body = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body.buffer;
}

async function proxyRequest(request: NextRequest, context: RouteContext) {
  const { path } = await context.params;
  if (!path.length || path.some((part) => !/^[a-zA-Z0-9_-]+$/.test(part))) {
    return NextResponse.json({ message: "Ruta inválida" }, { status: 400 });
  }

  const configuredApiUrl = new URL(API_BASE_URL);
  if (process.env.NODE_ENV === "production" && configuredApiUrl.protocol !== "https:") {
    return NextResponse.json({ message: "El servicio requiere una URL HTTPS" }, { status: 500 });
  }

  const method = request.method.toUpperCase();
  const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (isMutation && request.headers.get("origin") !== request.nextUrl.origin) {
    return NextResponse.json({ message: "Origen no permitido" }, { status: 403 });
  }

  if (path[0] === "auth" && path[1] === "logout") {
    const response = NextResponse.json({ success: true });
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  }

  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const headers = new Headers();
  const contentType = request.headers.get("content-type");
  if (contentType) headers.set("content-type", contentType);
  headers.set("accept", "application/json");
  if (token) headers.set("authorization", `Bearer ${token}`);

  let body: ArrayBuffer | undefined;
  if (!["GET", "HEAD"].includes(method)) {
    const bodyLimit = contentType?.startsWith("multipart/form-data")
      ? MAX_REQUEST_BYTES
      : 64 * 1024;
    const contentLength = Number(request.headers.get("content-length") ?? 0);
    if (contentLength > bodyLimit) {
      return NextResponse.json({ message: "La solicitud supera el tamaño permitido" }, { status: 413 });
    }
    try {
      body = await readBodyWithLimit(request, bodyLimit);
    } catch (error) {
      if (error instanceof Error && error.message === "REQUEST_TOO_LARGE") {
        return NextResponse.json({ message: "La solicitud supera el tamaño permitido" }, { status: 413 });
      }
      return NextResponse.json({ message: "No se pudo leer la solicitud" }, { status: 400 });
    }
  }

  let upstream: Response;
  try {
    const target = `${API_BASE_URL}/${path.join("/")}${request.nextUrl.search}`;
    upstream = await fetch(target, {
      method,
      headers,
      body,
      cache: "no-store",
      redirect: "error",
    });
  } catch {
    return NextResponse.json({ message: "No se pudo conectar con el servicio" }, { status: 502 });
  }

  const responseBody = await upstream.text();
  const responseHeaders = new Headers({
    "content-type": upstream.headers.get("content-type") ?? "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  const response = new NextResponse(responseBody, {
    status: upstream.status,
    headers: responseHeaders,
  });

  if (upstream.status === 401) {
    response.cookies.set(SESSION_COOKIE, "", {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });
    return response;
  }

  if (path[0] === "auth" && ["login", "register", "google"].includes(path[1] ?? "") && upstream.ok) {
    try {
      const payload = JSON.parse(responseBody) as {
        token?: string;
        user?: { id: string; email: string; name: string | null };
        success?: boolean;
      };
      if (payload.success && payload.token && payload.user) {
        const authResponse = NextResponse.json(
          { success: true, user: payload.user },
          { status: upstream.status, headers: responseHeaders }
        );
        authResponse.cookies.set(SESSION_COOKIE, payload.token, {
          httpOnly: true,
          secure: process.env.NODE_ENV === "production",
          sameSite: "lax",
          path: "/",
          maxAge: 7 * 24 * 60 * 60,
        });
        return authResponse;
      }
    } catch {
      return NextResponse.json({ message: "Respuesta de autenticación inválida" }, { status: 502 });
    }
  }

  return response;
}

export const GET = proxyRequest;
export const POST = proxyRequest;
export const PUT = proxyRequest;
export const PATCH = proxyRequest;
export const DELETE = proxyRequest;
