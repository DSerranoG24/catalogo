# Propuesta: consultar ventas vinculadas a un cliente

Estado: diseño técnico posterior al cierre de la revisión Order → Customer.
Pendiente de aprobación explícita. Este documento NO implementa endpoints,
pantallas, migraciones, consultas en producción ni modificaciones de datos.

## Problema y alcance propuesto

Las relaciones Customer–Sale ya existen y sus compradores históricos están en
snapshots, pero el vendedor no tiene una consulta paginada por cliente que reúna
las ventas explícitamente vinculadas. El siguiente incremento propuesto es una
vista privada de solo lectura: seleccionar una ficha y consultar sus ventas.

La etiqueta será «Ventas vinculadas», no «Todas sus compras». Las ventas antiguas
con customerId null quedan fuera, aunque coincidan nombre, teléfono o correo.
Order.customerId no se usará para deducir una asociación de Sale que el operador
no haya confirmado. No habrá fusiones, vinculaciones automáticas ni backfill.

No incluye métricas de ingresos, cobros, pagos, márgenes, facturación o estados
nuevos. El total registrado de una venta no se presentará como importe cobrado.

## Evidencia de arquitectura disponible

- La página existente `/dashboard/ventas` renderiza `components/sales/SalesPanel.tsx`.
- Las lecturas actuales pasan por apiRequest y el proxy same-origin HttpOnly;
  el backend usa authenticate y filtra Sale por userId.
- Sale.customerId y userId forman una FK compuesta al propietario de Customer.
  Existe índice `(customerId,userId)`, además de índices de usuario/fecha/estado.
- Los snapshots de nombre, teléfono y correo son independientes de la ficha actual.
- El módulo de clientes ofrece listado privado paginado y admite clientes archivados.

Se reutilizarán esos patrones. No se asume una página de clientes ya publicada
ni se inventa una ruta de pedidos. La propuesta se integra inicialmente en el
panel de ventas existente, mediante un bloque de consulta separado del alta.

## Contrato nuevo propuesto — no existente

`GET /api/customers/:customerId/sales?cursor=...&status=all`

Validación: customerId y cursor UUID, status uno de los estados Sale o `all`;
parámetros desconocidos/repetidos inválidos; 25 resultados por página. El cliente
puede estar activo o archivado, ya que esta operación no crea nuevas ventas.

Respuesta propuesta:

```text
{
  success: true,
  customer: { id, fullName, archivedAt },
  sales: [{ id, status, version, currency, total, createdAt,
            sourceOrderId, customerNameSnapshot, customerName }],
  nextCursor: UUID | null
}
```

No se incluirán notas, dirección, teléfono, correo, imágenes o líneas de todas
las ventas en este listado. El detalle privado existente puede ofrecer los
campos necesarios cuando se abre una venta concreta. Los importes BigInt serán
strings decimales, sin pasar por Number para formatearlos o calcular totales.

La cabecera muestra la ficha actual. La fila de venta muestra el nombre histórico:
customerNameSnapshot, con fallback al customerName antiguo, nunca al nombre actual
de Customer. Un dato histórico faltante se indica como no registrado.

Errores propuestos: 400 de consulta inválida, 401 de sesión, 404 idéntico para ficha
ajena/inexistente o cursor ajeno a la selección, 500 genérico sin datos internos.
Se definirán los identificadores exactos al aprobar el contrato. No se modificarán
las respuestas actuales de GET /sales ni de los endpoints Order → Customer.

## Autorización y consultas

1. Obtener ownerId exclusivamente de req.user.id.
2. Buscar Customer por `{ id: customerId, ownerId }`; si no existe, 404.
3. Buscar ventas por `{ userId: ownerId, customerId, status? }` en cada consulta.
4. Si hay cursor, verificar su pertenencia al mismo propietario, cliente y filtro
   antes de paginar. Nunca usar un cursor válido de otro conjunto sin comprobarlo.
