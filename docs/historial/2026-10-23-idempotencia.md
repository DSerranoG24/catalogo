# Verificaciones de idempotencia del 2026-10-23

Registro histórico conservado literalmente del procedimiento anterior. Sus cifras y destino describen aquel ensayo; no son instrucciones para migrar ni acreditan el esquema actual. Procedimientos vigentes: [migraciones](../migrations.md) y [matriz de pruebas](../testing.md).

### Resultado histórico ejecutado en el PostgreSQL local (2026-10-23)

Se verificó lo siguiente exclusivamente contra `127.0.0.1:5432/catalogo_test`:

- `npm.cmd run prisma:migrate:deploy`: aplicó en orden las 10 migraciones, incluida `20261023150000_order_idempotency_key`.
- `prisma migrate status`: `Database schema is up to date!`.
- `prisma validate`: el modelo Prisma es válido.
- `prisma migrate diff --from-migrations ... --to-schema-datamodel ... --shadow-database-url ... --exit-code`: `No difference detected.` No detecta por sí solo las CHECK que PSL no expresa; se consultaron aparte.
- La consulta a `pg_constraint` encontró las tres CHECK y sus condiciones. `information_schema.columns` mostró `idempotencyKey` nullable. `pg_indexes` confirmó el índice único `orders_catalogId_idempotencyKey_key` sobre `("catalogId", "idempotencyKey")`.
- La prueba HTTP real envió dos POST simultáneos con la misma clave al API local. Ambas respuestas fueron HTTP 201 con el mismo `order.id` (`331b2705-befe-4f56-a554-0b23b5e70b0a`) y PostgreSQL guardó 1 fila. El reintento secuencial devolvió el mismo recibo. Dos claves distintas en el mismo catálogo produjeron 2 filas. La misma clave en dos catálogos produjo 2 IDs y 2 filas. Sin clave se crearon dos pedidos distintos. Se envió `total: 1` desde el cliente y el servidor devolvió 2500, calculado desde los precios persistidos.
- Tras la prueba se verificaron 0 usuarios, 0 catálogos y 0 pedidos de fixture; el ledger local tiene 10 migraciones completas.
- `npm.cmd test` sin el script de integración adicional: 28/28 pruebas aprobadas. `npm.cmd run build` y `prisma validate`: correctos. Al incluir el script de integración, el runner informó 29/29 pruebas aprobadas (las 28 habituales más el caso de integración local).
- Ensayo de restauración local: `pg_dump -Fc` creó `%TEMP%\catalogo-test-restore-20261023.dump` (23,643 bytes) desde la base local vacía de fixtures; `pg_restore --exit-on-error` restauró en la nueva `catalogo_restore_test` sin error. La copia restaurada contiene las 10 migraciones, las tres CHECK y el índice único idempotente. Esto valida la restauración lógica local del esquema, no un respaldo de producción/Supabase.

