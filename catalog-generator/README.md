# Catalogo Front-end

Panel de vendedores y páginas públicas de catálogo con pedidos por WhatsApp.

## Desarrollo local

1. Copia `.env.example` como `.env.local`. El Client ID de Google se configura en Google Cloud Console como OAuth Client ID Web y también en el `.env` de `catalog-api`.
2. En `catalog-api`, configura su `.env`, aplica la migración y ejecuta `npm run dev`.
3. En esta carpeta ejecuta `npm install` y `npm run dev` para desarrollo (`http://localhost:3001`). Para producción local, ejecuta `npm run build` y `npm start` (`http://localhost:3002`).
4. Las rutas privadas usan el proxy same-origin; el JWT queda en cookie `HttpOnly`, nunca en `localStorage`.

En producción configura `CATALOG_API_URL` como URL HTTPS de servidor y `NEXT_PUBLIC_CATALOG_API_URL` como URL HTTPS pública de la API. `CORS_ORIGINS` en la API debe incluir el origen exacto del front-end. Los valores `NEXT_PUBLIC_*` son públicos y quedan incorporados al build; no coloques credenciales ni claves Supabase allí.

## Módulos

- `components/auth`: acceso y Google Sign-In.
- `components/catalogs`: configuración, enlaces, categorías y órdenes del vendedor.
- `components/products`: edición e inventario de productos.
- `components/public`: cesta, privacidad del pedido y plantillas Editorial, Galería y Boutique.
- `app/api/backend`: proxy same-origin que mantiene el JWT en una cookie `HttpOnly`.
- `lib/api.ts`: tipos, cliente autenticado y cliente público sin credenciales.

El cliente confirma expresamente antes de guardar datos de entrega. La página muestra una acción aparte para abrir WhatsApp; teléfono, dirección, productos y total se agregan al mensaje solo en ese momento. WhatsApp es un servicio externo elegido por el cliente.

## Comprobaciones

```bash
npm run lint
npm run build
```
