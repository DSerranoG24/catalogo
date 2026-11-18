# Verificación de Inventario — 17 de noviembre de 2026

## Ampliación de hoja de inventario

La ampliación aprobada tiene su propio [informe de implementación y verificación](inventory-sheet-verification.md), con la migración 26, lotes atómicos, recibos persistidos, XLSX/CSV, hoja y ficha comercial. Los resultados de este documento se conservan como antecedente de la primera versión; no deben confundirse con la verificación nueva.

## E2E real completado de la primera versión

La verificación continúa en [Inventario: E2E local real](inventory-e2e.md): 14 etapas aprobadas con PostgreSQL 17.11, las 25 migraciones, backend y frontend reales, dos cuentas con autenticación real y navegador real, sin API simulada. Incluye pérdida de respuesta después del commit, recarga incierta sin reenvío automático, concurrencia HTTP, aislamiento entre propietarios, cierre de cuenta y conciliación saldo/ledger.

El informe nuevo documenta los comandos para levantar/detener el clúster aislado, los fallos iniciales del verificador ya resueltos, el alcance manual de reintentos del MVP local y una propuesta de retención tras cierre pendiente de aprobación. No fue necesario añadir otra migración ni corregir comportamiento funcional adicional en esta fase. Se conservan los resultados anteriores para trazabilidad.

## Base revisada

Se consultó GitHub mediante el conector: `main` estaba en `2c42d4992835200a39ccd42c988768e0532486a1`, igual al HEAD local, con árbol limpio antes de editar. Se revisaron los dos commits de inventario (`a0e9028` y `2c42d49`), esquema, migración, repositorio, rutas, autenticación, cierre de cuenta, validaciones, cálculo, pantalla, proxy y consumidores. El segundo commit también incluía el informe previo de imágenes huérfanas; no se modificó ese trabajo.

No existe un controlador de inventario independiente: el router contiene el manejo HTTP, llama al repositorio y utiliza el cálculo puro de saldos. Se mantuvo esa estructura para localizar las correcciones.

## Problemas corregidos

