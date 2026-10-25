# Catalogo Front-end

Panel de vendedores y páginas públicas de catálogo con pedidos por WhatsApp.

## Desarrollo local

1. Copia `.env.example` como `.env.local`. El Client ID de Google se configura en Google Cloud Console como OAuth Client ID Web y también en el `.env` de `catalog-api`.
2. En `catalog-api`, configura su `.env`, aplica la migración y ejecuta `npm run dev`.
3. En esta carpeta ejecuta `npm ci` y `npm run dev` para desarrollo (`http://localhost:3001`). Para producción local, ejecuta `npm run build` y `npm start` (`http://localhost:3002`). Usa Node.js `24.x`, según `engines.node`.
4. Las rutas privadas usan el proxy same-origin; el JWT queda en cookie `HttpOnly`, nunca en `localStorage`.

### Variables para Vercel

`.env.production.example` enumera las variables para **Project Settings > Environment Variables** de Vercel, con ámbito **Production**. Los dominios de ejemplo son marcadores: usa los valores efectivos del servicio autorizado. `NEXT_PUBLIC_*` es público y queda incorporado al build; nunca pongas credenciales ni claves Supabase allí. No subas archivos de entorno reales. El orden de publicación, las variables y las comprobaciones viven en la [guía de despliegue](../docs/despliegue.md).

En producción configura `CATALOG_API_URL` como URL HTTPS de servidor y `NEXT_PUBLIC_CATALOG_API_URL` como URL HTTPS pública de la API. `CORS_ORIGINS` en la API debe incluir el origen exacto del front-end. Los valores `NEXT_PUBLIC_*` son públicos y quedan incorporados al build; no coloques credenciales ni claves Supabase allí.

## Módulos

- `components/auth`: acceso y Google Sign-In.
- `components/catalogs`: configuración, enlaces, categorías y órdenes del vendedor.
- `components/products`: edición e inventario de productos.
- `components/public`: carrito, privacidad del pedido y diseños públicos de catálogo.
- `app/api/backend`: proxy same-origin que mantiene el JWT en una cookie `HttpOnly`.
- `lib/api.ts`: tipos, cliente autenticado y cliente público sin credenciales.
- `lib/catalogTemplates.ts`: opciones, IDs tipados y normalización de IDs históricos para los diseños.

El proceso para crear un diseño público nuevo está documentado en [`docs/agregar-disenos-de-catalogo.md`](docs/agregar-disenos-de-catalogo.md).

El cliente confirma expresamente antes de guardar datos de entrega. La página muestra una acción aparte para abrir WhatsApp; teléfono, dirección, productos y total se agregan al mensaje solo en ese momento. WhatsApp es un servicio externo elegido por el cliente.

## Comprobaciones

```bash
npm run lint
npm run build
```

Hay verificaciones automatizadas del lector, proxy, flujo y navegador del importador: `npm.cmd test`, `npm.cmd run test:import-flow` y `npm.cmd run test:import-browser`. No equivalen a una prueba E2E completa de compra. Consulta la [matriz de pruebas](../docs/testing.md).
