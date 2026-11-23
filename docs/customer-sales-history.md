# Historial privado de ventas vinculadas

Implementación local: 23 de noviembre de 2026. No se ejecutaron migraciones,
despliegues ni operaciones con datos reales. El estado inicial de Git estaba limpio.

## Acceso e interfaz

La ruta existente `/dashboard/ventas` renderiza `SalesPanel`. Se añadió un bloque
independiente «Ventas vinculadas a un cliente», separado de «Nueva venta» y de las
acciones actuales de devolución. El enlace existente «Abrir Ventas» en pedidos
convertidos sigue apuntando a esa ruta. No se creó otra página ni se rediseñó el panel.

Buscar por nombre/teléfono consulta clientes propios activos y archivados mediante
`GET /api/customers?q=...&status=all&page=1`. Hay selección explícita, paginación de
clientes, filtro de estado y botón «Consultar ventas». No se crea ni asocia nada.
Cambiar búsqueda, cliente o estado invalida resultados y peticiones anteriores.

Se muestran fecha de creación, ID completo, estado, comprador histórico y total
registrado; ese total no se etiqueta como dinero cobrado. «Ver líneas de venta»
reutiliza `GET /api/sales/:id` y muestra nombre, SKU, cantidad, precio, descuento
unitario y total de línea almacenados. No consulta productos actuales.

La cabecera identifica al cliente actual; el comprador de cada venta usa
`customerNameSnapshot ?? customerName ?? "No registrado"`. El detalle usa el helper
histórico existente para nombre/teléfono/correo y nunca sustituye snapshots por
datos del Customer actual. Importes enteros decimales se formatean con BigInt.

Se incluyen estados de carga, vacío, error y reintento para búsqueda, listado y
detalle. Los formularios tienen labels, controles nativos y avisos accesibles.
Las respuestas se validan en ejecución, incluyendo cliente/venta solicitados,
estado, cursor, tipos monetarios y líneas. Versiones de petición descartan
respuestas tardías de otra selección. Todas las llamadas del nuevo bloque son GET.

## Endpoint y contrato final

`GET /api/customers/:id/sales?status=all&cursor=<UUID>`

- Autenticación privada existente; propietario exclusivamente desde `req.user.id`.
- Cliente y cursor UUID. `status`: `all` (por defecto), `DRAFT`, `CONFIRMED`,
  `DELIVERED`, `CANCELLED`, `RETURNED`. Parámetros desconocidos/repetidos: 400.
- Clientes archivados permitidos. Solo `Sale.customerId` explícito; ni contactos
  coincidentes ni `Order.customerId` generan vínculos.
- Cliente `{id,ownerId}` y ventas `{userId,customerId,status?}` en cada lectura.
  Un cursor debe pertenecer al mismo propietario, cliente y filtro.
- Orden `createdAt DESC,id DESC`; tamaño fijo 25, lectura de 26 para detectar
  página siguiente. Límites por fecha/ID del cursor. Máximo tres consultas por
  petición (cliente, cursor opcional, listado), sin N+1 ni bloqueos de escritura.
- Página sin resultados: `sales:[]`, `nextCursor:null`. Un cursor del conjunto
  después de la última fila devuelve vacío; un cursor inexistente/ajeno: 404.
- `Cache-Control: private, no-store`.

```text
{
  success: true,
  customer: { id, fullName, archivedAt },
  sales: [{ id, status, version, currency, total, createdAt,
            sourceOrderId, customerNameSnapshot, customerName }],
  nextCursor: UUID | null
}
```

`total` es string decimal entero; fechas ISO y fechas opcionales null. El listado
no incluye contactos, notas, dirección, productos actuales ni líneas. El detalle
existente conserva su contrato `{result: sale}` y su autorización por propietario.

Errores nuevos: `INVALID_CUSTOMER_SALES_QUERY` (400),
`CUSTOMER_SALES_NOT_FOUND` (404 indistinguible para recurso inexistente/ajeno/cursor
fuera del conjunto), `CUSTOMER_SALES_FAILED` (500 genérico, sin detalles internos).
Se mantiene el middleware de autenticación y sus respuestas 401. La UI traduce
401 en una indicación de iniciar sesión otra vez. No se modifican contratos de
creación, conversión, confirmación de clientes ni inventario.

## Decisiones y límites

No hubo contradicciones con el diseño aprobado. El esquema actual no tiene
`Sale.anonymizedAt` ni un estado «venta anonimizada». No se inventó uno ni se
cambió la política de conservación: anonimizar Order no reescribe Sale. Los
campos históricos null se conservan y muestran como no registrados; canceladas y
devueltas se consultan como tales, sin mutaciones. Una política futura para
anonimizar ventas requiere definición y aprobación separadas.

No hacen falta cambios de Prisma, SQL, dependencias ni variables. Las migraciones
previas de Customer y asociaciones/snapshots deben estar aplicadas en el destino.
La nueva consulta usa los índices actuales. Queda medir EXPLAIN y tiempos con
volumen representativo en PostgreSQL aislado antes de proponer otro índice.