- La pantalla utilizaba una sola clave de reintento y la descartaba al seleccionar un producto. Ahora mantiene claves independientes para operaciones sin confirmar, incluso tras cambiar de producto, formulario o borrador. Una confirmación elimina únicamente su propia clave.
- Dos creaciones simultáneas idénticas podían competir después de leer que el ID no existía. La recuperación de conflicto único devuelve únicamente el artículo del mismo propietario y contenido; no recupera otro SKU, contenido o propietario.
- Las escrituras autenticadas antes de cerrar una cuenta podían ejecutarse después del cierre. Ahora toman un bloqueo compartido del usuario y comprueban `closedAt` dentro de la transacción, coordinándose con el bloqueo exclusivo del cierre.
- `%`, `_` y `\` se interpretaban como comodines en la búsqueda. Ahora se escapan según la convención existente del listado de productos.
- El límite del SKU se comprobaba antes de convertir a mayúsculas, aunque esa conversión puede aumentar su longitud. Se valida también el resultado normalizado.
- Los CHECK originales permitían cantidades cero en entradas/salidas y resultados aritméticamente inconsistentes si otro escritor omitía el servicio. Una migración nueva añade una defensa de base de datos, sin editar la migración original.
- Los errores de movimientos quedaban lejos del formulario. Ahora se muestran junto a él y seleccionar un producto lleva el foco al encabezado de movimientos.
- Los borradores se mantienen por producto: un movimiento pendiente conserva sus campos al volver al artículo, sin trasladarlos a otro. En móvil, los controles de paginación ahora pasan a otra línea sin partir palabras.

## Migraciones y datos

Se creó un clúster temporal exclusivo en `127.0.0.1:55439`, separado del servicio PostgreSQL ya existente. Se verificó la identidad `catalogo_test` y loopback antes de escribir. El verificador crea un esquema aleatorio `inventory_verify_*`, limita el destino a esa base local y rechaza parámetros de conexión ambiguos. No lee `.env`.

El ensayo aplica primero las 23 migraciones anteriores, crea un catálogo y producto ficticios, aplica la migración original de inventario, registra un movimiento válido y aplica la nueva restricción. Comprobó las 25 entradas finalizadas del ledger, columnas Int, índices, relaciones, CHECK validados y conservación del stock del catálogo anterior. `prisma migrate diff --from-schema-datasource prisma/schema.prisma --to-schema-datamodel prisma/schema.prisma --exit-code`, con destino explícito al esquema de prueba, devolvió `No difference detected`.

Se conservaron los datos ficticios y el directorio del clúster temporal; no se borraron datos ni tablas. El clúster temporal quedó detenido al terminar, sin afectar al servicio PostgreSQL existente. Los ensayos no acreditan el ledger ni los datos de otra base de desarrollo o de producción. Las migraciones pendientes en esos destinos se deben inspeccionar antes de aplicar nada.

La nueva migración usa `NOT VALID` seguido de `VALIDATE CONSTRAINT` dentro de una transacción. Antes de aplicarla en un destino con datos, obtener únicamente el número de movimientos inválidos:

```sql
SELECT count(*) AS invalid_movements
FROM inventory_movements
WHERE NOT (
  (type = 'IN' AND quantity > 0 AND "resultingStock"::bigint = "previousStock"::bigint + quantity::bigint)
  OR (type = 'OUT' AND quantity > 0 AND "resultingStock"::bigint = "previousStock"::bigint - quantity::bigint)
  OR (type = 'ADJUSTMENT' AND "resultingStock" = quantity)
);
```

Si el recuento no es cero, detener la aplicación y revisar la inconsistencia; no borrar ni alterar el historial para forzar la validación. La validación recorre la tabla y requiere planificar sus bloqueos según su tamaño. Para rollback de la aplicación, conservar las tablas, datos y restricción; no hay reversión destructiva automática.

## Dependencias locales

Faltaban archivos de paquetes ya registrados: `@esbuild/win32-x64@0.28.2`, `@typescript/typescript-win32-x64@7.0.2`, `typescript@5.9.3` (`lib/_tsc.js`), `@next/swc-win32-x64-msvc@16.3.8` y el binario Windows de Lightning CSS. Se comprobó su ausencia antes de restaurarlos.

En cada paquete se ejecutó `npm.cmd ci --include=optional --ignore-scripts --no-audit --no-fund`, seguido de `npm.cmd run prisma:generate` en API. No se cambiaron versiones, manifiestos de dependencias ni lockfiles; los cambios en `package.json` registran únicamente scripts de pruebas. La caché corrupta `.next/cache/turbopack` se apartó dentro de `.next/cache` como respaldo, sin borrarla, antes de repetir el build.

## Pruebas y reproducción

Desde `catalog-api`:

```powershell
npm.cmd run prisma:generate
npm.cmd run build
npm.cmd exec -- tsc --noEmit
npm.cmd test
# Solo con el clúster temporal local de prueba indicado, sin credenciales reales:
'postgresql://inventory_test@127.0.0.1:55439/catalogo_test' | npm.cmd run test:inventory-postgres
```

Desde `catalog-generator`:

```powershell
npm.cmd run lint
npm.cmd exec -- tsc --noEmit
npm.cmd test
npm.cmd run build
npm.cmd run test:inventory-browser
```

Los procesos del build se configuraron con URLs de API loopback únicamente en su entorno para evitar acceso remoto. No publicar el `.next` local ni desplegarlo con `--prebuilt`; el despliegue autorizado deberá reconstruir desde el código con sus variables propias.

El verificador PostgreSQL usa `dist`, por lo que requiere el build previo indicado. La invocación directa con `tsx` encontró el error local `uv_os_get_passwd` de Windows que ya contempla el runner de pruebas existente; se utiliza el artefacto compilado para este ensayo independiente, sin añadir otro workaround al proceso de aplicación.

Resultados:

- API: build correcto, comprobación de tipos correcta y suite completa de 213 pruebas aprobadas, incluyendo validación, HTTP y la protección del verificador contra destinos remotos.
- Frontend: comprobación de tipos correcta, lint sin errores con cuatro advertencias previas sobre imágenes públicas, 17 comprobaciones existentes más la regresión de reintentos aprobadas y build Turbopack correcto.
- PostgreSQL real: 12 etapas aprobadas. Incluye creación idéntica concurrente, SKU único por propietario, IDs ajenos, salidas concurrentes, claves repetidas, conflictos de contenido, cero mediante ajuste, restricciones y FK, rollback real tras fallo del historial, búsqueda literal, paginación sin solapamientos y rechazo de escrituras tras cerrar cuenta.
- Concurrencia: de 20 salidas sobre 10 unidades se aceptaron exactamente 10; el saldo final fue cero. Doce reintentos simultáneos de la misma entrada guardaron un solo movimiento y sumaron una sola vez.
- Navegador: siete escenarios aprobados con Chrome/Edge headless contra una copia temporal del código, sin copiar archivos de entorno, y API simulada en loopback a través del proxy real. Comprueba pantalla vacía, creación, respuesta perdida seguida de cambio de producto y reintento, borradores independientes, error de salida excesiva, ajuste a cero, doble envío, búsqueda/paginación, recuperación de lectura, sesión expirada, anchos 320/390/1280, etiquetas de paginación sin cortes y foco de teclado. Genera capturas en el directorio temporal comunicado al terminar. No es una prueba E2E de navegador contra PostgreSQL ni contra los servicios desplegados. El watcher de Webpack emitió avisos de acceso a archivos de sistema de Windows durante el escaneo de la copia temporal; no impidieron compilar ni ejecutar los escenarios.
- No existen scripts independientes `typecheck` ni `lint` de API; se usaron los compiladores instalados con `tsc --noEmit`. No se omitieron errores para conseguir builds correctos.

## Límites y siguiente paso

La protección de reintentos de la pantalla vive en memoria: recargar o cerrar la pestaña exige revisar el historial antes de registrar otra operación. No se guardan motivos ni tokens en almacenamiento del navegador. Los CHECK verifican la aritmética de una fila, no sustituyen la transacción del repositorio para mantener el saldo y el historial coordinados; futuras ventas deben utilizar esa operación.

El cierre de cuenta impide nuevas escrituras, pero la política de conservación del historial de inventario tras el cierre sigue pendiente de definición antes de extender el ciclo de vida de datos. No se añadieron borrados automáticos.

No se integró ventas ni se cambió el stock informativo del catálogo. El E2E local completo ya está aprobado; la siguiente tarea es acordar el contrato de Ventas con Inventario descrito en el [informe E2E](inventory-e2e.md#siguiente-tarea-preparada-contrato-de-ventas). Las migraciones en otros destinos siguen sujetas a inspección del ledger y autorización. Este trabajo no autoriza ni ejecuta despliegues.

## Archivos modificados o añadidos

| Área | Archivos |
| --- | --- |
| API | `catalog-api/src/repositories/inventory.repository.ts`, `catalog-api/src/routes/inventory.routes.ts`, `catalog-api/src/schemas/inventory.schema.ts` |
| Migración nueva | `catalog-api/prisma/migrations/20261118000000_inventory_movement_consistency/migration.sql` |
| Pruebas API | `catalog-api/src/services/inventory.test.ts`, `catalog-api/src/scripts/verify-inventory-postgres.ts`, `catalog-api/src/scripts/verify-inventory-postgres.test.ts`, `catalog-api/scripts/test.cjs`, `catalog-api/package.json` |
| Pantalla | `catalog-generator/app/dashboard/inventario/page.tsx`, `catalog-generator/lib/inventory-retry.ts` |
| Pruebas frontend | `catalog-generator/scripts/verify-inventory.mjs`, `catalog-generator/scripts/verify-inventory-browser.mjs`, `catalog-generator/package.json` |
| Documentación | `docs/inventory.md`, `docs/inventory-verification.md` |

`schema.prisma`, la migración original, ambos lockfiles y los archivos de entorno reales permanecen sin cambios. No se hicieron commits, push ni despliegues.
