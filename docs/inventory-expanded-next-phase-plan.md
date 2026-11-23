# Siguiente fase: inventario ampliado — plan separado

Estado: propuesta para revisión, sin autorización de implementación ni publicación.
Su preparación no convierte el historial de clientes en aceptación completa.
No incluye código, SQL, migraciones, cambios de datos o nuevas dependencias.

## Punto de partida comprobado

El repositorio ya contiene inventario tradicional, ficha comercial, lotes y hoja
libre; no corresponde implementarlos otra vez. Referencias:
[contrato de hoja/lotes](inventory-sheet-contract.md),
[verificación previa](inventory-sheet-verification.md),
[hoja libre](inventory-workbook.md) y
[contrato de ventas](sales-contract.md).

Rutas existentes: `/dashboard/inventario`, `/dashboard/inventario/lotes` y
`/dashboard/inventario/hoja`. El siguiente incremento debe definir qué falta
realmente en esas superficies, sin asumir que «ampliado» autoriza nuevas reglas
de stock, bodegas, costos, valorización o ajustes automáticos.

## Orden propuesto

1. Cerrar o aceptar explícitamente los pendientes del historial privado: prueba
   controlada de paginación, cliente archivado y líneas históricas; medición de
   PostgreSQL aislado; tratamiento autorizado de la venta sintética. Mantener
   sus contratos y snapshots como regresión obligatoria.
2. Auditar el inventario implementado y sus consumidores de ventas/pedidos;
   levantar una matriz «existente / fallo reproducible / necesidad nueva».
   Revisar primero el fallo del navegador `LOST_REPLY_SWITCH_AND_RETRY`, sus
   fixtures y las versiones de datos/comercial/stock. No asumir su causa.
3. Acordar un alcance pequeño y criterios de aceptación con el propietario.
   Candidato a evaluar: estabilidad del borrador al cambiar de artículo,
   recuperación tras error y coherencia entre modos. Esto es un candidato,
   no una funcionalidad aprobada para implementar automáticamente.
4. Preparar el diseño del incremento elegido: entradas/errores, ownership,
   concurrencia, claves idempotentes, límites de importación y transacciones.
   Reutilizar contratos, repositorios y componentes correctos. No recalcular
   ventas históricas desde precios o nombres actuales.
5. Presentar el diff o diseño concreto para autorización antes de desarrollar.
   Si hiciera falta esquema, preparar una migración aditiva offline con análisis
   de datos existentes, orden de aplicación y rollback; no ejecutarla. Solicitar
   autorización independiente para cualquier BD, migración o despliegue.
6. Tras aprobación: pruebas específicas, backend completo, frontend, navegadores,
   builds, lint y diff-check. Integración PostgreSQL solo en instancia desechable
   y después de autorizar su preparación; el E2E actual ejecuta migraciones.

## Criterios propuestos para evaluar el incremento

- Ninguna ficha, borrador, lectura o mutación accede a otro propietario.
- Cambiar de producto no arrastra movimientos/campos ni pierde datos sin aviso.
- Versiones y conflictos impiden sobrescrituras silenciosas; reintentos no
  duplican movimientos ni aplicaciones de lote.
- Stock solo cambia mediante el mecanismo de dominio vigente y autorizado.
- Entradas externas se validan; lectura/importación no escribe sin confirmación.
- Pedidos y ventas mantienen snapshots, totales y efectos de stock existentes.
- Navegación por teclado, móvil, carga/error/vacío/reintento comprobados.
- Plan de consulta medido en BD aislada antes de proponer índices adicionales.

Fuera de este plan: anonimización, fusiones de clientes, pagos, facturación,
contabilidad y cambios de política de inventario. No hay fecha ni despliegue
comprometidos. El siguiente paso es aprobar el diagnóstico y delimitar el alcance.
