# Historial privado de ventas vinculadas

Implementación local: 23 de noviembre de 2026. No se ejecutaron migraciones,
despliegues ni operaciones con datos reales. El estado inicial de Git estaba limpio.

## Cierre de validación: aprobación parcial

Resultado desplegado comunicado por el propietario durante este cierre; no es una
prueba ejecutada por el agente ni una nueva inspección de producción. Se aprobó
parcialmente el flujo básico: acceso a `/dashboard/ventas`, búsqueda sin resultados,
selección explícita, cliente sin ventas, creación de borrador asociado, consulta
del vínculo, comprador/teléfono/correo/total históricos y apertura del detalle
privado. Se confirmó la protección de la asociación explícita.

Quedó una venta sintética, identificada por el usuario con el prefijo `fb13793c`,
cliente de prueba «Prueba Cliente Vitrinaya Editado», estado `DRAFT`, total $0 y
sin líneas. No se obtuvo ni se dedujo su UUID completo ni su propietario; no se
consultó, canceló o eliminó durante esta tarea. Su retirada sigue pendiente.

Limitaciones de la prueba desplegada que permanecen abiertas:

- No se recorrieron más de 25 ventas reales.
- No se consultó un cliente archivado.
- No se abrió una venta con varias líneas históricas reales.
- No existe acción visible para cancelar o eliminar un borrador.
- Sigue pendiente EXPLAIN/medición con volumen representativo en PostgreSQL aislado.

La cobertura automatizada de abajo reduce riesgo, pero no convierte estos casos
en validaciones desplegadas. El estado de aceptación permanece **parcial**, sin
autorizar nuevas publicaciones ni operaciones sobre datos reales.

### Retirada administrativa del dato sintético — no ejecutada

La inspección de `sales.routes.ts`, `sale.service.ts` y Prisma confirmó que no hay
endpoint DELETE de ventas, columna de archivado ni herramienta administrativa
de retirada en este repositorio. El endpoint de cancelación existente rechaza
`DRAFT` con `INVALID_TRANSITION`. No debe llamarse para esta venta, ni confirmar
el borrador para luego cancelarlo, ni parchear su estado por SQL como atajo.

Si se exige eliminación del dato sintético, hace falta una intervención de datos
excepcional de un administrador/DBA, revisada y autorizada aparte; no es una
operación del contrato público/privado actual. Procedimiento a preparar:

1. Obtener el UUID completo y propietario desde un contexto administrativo
   autorizado; verificar el entorno. Nunca ejecutar contra un prefijo o nombre.
2. Respaldar de forma restringida la venta y sus dependencias y registrar la
   autorización/ticket sin copiar contactos personales a logs o al repositorio.
3. En una única transacción, bloquear y volver a verificar exactamente esa venta
   y propietario: sigue siendo sintética, `DRAFT`, total/subtotal/descuento cero,
   sin líneas, movimientos, devoluciones ni pedido origen. Revisar también
   `SaleOperation` y referencias en `OrderCustomerOperation.associatedSaleId`.
4. El alta genera al menos una `SaleOperation`; una eliminación directa de Sale
   puede fallar por `ON DELETE RESTRICT`. El script revisado debe identificar
   todas las dependencias con el esquema efectivo. Solo si son exclusivamente
   recibos de alta de esta prueba y no existe otra historia o asociación, retirar
   esos recibos y la venta de forma atómica, con conteos esperados exactos. Ante
   cualquier dependencia adicional o cambio concurrente, abortar sin cascadas,
   sin desactivar restricciones y sin modificar inventario, pedidos o Customer.
5. Verificar integridad, conservar el registro administrativo de retirada y
   confirmar la transacción únicamente con la autorización específica acordada.
   Antes del commit, rollback completo; después, recuperación desde el respaldo
   restringido mediante otro procedimiento autorizado.

No se entrega SQL ejecutable con un ID incompleto ni se declara esta excepción
como política de borrado de ventas. Hasta contar con revisión, identificación y
autorización, la venta debe permanecer intacta. Cancelar, si se habilita en otra
fase, conservaría historia; no equivaldría a eliminarla ni a ocultarla de «Todos».

### Cobertura adicional y resultados de este cierre

No se cambió código funcional, esquema, endpoints ni contratos. Se reforzaron
pruebas existentes en lugar de duplicar escenarios ya cubiertos:

- Repositorio/servicio: 55 ventas en páginas exactas `25/25/5`, sin repeticiones,
  fechas empatadas, cursor inexistente/ajeno y cursor de otro estado; vacío real,
  todos los filtros y aislamiento por propietario.
- HTTP: cliente archivado con ventas canceladas, fecha de archivo preservada,
  filtro aplicado y cursor ajeno rechazado con el error aprobado.
- Detalle: dos líneas con nombres/SKU/cantidades/descuentos/precios y totales
  históricos exactos, incluyendo BigInt grande; snapshots de nombre/teléfono/
  correo diferentes de la ficha actual e intactos al volver a editarla. El doble
  rechaza lecturas del inventario actual y escrituras inesperadas.
- Frontend: validación de detalle con varias líneas y snapshots completos,
  transición de cursor válido y conservación de strings monetarios.
- Navegador local: 27 ventas distintas en dos páginas `25/2`, sin mezcla entre
  páginas, cliente archivado con ventas, dos líneas históricas y contactos del
  comprador original; siguen los casos vacío, errores, filtros, reintento y
  respuestas tardías. 11 grupos, 36 peticiones al doble, cero escrituras.

Comandos de cierre: específicas backend (7 aprobadas), `npm.cmd test` backend
(329 aprobadas), específica frontend y `npm.cmd test` frontend (aprobadas),
`test:customer-sales-browser` (11 grupos aprobados), builds backend/frontend
(aprobados), lint frontend (0 errores, 4 advertencias previas), `git diff --check`.
`test:order-customers-browser` volvió a aprobar sus 10 grupos y `test:import-flow`
sus 22 comprobaciones. `test:import-browser` y `test:inventory-browser` volvieron
a fallar en `Page.enable` con sandbox. Sus reintentos mediante adaptador temporal
en memoria, solo para perfiles headless temporales y sin modificar los scripts,
reprodujeron los fallos anteriores: importación exige un botón «Ver un ejemplo»
que ahora es enlace; inventario falla en `LOST_REPLY_SWITCH_AND_RETRY` con
`draft must not leak to another product`. No se corrigieron esos módulos aquí.
El E2E con PostgreSQL no se ejecutó porque aplica migraciones; tampoco se realizó
la medición pendiente. No hay scripts lint backend/typecheck independiente.
El apartado histórico «Verificación local» conserva la evidencia anterior y no
implica que toda la batería fuera aprobada.

Archivos del cierre: `src/repositories/customer-sales.test.ts` (backend),
`scripts/verify-customer-sales.mjs` y `scripts/verify-customer-sales-browser.mjs`
(frontend), este informe y el plan separado
[inventory-expanded-next-phase-plan.md](inventory-expanded-next-phase-plan.md).

Recomendación de cierre: mantener aceptación parcial hasta verificar con datos
sintéticos controlados los tres casos desplegados pendientes, medir PostgreSQL
aislado y acordar/ejecutar la retirada administrativa autorizada del borrador.
Los fallos de navegadores de otros módulos deben seguir identificados como
pendientes separados. No se implementó inventario ni una política de anonimización.

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
