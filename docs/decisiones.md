# Decisiones del proyecto

Decisiones vigentes al 25 de octubre de 2026. Cambiarlas requiere revisar sus consumidores y consecuencias; esta guía documenta el comportamiento actual, no autoriza operaciones.

| Decisión | Motivo y consecuencia | Referencia |
|---|---|---|
| Precios e instantáneas en servidor | El cliente no determina importes. El pedido conserva productos y precios del momento de compra; cambios posteriores no lo recalculan. | [Cálculo de pedidos](../catalog-api/src/services/order-calculation.ts) |
| Inventario informativo y no bloqueante | El pedido es una solicitud que el vendedor confirma. Stock no se reserva ni descuenta y no garantiza disponibilidad. No hay pago integrado. | [Pedidos e inventario](../catalog-api/README.md#decisiones-de-pedidos-e-inventario) |
| Historial de pedidos conservado | Borrar un catálogo con pedidos destruiría información transaccional. El servicio lo impide y la FK aplica RESTRICT como defensa de base de datos. | [Repositorio](../catalog-api/src/repositories/catalog.repository.ts), [migración](../catalog-api/prisma/migrations/20261024034223_restrict_catalog_delete/migration.sql) |
| Retención provisional de 12 meses | Se prevé anonimizar tras 12 meses desde la última actualización, conservando información transaccional no identificable. Pendiente de revisión jurídica y de automatización; debe incluir instantáneas y enlaces PDF. | [Política provisional](../catalog-api/README.md#decisiones-de-pedidos-e-inventario), [PDF](quotations.md#descarga-y-privacidad) |
| Idempotencia por catálogo y clave | Reintentos de red recuperan el recibo persistido sin crear otro pedido ni recalcular precios. No compara un hash del nuevo cuerpo: reutilizar la misma clave con otros datos no crea una compra distinta. Una compra nueva requiere otra clave. | [Contrato](../catalog-api/docs/order-idempotency.md), [repositorio](../catalog-api/src/repositories/order.repository.ts) |
| Pedido separado de cotización | Un fallo de configuración, emisión o formato no debe deshacer una compra ya persistida. Dos transacciones: primero pedido; después intento de emisión esperado, con HTTP 201 y cotización nula si falla. | [Emisión](quotations.md#emisión) |
| Instantánea al emitir exitosamente | Se congelan datos comerciales y fecha reales de emisión. Un reintento posterior usa las condiciones de ese momento; no inventa datos históricos. El logo es deliberadamente el actual, no parte de la instantánea histórica. | [Cotizaciones](quotations.md#emisión) |
| Token de acceso al PDF | El comprador puede compartir el documento sin cuenta. El enlace concede acceso a datos personales, no caduca a los 15 días de validez comercial y deja de autorizar al cancelar. | [Descarga y privacidad](quotations.md#descarga-y-privacidad) |
| Plan firmado para importar | Detecta conflictos entre lotes y vincula usuario, catálogo, contenido y versiones sin tabla temporal ni estado de proceso. No es un recibo durable: una respuesta perdida exige revisar y previsualizar resultados desconocidos. | [Plan](product-import.md#vista-previa-completa-y-conflictos-entre-lotes), [reintentos](product-import.md#fallos-y-reintentos) |
| Códigos y fechas Excel como texto | Excel puede perder ceros, precisión o significado. No se reconstruyen números ni fórmulas; se rechazan y se explica cómo corregir el archivo. | [Lector](../catalog-generator/docs/product-import-reader.md) |
| Sin caché persistente pública | Prioriza publicación vigente y revocación por archivado. Cada petición comprueba la API; una caché futura necesitaría invalidación coordinada. | [SEO y caché](../catalog-generator/docs/public-seo.md#imagen-estable) |
| Migraciones fuera del arranque | Evita competir por aplicar esquema al iniciar instancias. Un responsable autorizado migra antes del despliegue dependiente, con respaldo y verificación. | [Migraciones](migrations.md#orden-del-despliegue) |

## Ciclo de vida del catálogo

`active` y `archivedAt` son controles distintos. La lectura pública exige `active: true` y `archivedAt: null`; desactivar o archivar retira el catálogo público. Archivar asigna fecha sin borrar datos ni cambiar automáticamente `active`.

Reactivar elimina `archivedAt`; no fuerza `active` a true. Por tanto, un catálogo previamente inactivo permanece fuera de publicación hasta activarlo. El propietario conserva acceso privado al historial; importación y nuevas compras rechazan catálogos archivados. Un catálogo inactivo pero no archivado puede seguir editándose privadamente.

Con pedidos, el borrado físico se rechaza. Sin pedidos, la ruta privada permite borrar el catálogo y aplica las relaciones de borrado definidas en el esquema; no debe confundirse con archivar ni prometer limpieza completa de objetos Storage.

Archivar no revoca las cotizaciones anteriores: el PDF comprueba su token, pertenencia y estado del pedido, no la publicación actual del catálogo. Cancelar el pedido sí revoca nuevas descargas. Implementación: [catálogos](../catalog-api/src/repositories/catalog.repository.ts), [esquema](../catalog-api/prisma/schema.prisma) y [cotizaciones](quotations.md#descarga-y-privacidad).
