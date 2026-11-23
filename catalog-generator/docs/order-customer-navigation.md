# Acceso real a pedidos y revisión del comprador

## Ruta y navegación existentes

El panel no tiene una página independiente de pedidos: se renderiza dentro de
`/dashboard/catalogos/[catalogId]`, en la pestaña **Órdenes** de cada catálogo.

1. Abrir `/dashboard`, que renderiza `app/dashboard/page.tsx`.
2. Pulsar **Abrir panel** en la tarjeta del catálogo. El Link ya apunta a
   `/dashboard/catalogos/${catalog.id}` (también existe en catálogos archivados).
3. `app/dashboard/catalogos/[catalogId]/page.tsx` recibe el ID real y renderiza
   `CatalogWorkspace`.
4. En `components/catalogs/CatalogWorkspace.tsx`, pulsar **Órdenes** dentro de
   `nav[aria-label="Secciones del catálogo"]`. Esa pestaña cambia el estado local
   `activeTab` a `orders` y monta `OrdersPanel catalogId={catalogId}`.
5. En un pedido permitido, pulsar **Guardar comprador como cliente**. Se abre
   `OrderCustomerReview`: previsualización, corrección de datos, Crear cliente,
   Usar cliente existente ante coincidencias y Cancelar. La casilla de asociar
   también la venta aparece solo si la previsualización informa una venta existente.

La pestaña es estado del componente, no una ruta ni un parámetro de URL: al
recargar la página vuelve a Productos. La cabecera de `app/dashboard/layout.tsx`
ya tiene el enlace de marca a `/dashboard`, Inventario y Cuenta. No se agregó un
enlace global sin catálogo porque los pedidos se consultan por catálogo.
No se crearon rutas, aliases, redirects, deep links ni nuevos parámetros de pestaña.

## Qué se corrigió

La navegación y el flujo de revisión ya estaban conectados. Faltaba ocultar la
acción en pedidos sin datos mínimos. `canReviewOrderCustomer` ahora exige estado
PENDING/CONFIRMED/COMPLETED, ausencia de anonimización, nombre no vacío tras trim
y al menos siete dígitos de teléfono. Correo/dirección/notas son opcionales y no
ocultan la acción. El teléfono todavía puede corregirse en la revisión; el alta
sigue sometida al contrato completo del servidor (incluidos normalización y límites).

La propiedad no se decide con metadata de localStorage: la API privada verifica
el catálogo/propietario y filtra cada pedido. Si deniega el catálogo, no se monta
el panel de pedidos. Esta condición se comprueba también en el navegador con un
catálogo simulado ajeno que devuelve 404. No se añadió un filtro de dueño inventado
a un DTO que no publica ese campo.

No se reescribió OrderCustomerReview. Se conservan sus endpoints privados,
validaciones, CUSTOMER_PHONE_MATCH/CUSTOMER_NOT_FOUND/CUSTOMER_ARCHIVED,
confirmación explícita, UUID estable para reintentos y lista permitida de campos.
La previsualización solo hace POST de `{}` al endpoint de lectura: no confirma
ni crea nada. Editar y cancelar tampoco envían confirmación.

## Despliegue: evidencia y límite

`next.config.ts` no define rewrites ni redirects para pedidos. No hay un
`vercel.json`, middleware o proxy de navegación alternativo en este frontend;
el proxy `/api/backend/[...path]` es transporte privado de API, no una página.
El build local incluye `/dashboard/catalogos/[catalogId]` y el navegador prueba
esa página compilada entrando desde el dashboard, sin saltar directamente al panel.

Esto acredita la ruta del código y build locales, no la versión remota desplegada.
La guía `docs/despliegue.md` indica que hay que comparar commit, proyecto y alias
efectivos en Vercel. No se recibió un despliegue remoto identificable ni se leyó
configuración remota o información privada de producción. No se afirma que el
frontend desplegado tenga el mismo commit ni una ruta distinta; verificarlo queda
como comprobación operativa separada, sin usar producción para pruebas.

## Pruebas reproducibles

Desde catalog-generator:

```text
npm.cmd run build
npm.cmd run test:order-customers-browser
npm.cmd test
npm.cmd run lint
```

Desde catalog-api: `npm.cmd test` y `npm.cmd run build`. Desde raíz:
`git diff --check`. No se ejecuta ninguna migración ni servidor backend real.

`verify-order-customer-browser.mjs` usa el helper existente de panel privado,
Next compilado en localhost:4338, una API HTTPS simulada en 127.0.0.1:4339 y Chrome
headless con perfil temporal aislado. No se conecta a cuentas ni bases reales.
Los certificados y la sesión son exclusivamente sintéticos; no se registran sus
valores. No iniciar otro verificador que use esos puertos a la vez.

En este entorno Windows restringido, Edge y Chrome con sandbox agotaban el tiempo
de `Runtime.enable` antes de cargar la aplicación: no eran fallos de sus pruebas
funcionales. El helper permite seleccionar Chrome y desactivar el sandbox solo
para este perfil temporal de pruebas (`browser: "chrome", sandbox: false`). Las
opciones anteriores siguen siendo el valor por defecto para otros verificadores;
no cambian cookies, CORS, TLS, autenticación ni configuración del producto.

El navegador comprueba:

- Navegación real por teclado desde Abrir panel y selección de Órdenes.
- Acción visible para comprador válido y datos opcionales ausentes; oculta para
  cancelados, anonimizados y nombre/teléfono insuficientes.
- Previsualización sin escrituras; edición y cancelación sin confirmación.
- Coincidencia telefónica con botones explícitos; errores de cliente ausente y
  archivado visibles sin crear ni asociar automáticamente.
- Selección explícita de cliente y casilla de venta inicialmente desmarcada.
- Edición de los cinco campos y reintento de una respuesta perdida con exactamente
  el mismo comando y operationId, sin duplicar el cliente en el doble.
- Solo se envían los campos permitidos: no snapshots, owner/userId, precios,
  cantidades, stock ni estados; los datos originales del pedido permanecen intactos.
- Catálogo ajeno denegado: no se consultan sus pedidos ni aparecen acciones.

`verify-order-customer-review.mjs`, incluido en `npm test`, cubre además las
condiciones de visibilidad y validación de respuestas. El navegador usa un doble
de API: no certifica concurrencia SQL ni la configuración remota de producción.

Verificación local del 23 de noviembre de 2026: tests frontend correctos, siete
grupos de navegación/interacción aprobados en Chrome headless con API simulada,
suite backend 317/317 y builds de ambos paquetes correctos. Lint frontend sin
errores, con las cuatro advertencias previas de img; `git diff --check` correcto.
No hay scripts independientes de typecheck ni lint backend; ambos builds
comprobaron TypeScript. No se cambió el backend ni el esquema de base de datos.
