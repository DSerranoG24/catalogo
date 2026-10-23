# Catalog API

API Express, Prisma y PostgreSQL para cuentas, catálogos, productos, imágenes y órdenes.

## Contrato HTTP

Los esquemas Zod usados para validar las solicitudes son la fuente de verdad del contrato de entrada. Ejecuta `npm run contracts:generate` para generar `openapi.json` (OpenAPI 3.1) con esos esquemas y las operaciones principales. El documento se genera localmente y no hace falta instalar dependencias nuevas. Al agregar o cambiar un endpoint, actualiza el registro de operaciones en `src/scripts/generate-openapi.ts` y regenera el documento. La generación tipada del cliente del frontend queda como siguiente paso, después de completar la cobertura de respuestas y rutas.

`JWT_SECRET` debe tener al menos 32 bytes aleatorios; la API rechaza secretos ausentes o más cortos al iniciar. Antes de desplegar este cambio, comprueba el requisito en el gestor de secretos de Render sin copiar el valor a archivos ni logs. Cambiar un secreto ya usado invalida las sesiones actuales.

## Desarrollo local

1. Copia `.env.example` como `.env` y configura `DATABASE_URL`, `JWT_SECRET`, `SUPABASE_URL` y `SUPABASE_SECRET_KEY`. No compartas ni versionés `.env`.
2. Instala dependencias con `npm install`.
3. Genera Prisma y aplica migraciones locales con `npm run prisma:generate` y `npm run prisma:migrate`.
4. Inicia la API con `npm run dev`; por defecto escucha en `http://localhost:3000`.

Para un despliegue con migraciones revisadas, ejecuta `npm run prisma:migrate:deploy` desde el proceso de release, después de respaldar la base y confirmar `DATABASE_URL`.

Para Render, el repositorio incluye `render.yaml`: al crear un Blueprint conectado a este repositorio, Render configura `catalog-api`, sus comandos de build/inicio y la comprobación `/api/health`. El Blueprint solicitará las variables privadas; cópialas de `.env.production.example` y sustituye los marcadores. `PORT` lo asigna Render automáticamente. El comando de inicio aplica las migraciones pendientes con `prisma migrate deploy` antes de abrir la API; confirma que `DATABASE_URL` apunta a la base de Supabase correcta. Configura `CORS_ORIGINS` con el dominio HTTPS final de Vercel. No subas archivos `.env` reales ni secretos a GitHub.

## Google Sign-In

Crea un OAuth Client ID de tipo Web en Google Cloud Console. Configura los orígenes autorizados con la dirección del front-end y coloca el mismo Client ID en `GOOGLE_CLIENT_ID` de la API y `NEXT_PUBLIC_GOOGLE_CLIENT_ID` del front-end. El ID es público; la API verifica firma, audiencia y correo verificado. Nunca pongas secretos de cliente OAuth en el front-end.

## Orígenes y datos

`CORS_ORIGINS` acepta una lista de orígenes exactos separados por coma. En producción usa solo los dominios HTTPS desplegados. Los catálogos públicos se consultan por su `publicId` aleatorio; la respuesta pública solo incluye campos de presentación, productos activos e imágenes con URL firmada. Las órdenes guardan nombre, teléfono, dirección y productos para que el vendedor las atienda; la ruta autenticada del propietario es la única que devuelve esos datos.

Las órdenes quedan `PENDING`; no se procesa pago ni se descuenta inventario automáticamente. Las transiciones permitidas son pendiente a confirmada/cancelada y confirmada a completada/cancelada.

## Decisiones de pedidos e inventario

El pedido público es una solicitud que el vendedor confirma posteriormente por WhatsApp. `Product.stock` es informativo para este flujo: no se reserva ni se descuenta al registrar un pedido. La disponibilidad y la entrega deben confirmarse con el vendedor. Abrir el enlace de WhatsApp no demuestra que el mensaje se haya enviado.

Como política provisional, los datos personales de un pedido se conservarán durante 12 meses desde su última actualización y después se anonimizarán, preservando la información transaccional no identificable. Esta retención y anonimización están pendientes de revisión jurídica; no hay un proceso automatizado implementado.

## Node.js

Ambos paquetes declaran Node.js `24.x`, una línea LTS compatible con Next.js 16 y Prisma 6. Antes de desplegar, alinea manualmente la versión configurada en los proyectos de Vercel y en el servicio de Render con Node.js 24; cambiar la declaración del repositorio no modifica la versión activa de producción.