5. Orden estable `createdAt DESC, id DESC`, tomar 26 filas y devolver 25 con cursor
   de la última fila devuelta si hay una más. Sin consulta por venta ni N+1.

Las dos comprobaciones de alcance y la lectura pueden usar la misma transacción
de lectura si las convenciones del módulo lo requieren. No se bloquearán filas
para escritura. Los GET no mutan versiones, claves idempotentes, stock o relaciones.
Respuestas private/no-store; autenticación, CORS, cookies y CSRF existentes intactos.
No registrar cuerpos, contactos, snapshots, identificadores completos o URLs de
consulta que puedan contener datos personales en nuevos logs.

Los registros que se vinculen o desvinculen entre páginas pueden cambiar el
conjunto visible; la UI permitirá refrescar. El cursor no promete una fotografía
transaccional duradera de la colección a través de peticiones HTTP independientes.

## Interfaz propuesta

Un bloque «Ventas vinculadas a un cliente» en la página real de ventas:

- Búsqueda y selección de cliente mediante API privada; estado activo/archivado visible.
- Botón explícito Consultar, sin invocar CREATE ni reutilizar el formulario de alta.
- Filtro de estado; por defecto `all`, con etiquetas claras para borrador/cancelada/devuelta.
- Estados carga, sin ventas vinculadas, error/reintento y paginación accesibles.
- Cambiar selección/filtro descarta cursor anterior y respuestas tardías mediante
  AbortController o versión de petición; no mezclar páginas de clientes distintos.
- Consultar una ficha archivada no la reactiva. Abrir una venta no cambia estados.
- Navegación por teclado, foco visible, labels y avisos aria-live; sin rediseño del panel.

No se agrega ninguna ruta de frontend en esta propuesta inicial. Un detalle
completo de cliente puede evaluarse después como otra mejora aprobada.

## Persistencia, compatibilidad y despliegue propuestos

Se espera reutilizar las columnas y relaciones existentes, sin migración ni datos
nuevos. Medir la consulta en PostgreSQL desechable con volumen representativo antes
de decidir si hace falta un índice que incluya fecha/id. No añadirlo por anticipado.
Si las mediciones lo justifican, preparar una migración aditiva aparte y pedir su
autorización; no tocar migraciones aplicadas ni ejecutar operaciones reales.

Prerequisito: verificar que las migraciones de Customer, snapshots y asociaciones
anteriores están aplicadas en el entorno de destino. Publicar primero la nueva
lectura backend y después la UI, solo con aprobación. La reversión de código retira
la consulta; no borra relaciones, snapshots o datos existentes. No se prevén nuevas
dependencias ni variables de entorno.

## Criterios de aceptación y pruebas previstas

- Propietario correcto, ajeno, sesión ausente/expirada y cliente inexistente.
- Cliente activo/archivado; ventas históricas sin vínculo excluidas sin inferencias.
- Todos los estados, filtros y paginación estable con fechas repetidas.
- Cursor ajeno a propietario/cliente/estado rechazado sin revelar datos.
- Cambios posteriores de Customer no alteran el nombre mostrado de la venta.
- Importes grandes conservados como strings; sin coerción insegura a Number.
- Navegador: consulta sin escrituras, vacíos, carga, error, refresco, cambio rápido
  de cliente/filtro, teclado y ausencia de mezcla de respuestas tardías.
- No más de un número fijo de consultas por página; evaluar índices con EXPLAIN
  en base aislada. Regresiones completas backend/frontend, builds, lint y diff-check.

## Decisiones pendientes de aprobación

1. Aprobar este incremento de solo lectura y su ubicación en el panel existente.
2. Aprobar que se muestren solo vínculos explícitos y todos los estados por defecto.
3. Aprobar el DTO mínimo y los errores del nuevo endpoint antes de codificarlo.
4. Mantener fusiones, duplicados deliberados y política de retención fuera de alcance.

Hasta esa aprobación no se desarrollará ni activará esta mejora.
