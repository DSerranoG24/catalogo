# Matriz de pruebas y comprobaciones

Referencia del 25 de octubre de 2026. Ejecutar desde el paquete indicado, con Node.js `24.x` y dependencias del lockfile instaladas mediante `npm ci`. En PowerShell usar `npm.cmd`. No conectar pruebas a producción ni tomar `.env` como prueba del destino.

## Comandos y alcance

| Paquete / comando | Prerrequisitos | Qué verifica / persistencia |
|---|---|---|
| API: `npm.cmd test` | Dependencias y cliente Prisma generado. | Suite declarada por [test.cjs](../catalog-api/scripts/test.cjs): esquemas, servicios, repositorios, HTTP loopback, autorización, PDF y límites. Usa dobles de persistencia/transacciones; no certifica PostgreSQL real ni Storage remoto. |
| API: `npm.cmd run build` | Cliente Prisma generado (`npm.cmd run prisma:generate`). | TypeScript mediante `tsc`; no ejecuta compras ni migraciones. |
| Frontend: `npm.cmd run lint` | Dependencias instaladas. | ESLint; no verifica interacción o persistencia. |
| Frontend: `npm.cmd run build` | Configuración local válida. | Compilación Next y TypeScript; no acredita conectividad de producción. |
| Frontend: `npm.cmd test` | Dependencias instaladas. | [Lector y proxy](../catalog-generator/scripts/verify-product-import.mjs): 17 grupos actuales. XLSX real, límites, cancelación de workers y handler Next; sin PostgreSQL. Genera una plantilla temporal. |
| Frontend: `npm.cmd run test:import-flow` | Dependencias instaladas. | [Flujo](../catalog-generator/scripts/verify-product-import-flow.mjs): 22 grupos actuales, lector/transporte simulados, estados, lotes, aviso, identificación y exclusión de rechazos. Sin navegador ni base real. |
| Frontend: `npm.cmd run test:import-browser` | Build previo; Chrome/Edge local y OpenSSL de Git for Windows según las rutas del script; puertos 4328/4329 libres. | [Navegador](../catalog-generator/scripts/verify-product-import-browser.mjs): Chromium, worker XLSX y proxy reales contra API HTTPS simulada loopback. No usa PostgreSQL ni Storage real. Prueba selección, reporte, aviso, continuación, errores, reintentos y móvil. |
| Frontend: `node scripts/verify-public-seo.mjs` | Build específico y puertos 4317/4318 libres; seguir [preparación SEO](../catalog-generator/docs/public-seo.md#verificación-local-sin-producción). | [SEO](../catalog-generator/scripts/verify-public-seo.mjs): peticiones HTTP y HTML sin ejecutar JS de navegador; API loopback simulada, metadata, ausencia, timeout y fallback OG. No prueba tarjetas de WhatsApp reales. |
| API: `npm.cmd test -- src/scripts/verify-order-idempotency-postgres.ts` | PostgreSQL real aislado, base loopback `catalogo_test`, esquema actual aplicado previamente con autorización y `DATABASE_URL` segura de proceso. | [Integración optativa](../catalog-api/src/scripts/verify-order-idempotency-postgres.ts): añade el verificador al runner. API HTTP local y Prisma/PostgreSQL reales; crea y limpia sus fixtures. Incluye cotizaciones en su versión actual. No ejecuta migraciones ni integra la suite habitual por defecto. |

El [documento de pruebas de API](../catalog-api/docs/testing.md) conserva el workaround de Windows para `os.userInfo`. Un sandbox puede impedir CDP en Chromium; distinguir ese fallo de infraestructura de una aserción del producto antes de declarar un resultado.

## Otros scripts disponibles

La API declara `dev`, `start`, `contracts:generate`, `prisma:generate`, `prisma:migrate`, `prisma:migrate:deploy` y `prisma:studio`; el frontend declara `dev` y `start`. Son herramientas de desarrollo/operación, no pruebas. `contracts:generate` modifica el contrato generado y no cubre aún todas las rutas/respuestas. Las migraciones y Studio pueden modificar datos: no ejecutarlos como comprobaciones inocuas.

No hay scripts independientes `typecheck` en ninguno de los paquetes; ambos builds incluyen TypeScript. La API no declara `lint`. No instalar herramientas para suplir estos scripts durante una verificación.

La validación de esquema, `migrate status`, reproducción de migraciones, `migrate diff`, inspección de las cinco CHECK y restauración se ejecutan por separado en base aislada con el [procedimiento de migraciones](migrations.md#cómo-verificar-antes-de-aplicar). Prisma diff no acredita las CHECK no representadas por PSL.

## Evidencia y límites

| Método | Evidencia disponible y límite |
|---|---|
| Suite habitual de API | 81 pruebas aprobadas en el bloque previo de mejoras del importador. Dobles y HTTP local; no reinterpretarlas como 81 pruebas de PostgreSQL. |
| PostgreSQL real de idempotencia | Ensayo histórico del 23 de octubre: diez migraciones y tres CHECK, concurrencia y restauración. No certifica la versión actual del verificador ampliado con cotizaciones. Véase [historial](historial/2026-10-23-idempotencia.md). |
| PostgreSQL real del importador | Cierre comunicado de seis escenarios, incluidos concurrencia, edición manual y rollback por fila, antes del lector. No hay un script dedicado de ese ensayo en el repositorio; no inventar un comando reproducible ni afirmar su repetición en esta sesión. Véase [contrato](product-import.md). |
| Lector/flujo/navegador del importador | Último bloque: 17/22 grupos y verificador Chromium aprobados. Navegador contra API simulada; no acredita integración completa con PostgreSQL. |

Cada entrega debe registrar comando exacto, resultado, fecha, método y lo no verificado. Los resultados de bloques anteriores se conservan como [historial](historial/README.md), sin sustituir sus cifras.

## Verificación manual pendiente

- Excel de escritorio, Safari/Firefox, dispositivos físicos y tecnologías de asistencia; la prueba móvil automatizada no equivale a auditoría WCAG.
- Flujo completo de compra con API y PostgreSQL reales en entorno aislado, incluido pedido sin cotización y recuperación por idempotencia.
- Cachés/tarjetas de WhatsApp y conectividad real de imágenes, revisadas tras despliegue autorizado.
- Configuración efectiva de Render/Vercel, versión publicada, secretos y logs que pudieran contener query tokens: revisión operativa autorizada, sin imprimir valores sensibles.
- Retención/anonimización y limpieza Storage: son trabajo pendiente de producto/operación, no capacidades verificadas por estas suites.
