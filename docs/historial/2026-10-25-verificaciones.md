# Verificaciones anteriores: consolidación del 2026-10-25

La fecha es de recopilacion; no se inventa una fecha de ejecución para los textos sin fecha. Se conservan literalmente alcance, resultados y exclusiones de los bloques anteriores. No son nuevas verificaciones. Referencia vigente: [matriz de pruebas](../testing.md).

## catalog-generator/docs/product-import-reader.md

La plantilla se abrió también con openpyxl ya instalado, como comprobación independiente de hojas, celda B2/B501 en Texto, fechas Texto, cuatro validaciones, doce notas y cero valores de datos. No se instaló openpyxl ni se automatizó Excel de escritorio.



## docs/product-import.md

La documentación OpenAPI generada quedó intacta por restricción. Este documento describe el contrato nuevo. La suite usa HTTP loopback y dobles transaccionales; la verificación adicional del backend contra PostgreSQL local fue cerrada con los seis escenarios aprobados antes de la fase 3A, incluida concurrencia, edición manual y rollback por fila. La fase 3A no accede a esa base ni a producción y no aplica migraciones.


## docs/quotations.md

## Verificación disponible

`npm.cmd test` conserva las pruebas de archivado, idempotencia, consulta protegida, cabeceras, cancelación, validación, PDF real y logo. Las expectativas de la transacción principal se ajustaron: ahora se exige que no toque campos de cotización. Las diez nuevas pruebas cubren fallo de emisión, configuración ausente, reintento del mismo pedido, fallo del logger/formato, emisión concurrente única, rollback tras incremento o actualización fallida, recuperación sin renumerar y cancelación/pertenencia. Los servidores de pruebas son loopback; no se lee ni modifica una base de datos ni se contacta Storage real.

El verificador optativo `src/scripts/verify-order-idempotency-postgres.ts` quedó preparado para comprobar números distintos en solicitudes concurrentes, mismo enlace en reintentos y rechazo de pedidos archivados sin incrementar contador. Fija la URL de la API al servidor loopback del ensayo y limpia únicamente sus fixtures, eliminando pedidos antes de catálogos por RESTRICT. Solo admite la base local `catalogo_test`. **No se ejecutó**: requiere primero la migración en esa base bajo autorización separada. Tampoco ejecuta migraciones por su cuenta.

Fuera de alcance: editor avanzado de condiciones, emisión al confirmar, cambios de inventario, numeración retroactiva, conversión de WebP, firma digital y factura electrónica. La documentación OpenAPI generada quedó intacta por restricción; el contrato nuevo se describe aquí.

## Interfaz: registro anterior de grupos y alcance

El texto conserva los 20 grupos de flujo y 16 de lector del bloque inicial; los actuales son 22 y 17.

## Verificación reproducible

- `npm.cmd run test:import-flow`: 20 grupos; estados, token encadenado, conflictos entre lotes, errores locales, detención, cierre, red, 401, 429, vencimiento, doble envío, refresco, unicidad por fila, tamaño de JSON y respuestas inválidas.
- `npm.cmd test`: 16 grupos del lector/proxy de 3A, intactos.
- `npm.cmd run test:import-browser`: build de Next ya generado, Chrome/Edge local y OpenSSL de Git for Windows. Usa perfil temporal, servidores solo en loopback y API simulada HTTPS. La clave TLS efímera queda en memoria; solo se escribe el certificado público y se confía en él mediante NODE_EXTRA_CA_CERTS exclusivamente en el proceso temporal de Next. No se deshabilita TLS ni se cambia Origin. Se navega por localhost, que coincide con la normalización local de Next.

La comprobación de navegador usa el worker y lector reales y peticiones reales por el proxy, con respuestas simuladas. Cubre archivo mixto con SKU numérico, creación/actualización, refresco y borrador, tres lotes encadenados, stop mientras un lote sigue en curso, controles bloqueados, paginación/foco, respuesta perdida, 429 manual, 401 también al refrescar y cierre/reapertura con reporte. Incluye viewport de 390px sin desbordamiento del documento y una captura temporal. Los servicios/procesos temporales se cierran al finalizar.

No se prueba contra la API real, PostgreSQL ni producción en este bloque. Tampoco sustituye pruebas manuales en Safari/Firefox, dispositivos físicos o tecnologías de asistencia. Sin dependencias, variables de despliegue o migraciones nuevas. Commit/push/despliegue requieren autorización.

