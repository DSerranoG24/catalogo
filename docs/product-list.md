# Listado privado de productos

El panel usa lecturas privadas paginadas. El catálogo público y el contrato de importación no cambian. Stock sigue siendo informativo: filtrar por stock no reserva unidades ni garantiza disponibilidad.

## Contratos

Ambas rutas requieren la autenticación habitual y un `catalogId` UUID del propietario autenticado. El proxy same-origin conserva la query string. Las respuestas exitosas llevan `Cache-Control: private, no-store`.

### GET /api/products/catalog/:catalogId/list

| Parámetro | Valores | Predeterminado |
|---|---|---|
| q | Texto recortado, máximo 150 caracteres; nombre, SKU, marca o modelo | vacío |
| category | `all`, `none` o UUID de categoría | `all` |
| status | `all`, `active`, `inactive` | `all` |
| stock | `all`, `in` (> 0), `out` (= 0) | `all` |
| sort | `createdAt`, `name`, `price`, `stock`, `category` | `createdAt` |
| order | `asc`, `desc` | `desc` |
| page | Entero entre 1 y 1000000 | 1 |
| pageSize | 24, 48 o 96 | 24 |

```json
{
  "success": true,
  "products": [],
  "page": 1,
  "pageSize": 24,
  "totalProducts": 137,
  "totalFiltered": 0,
  "totalPages": 1
}
```

`products` contiene los campos privados habituales, categoría y como máximo una imagen: la primera por posición e ID, con URL firmada durante esta lectura. No requiere peticiones HTTP adicionales de imágenes por producto. Las firmas siguen teniendo la caducidad habitual de una hora; recargar renueva las URLs.

Los filtros se combinan con AND; los cuatro campos de búsqueda se combinan con OR. Las coincidencias parciales ignoran mayúsculas, conservan acentos y tratan `%` y `_` literalmente. Precio significa precio base. Categoría se ordena por nombre con los registros sin categoría al final en ambas direcciones. Todas las ordenaciones desempatan por ID ascendente.

Resultados y contadores se consultan en una transacción de lectura Repeatable Read. Una página que exceda la última disponible se ajusta a esa última página; sin resultados, página y totalPages son 1. La paginación usa skip/take; para categoría se separan las lecturas con/sin categoría para conservar NULL al final, siempre limitando el resultado al tamaño solicitado.

### GET /api/products/catalog/:catalogId/suggestions?q=texto

`q` es obligatorio, recortado, entre 2 y 150 caracteres. No admite filtros ni paginación. Busca en todo el catálogo del propietario y devuelve como máximo cinco productos:

```text
{ success: true, products: [{ id, name, sku, brand, model, categoryId, description }] }
```

Prioridad: SKU exacto, nombre exacto, prefijo en cualquiera de los cuatro campos y coincidencia parcial. Desempate por nombre e ID. No descarga imágenes ni precios para completar datos descriptivos del editor. El SQL usa parámetros vinculados y comparación literal mediante strpos.

Parámetros desconocidos, repetidos o inválidos reciben 400. Sesión ausente recibe 401; catálogo inexistente o ajeno, 404. Un fallo de consulta o firma devuelve un 500 genérico, sin detalles internos.

El GET anterior `/api/products/catalog/:catalogId` conserva su contrato durante la transición; el panel ya no lo consume. No se ha cambiado el contrato generado OpenAPI en este bloque.

## Panel y persistencia

Los ocho parámetros viven en la URL y omiten valores predeterminados. Cambiar búsqueda, filtros, orden o tamaño vuelve a página 1. La búsqueda usa debounce de 300 ms y reemplaza la entrada de historial; los demás controles añaden una entrada. Atrás/adelante y refrescar recuperan la vista. La navegación de filtros usa History API y conserva montados el workspace, su borrador y la instancia del importador.

Cada lectura del listado y de sugerencias usa AbortController y descarta respuestas canceladas. El editor busca independientemente de los filtros y página visibles. Las mutaciones y el refresco del importador recargan página y totales; una eliminación puede corregir la página sin limpiar el borrador de otro producto. La carga, error con reintento, catálogo vacío y filtro sin resultados tienen estados distintos.

## Comprobación y despliegue

Ejecutar build y test de API; lint, build, test, test:import-flow y test:import-browser del frontend. Las pruebas nuevas cubren validación, alcance por propietario, construcción de filtros/orden, frontera de categorías nulas, contadores, firma de miniaturas y sugerencias fuera de página. El navegador usa una API local simulada para probar tamaños, filtros, respuestas tardías, historial, borrador, eliminación, cuatro anchos y regresiones del importador. No equivalen a una medición con PostgreSQL y Storage reales.

No requiere dependencias, variables ni migraciones nuevas. Publicar primero la API con las rutas aditivas y después el frontend. La API nueva mantiene compatible el frontend anterior. El rendimiento de consultas PostgreSQL y firma Storage con datos reales queda para una comprobación autorizada en un entorno aislado; no se han añadido índices sin medición.
