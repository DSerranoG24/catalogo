# Revisión del flujo privado Order → Customer

Revisión local cerrada el 23 de noviembre de 2026. Git estaba limpio al inicio.
Se inspeccionaron esquema, rutas, controladores, servicios, repositorios, contrato
Customer, privacidad, componente de revisión, parsers y pruebas unitarias/HTTP/navegador.
No se cambiaron contratos de API, modelos, migraciones ni reglas de negocio.

## Recorrido e invariantes verificados

El recorrido real sigue siendo `/dashboard` → Abrir panel del catálogo →
`/dashboard/catalogos/[catalogId]` → Órdenes → Guardar comprador como cliente.
Los tres endpoints están conectados a la interfaz:

| Endpoint privado | Consumidor | Verificación |
| --- | --- | --- |
| POST customer-preview | Abrir revisión | Cuerpo `{}`, sin escrituras, carga y error recuperables |
| GET customer-matches | Paginación/actualización | Teléfono y página validados, resultados vacíos o incorrectos controlados |
| POST customer-confirm | Crear cliente/Usar existente | Solo acción explícita; payload permitido y operationId conservado al reintentar |

El servidor sigue obteniendo ownerId de la sesión y autoriza el pedido por su
catálogo. Customer se filtra por ownerId; la venta, por userId y sourceOrderId.
Se rechazan pedidos ajenos, inexistentes, cancelados o anonimizados, fichas
archivadas y relaciones incompatibles. La asociación opcional no crea otra venta
ni cambia estados, stock, importes, snapshots o campos históricos libres.

La previsualización no crea una sesión persistente ni un cliente. La revisión
editable no sobrescribe el pedido. Elegir una ficha existente no la fusiona ni
aplica los campos del formulario a esa ficha. La anonimización retira los vínculos
y operaciones correspondientes; esa protección se conservó y se volvió a probar.

## Problemas encontrados y cambios

### 1. Se perdían coincidencias al editar campos ajenos al teléfono

Causa: `edit()` limpiaba la lista, página y teléfono de coincidencia para cualquier
campo. Reproducción antes de corregir: el navegador recibió CUSTOMER_PHONE_MATCH,
editó el nombre y falló al comprobar que la ficha coincidiente seguía visible.
El backend impedía el duplicado, pero la interfaz volvía a ofrecer Crear cliente.

Corrección: conservar coincidencias al editar nombre, correo, dirección y notas,
o cambiar solo el formato del mismo teléfono. Solo cambiar sus dígitos reinicia
la búsqueda. Una guarda en el submit también impide CREATE mientras haya una
coincidencia conocida o una ficha previamente guardada, incluso si se dispara
el evento de formulario sin utilizar el botón habilitado.

### 2. Respuestas de coincidencias insuficientemente verificadas

La página recibida no se contrastaba con la solicitada ni se verificaba que las
fichas correspondieran al teléfono consultado. Se aceptaban IDs repetidos y una
respuesta CUSTOMER_PHONE_MATCH sin fichas podía dejar disponible otro intento
de CREATE sin una revisión válida.

Corrección: validar página, booleano hasMore, teléfono, IDs únicos y estructura
de las fichas. Rechazar combinaciones imposibles como lista vacía con hasMore.
La previsualización valida también la correspondencia de existingCustomer con
customerId. Un conflicto de teléfono vacío o inválido bloquea confirmar hasta
cancelar y obtener una nueva revisión; no se inventa una ficha ni se selecciona una.
Si falla una página posterior se mantiene la última lista válida.

### 3. Estados vacíos sin una recuperación clara

Una página posterior vacía carecía de explicación y no había una actualización
directa de coincidencias. Si todas las fichas activas desaparecían, el teléfono
guardado en el estado seguía bloqueando CREATE hasta cerrar el formulario.

Corrección: mostrar el estado vacío y conservar Anterior; añadir Actualizar
coincidencias reutilizando GET existente. Si la primera página ya no tiene fichas,
informar al vendedor y permitir que pulse Crear cliente nuevamente. Refrescar
jamás envía confirmación y el backend siempre vuelve a comprobar coincidencias.

### 4. Una excepción local podía dejar bloqueada la confirmación

La generación de operationId estaba después de activar busy/lock y antes del
try/finally. Una excepción de crypto.randomUUID no liberaba esos estados.

