# Estado del proyecto Catalogo

Última actualización: 2026-10-23

## Contexto

Aplicación de catálogos para vendedores con pedidos por WhatsApp.

- Frontend: Next.js, React, TypeScript y Tailwind.
- Backend: Express, TypeScript, Prisma 6 y PostgreSQL.
- Almacenamiento de imágenes: Supabase Storage.
- Frontend desplegado en Vercel.
- API desplegada en Render.
- Base de datos: Supabase, plan gratuito, sin datos críticos.
- Autenticación propia (bcrypt) más Google Sign-In.
- JWT en cookie HttpOnly mediante proxy same-origin.

Repositorio: [github.com](https://github.com/DSerranoG24/catalogo)
Último commit relevante: 6ddf3a2

## Cómo trabajar en este proyecto

1. Inspecciona el código y el estado de Git antes de modificar.
2. No sobrescribas cambios locales sin confirmar.
3. No apliques migraciones ni despliegues sin autorización explícita.
4. No leas ni muestres `.env`, secretos ni credenciales.
5. No añadas dependencias sin justificar que no hay alternativa.
6. No mezcles correcciones de seguridad con refactorizaciones o cambios visuales.
7. Verifica con las comprobaciones existentes: `npm test`, `npm run build`, `npm run lint`.

## Decisiones de dominio ya tomadas

No revertir estas decisiones sin autorización explícita.

1. Inventario: `Product.stock` es informativo para el flujo de pedidos. No se
   reserva ni se descuenta automáticamente. El pedido es una solicitud sujeta a
   confirmación por WhatsApp. La interfaz indica "disponibilidad por confirmar".

2. Historial de pedidos: debe conservarse. Un catálogo con pedidos no debe
   poder eliminarse físicamente. El archivado es el mecanismo previsto.

3. Retención de datos personales: provisionalmente 12 meses desde la última
   actualización del pedido, con posterior anonimización conservando
   información transaccional no identificable. Pendiente de revisión jurídica.

4. WhatsApp: la aplicación confirma que el pedido quedó registrado. No puede
   afirmar que el mensaje fue enviado, porque abrir el enlace no lo demuestra.

5. Idempotencia de pedidos: la clave es opcional, única por catálogo
   (`catalogId + idempotencyKey`). Un reintento devuelve el mismo recibo, no
   un error. Implementado y verificado contra PostgreSQL local.

## Implementado y verificado

- Autenticación: JWT en cookie HttpOnly, bcrypt, Google Sign-In validado en servidor.
- Autorización: las consultas privadas filtran por propietario.
- Proxy same-origin: valida Origin en mutaciones, limita tamaño, restringe rutas.
- Precios: calculados exclusivamente en el servidor, con instantánea por línea de pedido.
- CORS con lista explícita, Helmet y límite de JSON.
- Imágenes: límite de tamaño, validación de MIME y firma, rutas aleatorias en Supabase.
- Rate limiting con express-rate-limit.
- Validación con Zod en cuerpos, parámetros y variables.
- Suite de pruebas: 29 pruebas, incluida verificación de concurrencia real.
- Entorno local: PostgreSQL 17.11, 10 migraciones aplicadas limpiamente.
- `prisma migrate diff` sin diferencias entre migraciones y esquema.

## Pendiente, por prioridad

### P1 — Integridad y operación

1. Archivado de catálogos: sustituir el borrado en cascada que destruye el
   historial de pedidos. Requiere decisión de dominio sobre qué pasa con un
   catálogo archivado y si sus productos siguen públicos.
2. Política de inventario: formalizar en el modelo y la interfaz.
3. Retención y anonimización: implementar el job y el mecanismo de borrado.
4. Limpieza de objetos huérfanos en Supabase Storage: hoy borrar un producto
   no elimina su imagen.
5. Migraciones fuera del `startCommand` de Render: hoy cada instancia compite
   por migrar al arrancar.
6. Fijar Node 24 en Vercel y Render: declarado en el repositorio, no confirmado
   en los servicios.
7. Regla de orden: migración antes de despliegue. Desplegar código que depende
   de una migración no aplicada rompe producción.

### P2 — Seguridad y calidad

8. Revocación de JWT: un token robado sigue válido 7 días.
9. Paginación por cursor en pedidos, productos y reseñas.
10. Límite de transiciones de reseñas: hoy se acepta cualquier estado sin
    comprobar el anterior.
11. Pruebas de autorización multiusuario con dos usuarios.
12. Runner de pruebas de frontend: no hay ninguno configurado.
13. Pruebas E2E del flujo completo de compra.
14. CSP en el frontend: hay cabeceras de seguridad, no política de contenido.
15. Enumeración de correos en registro.
16. Documentar que las tres CHECK (`products_promotion_valid_check`,
    `product_reviews_rating_check`, `product_reviews_comment_length_check`)
    viven en SQL y no en el schema de Prisma; reconstruir desde el modelo las
    perdería.

### P2 — Producto y UX

17. Accesibilidad WCAG 2.2 AA: sin auditar.
18. SEO: metadata por ruta, Open Graph, noindex en panel, sitemap.
19. Compresión, miniaturas y formatos modernos en imágenes.
20. Búsqueda y filtros en catálogo público y panel.
21. Historial de estados de pedido visible para el vendedor.

### P3 — Escalabilidad y mantenimiento

22. Contratos compartidos u OpenAPI para eliminar tipos duplicados.
23. Reorganización como monorepo con workspaces.
24. Observabilidad: logs estructurados, request ID, redacción de PII.
25. CI/CD con lint, typecheck, test, build y auditoría en cada PR.
26. Entorno de staging separado de producción.
27. Dependabot o Renovate.
28. Licencia, CONTRIBUTING.md, SECURITY.md, ADRs.

## Configuración del entorno local

- PostgreSQL 17.11 en `127.0.0.1:5432`, bases `catalogo_test` y `catalogo_shadow`.
- La suite requiere `npm.cmd test` en Windows por bloqueo de scripts en PowerShell.
- El script `catalog-api/scripts/test.cjs` gestiona un fallo conocido de
  `os.userInfo` en este equipo Windows; está documentado en `docs/testing.md`.

## Archivos de referencia

- `docs/migrations.md`: procedimiento de migración, verificación y respaldo.
- `docs/testing.md`: reproducibilidad de la suite.
- `docs/order-idempotency.md`: contrato de idempotencia.
