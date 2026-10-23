# Proceso para agregar diseños de catálogo

Este proyecto separa la identidad visual de una tienda de sus datos y productos. Una plantilla recibe un `PublicCatalogTemplateProps` y presenta el mismo catálogo con otra composición. El identificador se guarda en el catálogo; no se deben duplicar productos, páginas ni rutas para crear una variante visual.

## Arquitectura

- `lib/catalogTemplates.ts` es el catálogo de opciones del selector: identificador estable, nombre, descripción, paleta y categoría. De aquí se deriva el tipo de los IDs actuales.
- `components/catalogs/CatalogSettings.tsx` muestra la tarjeta de previsualización y guarda el identificador seleccionado.
- `catalog-api/src/schemas/catalog.schema.ts` valida la lista explícita de identificadores aceptados por el servidor. La API es la frontera de confianza; no se debe aceptar cualquier texto arbitrario.
- `catalog-api/prisma/schema.prisma` almacena `template` como `String`, con `EDITORIAL` por defecto. La migración `20261023133000_catalog_template_string` convierte una sola vez la columna del enum a texto. Por eso, sumar otro diseño no exige otra migración de base de datos.
- `components/public/PublicCatalogPage.tsx` contiene el registro exhaustivo de componentes públicos. El tipo `Record<CatalogTemplateId, ...>` hace que TypeScript señale si se agrega una opción sin conectar su página.
- `components/public/PublicCatalogTemplateProps.ts` define el contrato funcional compartido por las plantillas: productos, búsqueda, filtros, paginación, carrito y categorías.
- `components/public/PublicRouteLoading.tsx`, `PublicProductDetailPage.tsx` y `PublicShoppingCartPage.tsx` también presentan el tema mientras se carga o al navegar a funciones relacionadas.

Los valores antiguos `EDITORIAL`, `GRID` y `BOUTIQUE` se normalizan a `FASHION`, `TECH` y `BEAUTY`. Esos IDs históricos se conservan para leer catálogos existentes. No se deben reutilizar ni cambiar de significado.

## Pasos para incorporar una plantilla

1. **Definir identidad y alcance.** Acordar un ID en mayúsculas, el público o rubro, la paleta, tipografía, ritmo visual y contenido del encabezado. El ID es un dato persistido: elegirlo una vez y mantenerlo estable. No incluir en él nombres de clientes ni valores que cambien por tienda.
2. **Registrar la opción.** Agregar una entrada a `catalogTemplateOptions` en `lib/catalogTemplates.ts`. El ID de esa entrada extiende automáticamente `CatalogTemplateId` y la tarjeta del selector. Preparar una vista previa que refleje de verdad la composición de la plantilla.
3. **Validar en el servidor.** Agregar el mismo ID al `z.enum` compartido por los esquemas de creación y actualización en `catalog-api/src/schemas/catalog.schema.ts`. Mantener esa lista explícita: así una petición manual no puede guardar una plantilla que la aplicación no tiene.
4. **Implementar la página.** Crear un componente bajo `components/public/` que acepte `PublicCatalogTemplateProps`. Usar los componentes existentes de toolbar, categoría, tarjeta de producto, paginación, contacto y carrito. Esto conserva búsqueda, categorías, precios, promociones, cantidades y accesibilidad entre diseños.
5. **Conectar el registro.** Añadir el componente a `templateComponents` en `PublicCatalogPage.tsx`. El mapa tipado debe tener una entrada por cada `CatalogTemplateId`; si falta una, TypeScript debe fallar durante el build.
6. **Cubrir rutas relacionadas.** Definir el color de carga en `PublicRouteLoading.tsx`; revisar la ficha y carrito para que sus fondos, acciones y estados vacíos sean legibles con la nueva paleta. Añadir normalización solo si se está manteniendo una clave antigua.
7. **Revisar comportamiento, no solo apariencia.** Probar escritorio y móvil, foco visible y contraste, catálogo vacío, sin imagen, búsqueda sin resultados, varias páginas, descuento, añadir/quitar del carrito y apertura de la ficha. Confirmar que la tarjeta seleccionada se guarda, persiste tras recargar y se ve en el enlace público.
8. **Preparar el despliegue.** Regenerar Prisma después de cambiar `schema.prisma` (`npm run prisma:generate`) y aplicar migraciones pendientes (`npm run prisma:migrate:deploy`). Las nuevas plantillas no deberían modificar el esquema; solo se migra si cambia el modelo de datos. Desplegar API y frontend con IDs compatibles.

## Reglas de mantenimiento

- No copiar el modelo de catálogo ni la lógica de pedidos para una variante visual.
- No poner datos de una marca concreta dentro de una plantilla genérica; usar el nombre, logo, descripción y contactos del catálogo.
- Mantener IDs persistidos hacia adelante compatibles. Si se retira una opción, conservar el renderizador o una normalización que permita mostrar los catálogos guardados.
- Mantener el registro de frontend exhaustivo y la lista de API explícita. La pequeña duplicación entre aplicaciones es deliberada mientras API y frontend se desplieguen por separado; ambos lados validan una frontera distinta.
- Las nuevas composiciones deben reutilizar componentes funcionales. Si una plantilla necesita una excepción, que sea una prop de presentación acotada, no una bifurcación del flujo de pedidos.
- Ejecutar generación de Prisma, build/lint y pruebas de API y navegador antes de publicar. No aplicar migraciones desde el navegador ni desde el componente del selector.

## Plantilla de revisión por diseño

- [ ] ID estable registrado en frontend y allowlist de API.
- [ ] Tarjeta de selección incluye nombre, descripción, categoría y vista previa fiel.
- [ ] Página pública implementa el contrato común y está en el registro tipado.
- [ ] Carga, ficha de producto, carrito y navegación comparten la paleta.
- [ ] Catálogo y estados vacíos funcionan en móvil y escritorio.
- [ ] Selección guardada, recarga y enlace público verificados.
- [ ] Build, lint y pruebas relevantes pasan; no hay una migración de base innecesaria.
