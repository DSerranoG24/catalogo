# Estado del proyecto Catalogo

Fecha de corte: **25 de octubre de 2026**. Este documento separa implementación, evidencia local y despliegue comunicado. No presupone configuración remota a partir de YAML ni sustituye los procedimientos de [despliegue](despliegue.md) y [pruebas](testing.md).

## Implementado en el repositorio

- Pedidos con precios del servidor, instantáneas e idempotencia opcional por catálogo.
- Archivado/reactivación de catálogos y protección del historial mediante rechazo de borrado con pedidos y FK RESTRICT.
- Migraciones separadas del arranque de API. Trece migraciones versionadas y cinco CHECK SQL; no es un conteo del ledger remoto.
- SEO de servidor, canonical, Open Graph y noindex de rutas administrativas/carrito. Sitemap pendiente.
- Cotizaciones PDF con numeración por catálogo, instantánea al emitir y acceso por token; pedido y emisión desacoplados.
- Importador Excel: backend JSON, vista previa firmada, confirmación, lector seguro, plantilla, interfaz, reporte parcial y aviso de formato.
- Zod 4.6.6 en API y resolución transitiva del frontend.
- Búsqueda, filtros y paginación en cliente del catálogo público; no equivalen a paginación de servidor.
- Suites frontend de lector/proxy, flujo y navegador, además de pruebas API y verificación SEO por HTTP.

Contratos y motivos: [decisiones](decisiones.md), [arquitectura](arquitectura.md) y [mapa documental raíz](../README.md#documentación).

## Verificado localmente y método

| Evidencia disponible al corte | Método y límite |
|---|---|
| Bloque previo de mejoras: API 81/81, lector 17 grupos, flujo 22 y navegador aprobados; builds API/frontend correctos. | Suite API con dobles y HTTP loopback; lector real; flujo simulado; Chromium con worker/proxy reales y API simulada. No certifica PostgreSQL real. |
| Lint del frontend: cero errores y ocho advertencias de imágenes en archivos ajenos al importador. | Análisis estático del bloque previo; no auditoría de accesibilidad o rendimiento. |
| Idempotencia y restauración del 23 de octubre. | PostgreSQL local real, diez migraciones y tres CHECK de aquel momento. Resultado histórico, no reproducción de las trece actuales. |
| Backend de importación: seis escenarios cerrados antes del lector, según registro del bloque. | PostgreSQL local real, concurrencia, edición manual y rollback por fila; no repetidos en este bloque documental ni disponibles como script dedicado versionado. |
| Cotizaciones desacopladas. | Suite con dobles transaccionales y HTTP; el documento funcional no acredita ejecución del verificador PostgreSQL ampliado. |

Esta tabla conserva la procedencia de las evidencias. En el bloque documental del 25 de octubre se repitieron los builds frontend/API, la suite API (81/81), lint frontend (cero errores, ocho advertencias de imágenes) y la suite de lector/proxy (17 grupos). No se repitieron flujo, Chromium, SEO ni ensayos PostgreSQL. Véanse [matriz y prerrequisitos](testing.md) y [resultados históricos](historial/README.md).

## Desplegado según el responsable

El responsable comunica que los doce bloques funcionales están cerrados y desplegados: idempotencia, archivado, separación de migraciones del arranque, SEO/OG, cotizaciones, desacoplamiento pedido/cotización, importación backend/lector/plantilla/interfaz, mejoras del importador y parche Zod.

Frontend en Vercel, API en Render y datos/Storage en Supabase, según ese contexto. No se consultaron esos servicios durante este bloque; no se verificaron remotamente SHA publicado, versión Node, configuración efectiva de comandos, Blueprint, ledger o logs. El estado histórico de doce migraciones comunicado el 24 de octubre se conserva fechado, no como estado vigente del repositorio.

## Pendientes y límites

- Retención/anonimización: revisión jurídica de la política provisional y automatización; incluir instantáneas y enlaces PDF.
- Sitemap y política de descubrimiento; opción individual de indexación por catálogo.
- E2E completa de compra en entorno aislado y verificación de cotizaciones con PostgreSQL real en su implementación actual.
- Auditoría WCAG y pruebas con lectores de pantalla, navegadores y dispositivos físicos.
- Paginación/filtrado de servidor y mejoras del panel; la búsqueda pública en cliente ya existe.
- Limpieza de objetos huérfanos Storage y optimización de imágenes.
- Ampliar cobertura de OpenAPI y respuestas; la generación parcial existe y no reemplaza los contratos funcionales de importación/cotizaciones.
- Revisar los pendientes históricos de revocación JWT, CSP, reseñas, enumeración de correos, observabilidad general, CI y staging antes de priorizarlos; no se reauditaron en este bloque. Hay requestId y logs seguros en flujos concretos, lo que no acredita observabilidad completa.

Las decisiones de inventario e historial ya están tomadas; no figuran como funcionalidades por decidir. Las reglas de trabajo siguen en [Agents.md](../Agents.md).