La paginación no es una fotografía duradera entre peticiones: cambios de estado
o vínculo pueden variar el conjunto. «Consultar ventas» y «Volver al inicio»
permiten refrescar. Un cursor que ya no pertenece al filtro debe reiniciarse.

## Verificación local

- Específicas backend: `node --require ./scripts/test.cjs --import tsx --test
  src/repositories/customer-sales.test.ts`: 7 pruebas aprobadas. Incluyen
  repositorio, servicio, HTTP con autenticación real y detalle existente, sin BD.
- Suite backend `npm.cmd test`: 329 pruebas aprobadas.
- Frontend específica `node scripts/verify-customer-sales.mjs`: aprobada;
  importes grandes, estados, campos históricos, vacíos, mezcla de identidades y
  respuestas inválidas. Registrada en `npm.cmd test`, suite completa aprobada.
- `npm.cmd run test:customer-sales-browser`: 10 grupos aprobados, Chrome local,
  Next compilado y API HTTPS simulada; 31 peticiones al doble, cero escrituras.
  Incluye fallo real de red del navegador, reintento, detalle inexistente,
  respuestas inválidas, sesiones, paginación, teclado y respuestas tardías.
- `npm.cmd run test:order-customers-browser`: 10 grupos previos aprobados.
- `npm.cmd run test:import-flow`: 22 comprobaciones aprobadas.
- Builds `npm.cmd run build` de ambos paquetes: aprobados (incluyen TypeScript).
- `npm.cmd run lint` frontend: cero errores; cuatro advertencias previas
  `no-img-element` en componentes públicos fuera del alcance.
- No existen scripts lint backend ni typecheck independiente en los paquetes.
- `git diff --check`: aprobado. Revisado estado final, sin commits.

Los dobles fallan ante consultas sin propietario o escrituras inesperadas. No
certifican planes de ejecución ni concurrencia real de PostgreSQL. No se probó
contra producción ni se desplegó. El navegador usa un perfil temporal sintético;
la opción sin sandbox del helper local no modifica la seguridad del producto.

Comprobaciones adicionales de navegador, fuera de los módulos modificados:

- `npm.cmd run test:import-browser` y `npm.cmd run test:inventory-browser`
  fallaron inicialmente en `Page.enable` de Chrome con sandbox, antes de ejecutar
  sus escenarios. Se reintentaron sin editar sus scripts, adaptando únicamente el
  proceso headless y verificando que su perfil estuviera en el temporal local.
- Importación avanzó y falló en `public-landing-without-session-or-javascript`:
  exige «Ver un ejemplo» como botón deshabilitado, mientras `app/page.tsx:57`
  actualmente lo renderiza como enlace. No hubo lecturas de API ni importaciones.
- Inventario pasó `EMPTY_AND_CREATE` y falló en `LOST_REPLY_SWITCH_AND_RETRY` con
  `draft must not leak to another product`. Su doble también devuelve 404 para
  catálogos/publicaciones y aparece una advertencia de input controlado. Requiere
  revisar por separado si el origen está en el componente o en el fixture.
- Un primer adaptador inline para inventario heredó argumentos a workers Next y
  produjo `EADDRINUSE`; se detuvo y reintentó limpiando `process.execArgv`, hasta
  obtener el fallo de escenario anterior. No se modificó código de inventario.
- Estos fallos ocurren en rutas/componentes y scripts sin cambios en este diff;
  no ejecutan el nuevo bloque ni su endpoint. No se ocultan como pruebas pasadas
  y no se corrigieron ampliando el alcance a importación/inventario.
- No se ejecutó `test:inventory-e2e` ni verificaciones PostgreSQL: el script E2E
  aplica migraciones, prohibidas en esta tarea. No se hicieron conexiones a BD.

El generador OpenAPI se ejecutó con el preload Windows del proyecto por el fallo
conocido `uv_os_get_passwd` de tsx. Se incorporaron únicamente el nuevo endpoint y
su esquema; se conservaron los esquemas publicados ajenos a esta tarea, ya que
el generador también produce diferencias previas no relacionadas.

## Archivos y siguiente paso

Backend: nuevos `customer-sales.schema.ts`, `customer-sales.repository.ts`,
`customer-sales.service.ts`, `customer-sales.controller.ts`,
`repositories/customer-sales.test.ts`; actualizados `routes/customer.routes.ts`,
`scripts/test.cjs`, `src/scripts/generate-openapi.ts` y `openapi.json`.

Frontend: nuevo `components/sales/CustomerSalesHistory.tsx`,
`lib/customer-sales.mjs`, `lib/customer-sales.d.mts`,
`scripts/verify-customer-sales.mjs`, `scripts/verify-customer-sales-browser.mjs`;
actualizados `components/sales/SalesPanel.tsx` y `package.json`.

Documentación: este informe y estado actualizado de
`customer-sales-history-design.md`.

Siguiente paso recomendado: revisión funcional en un entorno aislado con datos
sintéticos y medición de la consulta. Publicar backend antes que frontend solo
tras autorización específica. No se avanzó a contabilidad, fusiones ni otra mejora.
