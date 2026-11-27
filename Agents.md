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

## Orden de bloqueo (dinero y existencias)

Toda operación nueva o modificada que mueva dinero o existencias (ventas, pagos, abonos, saldos a favor, gastos, movimientos y lotes de inventario, conversión de pedidos) sigue este orden dentro de **una sola transacción**:

1. `lockAccountForMoney(tx, ownerId)` (`catalog-api/src/repositories/account-lock.ts`), siempre lo primero. Toma `pg_advisory_xact_lock(hashtext('account-money-v1'), hashtext(ownerId))` y después `users` `FOR SHARE` de una cuenta abierta.
2. Otros bloqueos de asesoría por cuenta, si hacen falta (`inventory-identity-v1`…).
3. Recibo de idempotencia.
4. Filas `FOR UPDATE`, por tipo y después por `id`: pedido → cliente → venta o deuda inicial → filas de gastos → lote → artículos de inventario.

Reglas:
- El cierre de cuenta toma `accountClosureMoneyLock` y después pedidos → catálogos → `users` `FOR UPDATE`. No muevas `users` al principio del cierre: el trigger `guard_closed_catalog_write` toma `users` después del pedido o del catálogo.
- No crees bloqueos de asesoría nuevos para dinero o existencias (como el antiguo `expenses-v1`): usa el de la cuenta.
- No bloquees un pedido, un catálogo ni otra fila antes del paso 1 en una operación de dinero o existencias.
- Las lecturas no toman este bloqueo.
- Detalle y pruebas: [contrato de pagos, 15.A](docs/sales-payments-cartera-contract.md#15-correcciones-del-planificador) y `npm.cmd run test:account-lock-postgres`.

## Validación obligatoria

Después de cada modificación ejecuta las comprobaciones específicas del módulo afectado y, antes de cerrar una tarea, los scripts disponibles de:

- lint
- typecheck
- test
- build

Si un script no existe, informa de ello; no instales herramientas nuevas automáticamente.