Corrección: preparar comando y UUID dentro del try, mostrar un mensaje comprensible
si falla y ejecutar siempre finally. Una prueba de navegador inyecta ese fallo y
comprueba que Cancelar sigue disponible y no se envía ninguna confirmación.
Los reintentos de peticiones ya enviadas conservan exactamente su UUID y comando.

No se encontró un fallo reproducible que requiriera cambiar el backend de
producción. Se añadieron pruebas de casos de aislamiento, concurrencia simulada,
conflictos y normalización que faltaban en su cobertura.

## Política de coincidencias conservada

El contrato aprobado rechaza CREATE cuando existe una ficha activa propia con
el mismo teléfono normalizado. Las opciones son usarla explícitamente, corregir
el teléfono o cancelar. Crear una ficha nueva sigue siendo explícito y vuelve a
validarse en servidor; no se habilitó una excepción para duplicar deliberadamente
el mismo teléfono. Eso requeriría una decisión de producto y un contrato nuevo.
El alta general de clientes conserva su regla previa de advertencia sin unicidad
global; esta revisión no cambia ese comportamiento ni las reactivaciones.

## Archivos modificados

- `catalog-generator/components/catalogs/OrderCustomerReview.tsx`: correcciones de estado y recuperación.
- `catalog-generator/lib/order-customer-review.mjs` y `.d.mts`: validadores y comparación del teléfono.
- `catalog-generator/scripts/verify-order-customer-review.mjs`: regresiones de parsers y respuestas vacías.
- `catalog-generator/scripts/verify-order-customer-browser.mjs`: regresiones de interacción y los tres endpoints.
- `catalog-api/src/repositories/order-customer.test.ts`: cinco grupos backend adicionales.
- Este informe y el [diseño técnico propuesto](customer-sales-history-design.md), que no está implementado.

## Pruebas ejecutadas

Desde catalog-api:

```text
node --require ./scripts/test.cjs --import tsx --test src/repositories/order-customer.test.ts src/repositories/order-privacy.test.ts
npm.cmd test
npm.cmd run build
```

Resultados: 27/27 específicas con privacidad; 322/322 en la suite completa;
build correcto con TypeScript. Se verificaron claves distintas sobre un mismo
pedido, reintentos equivalentes tras normalizar, conflictos sin consumir clave,
claves iguales de propietarios distintos, venta ajena, asociación repetida sin
incremento de versión ni duplicación y permisos/validaciones de paginación.

Desde catalog-generator:

```text
npm.cmd test
npm.cmd run build
npm.cmd run test:order-customers-browser
npm.cmd run lint
```

Todos correctos. El navegador aprobó diez grupos: navegación real, visibilidad,
previsualización sin writes, cancelación, coincidencias y errores, asociación
explícita, reintento tras respuesta perdida, paginación/carga/vacíos, errores de
preparación local y bloqueo ante respuesta inválida. El lint no tiene errores;
mantiene cuatro advertencias previas de img en archivos ajenos al cambio.
No hay scripts separados de typecheck ni lint backend: ambos builds comprueban
TypeScript. `git diff --check` correcto.

## Límites y riesgos pendientes

- Backend: dobles transaccionales/HTTP local; las llamadas concurrentes se
  serializan en el doble. No equivalen a verificar locks, FK, rollback y carreras
  entre todos los escritores contra PostgreSQL real.
- Navegador: Next compilado + API HTTPS simulada en loopback, Chrome con perfil
  temporal. No hay cuentas, cookies, clientes ni base reales. No se certifican
  despliegue remoto, Safari/Firefox o auditoría humana con lector de pantalla.
- Los índices y migraciones anteriores deben ensayarse y aplicarse por el operador
  antes de publicar una versión que dependa de ellos. Esta revisión no agregó ni
  ejecutó migraciones y no realizó commits o despliegues.
- Unicidad global de teléfonos, fusiones y retención/anonimización integral de
  Customer y compradores históricos siguen siendo decisiones separadas.

Siguiente paso recomendado: ensayo de los flujos y bloqueos en PostgreSQL
desechable, sin datos reales, antes de una publicación autorizada. Después puede
aprobarse el diseño de consulta de ventas vinculadas; no se activó esa mejora.
