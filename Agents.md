# Instrucciones del proyecto Catalogo

## Contexto

Este proyecto está en producción.

- Frontend: Next.js, React, TypeScript y Tailwind.
- Backend: Express, TypeScript, Prisma y PostgreSQL.
- Storage: Supabase.
- Frontend: Vercel.
- API: Render.
- Autenticación mediante JWT en cookie HttpOnly y proxy same-origin.
- Pedidos gestionados desde el catálogo público y WhatsApp.

## Restricciones

- No modificar credenciales ni archivos de entorno reales.
- No ejecutar acciones contra producción.
- No cambiar la política de inventario sin autorización.
- No modificar migraciones aplicadas.
- No actualizar dependencias mayores junto con cambios funcionales.
- No reorganizar el repositorio mientras se corrigen problemas prioritarios.
- No eliminar funciones existentes sin comprobar sus consumidores.
- Proteger los cambios locales que todavía no estén confirmados.

## Prioridades

1. Seguridad y autorización multiusuario.
2. Integridad de pedidos, precios e inventario.
3. Privacidad de datos personales.
4. Pruebas de integración y E2E.
5. Estabilidad del despliegue y migraciones.
6. Accesibilidad.
7. Rendimiento y SEO.
8. Refactorización estructural.

## Reglas del dominio

- Los precios y totales se calculan en el servidor.
- No se confía en precios, propiedad de recursos o permisos enviados por el cliente.
- Toda operación privada debe limitarse al usuario autenticado.
- Las órdenes deben conservar una instantánea de sus productos.
- Las transiciones de estado deben respetar las reglas del dominio.
- El JWT nunca debe almacenarse en localStorage.
- Los datos personales no deben aparecer en logs.
- Las pruebas nunca deben usar producción.

## Validación obligatoria

Después de cada modificación ejecuta las comprobaciones específicas del módulo afectado y, antes de cerrar una tarea, los scripts disponibles de:

- lint
- typecheck
- test
- build

Si un script no existe, informa de ello; no instales herramientas nuevas automáticamente.
