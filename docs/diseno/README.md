# Diseño: inicio de sesión y logo (noviembre de 2026)

Maquetas aprobadas, que mandan en lo visual: [escritorio](login-escritorio.png) y [móvil](login-movil.png).

Implementación:
- Pantalla: `catalog-generator/app/login/page.tsx`.
- Decoración: `catalog-generator/components/auth/LoginDecor.tsx`, con las ondas y el subrayado. Toda la decoración es `aria-hidden` y no tiene animación.
- Logo: `catalog-generator/components/brand/BrandLogo.tsx` y `catalog-generator/public/brand/icon*.svg`.

Comprobación: `npm.cmd run test:login-browser`, desde `C:\` en mayúscula. Comprueba campos, atributos, modos, Google, alerta de error, orden de teclado, contraste, objetivos táctiles y desbordamiento entre 320 y 1440 px. Con `LOGIN_SCREENSHOTS=<carpeta fuera del repo>` guarda capturas a 375 y 1440 px.

## Tokens `--vy-*`

Se **añadieron** a `catalog-generator/app/globals.css` sin sustituir ningún token existente (`--brand-*`, `--surface-*`, etc.). Por ahora solo los usan `/login` y `BrandLogo`; el resto de la app conserva su paleta verde.

| Token | Valor | Uso | Contraste medido |
| --- | --- | --- | --- |
| `--vy-navy-900` | `#011C4F` | Inicio del degradado del panel de marca | Blanco 16,4:1 |
| `--vy-navy-700` | `#002971` | Tramo medio del degradado | Blanco 13,5:1 |
| `--vy-blue-700` | `#0341BD` | Hover del botón principal | Blanco 8,42:1 |
| `--vy-blue-600` | `#0450E5` | Botón principal, pestaña activa, enlaces, «ya» del logo en claro | Blanco sobre él 6,39:1; él sobre blanco 6,39:1 |
| `--vy-blue-500` | `#0760ED` | Círculos de los iconos de los puntos clave | Blanco 5,38:1 |
| `--vy-blue-400` | `#178DFF` | «en orden.» y «ya» del logo sobre oscuro | Sobre navy-900 4,91:1; sobre navy-700 4,04:1 (texto grande, mínimo 3:1) |
| `--vy-blue-100` | `#DCE6FF` | Texto de apoyo sobre el panel oscuro | Sobre navy-700 10,8:1 |
| `--vy-page` | `#E3EBFE` | Fondo exterior | — |
| `--vy-surface-soft` | `#F1F4FA` | Pestaña inactiva | — |
| `--vy-text` | `#0B1B3F` | Títulos y etiquetas | Sobre blanco 16,9:1 |
| `--vy-text-muted` | `#4A5878` | Subtítulo, pestaña inactiva, nota de la cookie | Sobre blanco 7,10:1; sobre `--vy-surface-soft` 6,44:1 |
| `--vy-text-subtle` | `#5A6785` | Placeholders y «(opcional)» | Sobre blanco 5,66:1 |
| `--vy-border` | `#CBD5E6` | Separadores y borde del grupo de pestañas (decorativos) | 1,48:1, sin función de identificación |
| `--vy-field-border` | `#8592AD` | Borde de los campos | Sobre blanco 3,13:1 (mínimo para controles: 3:1) |

## Logo «V de 2 barras»

- `icon.svg` (fondo claro): las barras exteriores en `#0450E5` (6,39:1 sobre blanco) y la barra interior, más clara, en `#2E7CF6` (3,94:1).
- `icon-dark.svg` (fondo oscuro): las exteriores en `#2F7BFF` (4,22:1 sobre navy-900) y la interior en `#7DB4FF` (7,69:1).
- `viewBox` de 96×96 y tres paralelogramos planos que forman «V/». Las barras miden unos 3 px a 16 px de tamaño y siguen separadas.
- El wordmark es «Vitrinaya», con V mayúscula y peso 700. «ya» va en `--vy-blue-600` sobre claro y en `--vy-blue-400` sobre oscuro, y el resto en `--vy-text` o blanco. Ya no usa el coral.
- La API de `BrandLogo` no cambia (`variant`, `theme`, `iconSize`, `nameRatio`, `gapSize`, `className`), y sigue siendo un `role="img"` con `aria-label="Vitrinaya"`.
- Consumidores afectados: `/login`, la cabecera del panel (`app/dashboard/layout.tsx`) y la cabecera y el pie de la página de inicio (`app/page.tsx`).
- El favicon (`app/icon.svg`) no se cambió: quedó fuera de alcance.

## Armazón del panel (menú lateral, cabecera y barra móvil)

Referencia visual: `inicio-escritorio.png`, la maqueta de Inicio. Pendiente de copiar a esta carpeta. De ella se implementan el menú, la cabecera y la pantalla de Inicio descrita en la sección siguiente.

**Rutas del panel en `main` (25/11/2026):**

| Ruta | Pantalla |
| --- | --- |
| `/dashboard` | Inicio (mínimo) |
| `/dashboard/ventas` | Vender |
| `/dashboard/inventario`, `/hoja`, `/lotes` | Inventario |
| `/dashboard/catalogos` | Lista de catálogos (antes en `/dashboard`) |
| `/dashboard/catalogos/nuevo`, `/dashboard/catalogos/[id]` | Crear catálogo y espacio de trabajo |
| `/dashboard/cuenta` | Ajustes (la página de cuenta existente) |

**Configuración:** `catalog-generator/lib/panel-navigation.ts`, `PANEL_NAVIGATION`. Cada entrada tiene `id`, `label`, `href`, `icon` (lucide), `group`, `enabled` y `mobileBar`.

| Entrada | Grupo | Ruta | Habilitada | Barra móvil |
| --- | --- | --- | --- | --- |
| Inicio | — | `/dashboard` | Sí | Sí |
| Vender | Día a día | `/dashboard/ventas` | Sí | Sí |
| Inventario | Productos | `/dashboard/inventario` | Sí | Sí |
| Catálogo | Productos | `/dashboard/catalogos` | Sí | No (va en «Más») |
| Gastos | Dinero | `/dashboard/gastos` | Sí (F1a y F1b) | No (va en «Más») |
| Ajustes | Análisis | `/dashboard/cuenta` | Sí | No (va en «Más») |

- Servicio técnico, Cartera y Reportes no tienen ruta y no figuran en la configuración.
- Los grupos sin entradas habilitadas no se muestran.
- Apagar un módulo es cambiar `enabled`, sin tocar el layout.
- Inicio solo está activo en `/dashboard`; el resto también en sus subrutas.

**Comportamiento:**
- **Escritorio (≥ lg):** menú lateral fijo de 256 px con degradado `--vy-navy-900` → `--vy-navy-700`.
  - La entrada activa va en `--vy-blue-600` con `aria-current="page"`.
  - Al pie, una tarjeta decorativa sin enlaces.
- **Cabecera:**
  - Menú de avatar con la inicial del nombre o, si no hay nombre, del correo. Al abrirlo muestra nombre y correo, «Ajustes» y «Cerrar sesión». Escape lo cierra y devuelve el foco; también se cierra al hacer clic fuera.
  - Botón «Nueva venta» que lleva a `/dashboard/ventas`. Se oculta en Vender y en Inicio, que ya tiene el suyo, y en móvil, donde Vender está en la barra.
- **Móvil (< lg):** cabecera con el logo y el avatar, y barra inferior fija con Inicio, Vender, Inventario y «Más».
  - «Más» abre una hoja (Radix Dialog, con foco atrapado y Escape) con el resto de entradas y «Cerrar sesión».
  - La barra respeta `env(safe-area-inset-bottom)`, y el contenido lleva un relleno inferior para no quedar tapado.
- **Accesibilidad:**
  - `<nav aria-label="Principal">`: solo uno visible a la vez.
  - «Saltar al contenido» como primera parada de Tab, hacia `#contenido`.
  - Objetivos de al menos 44 px.
  - Contraste: activo 6,39:1, inactivo 11,29:1 y títulos de grupo 7,89:1 sobre `--vy-navy-700`.
- **Cerrar sesión:** el panel entero usa el cierre que espera al servidor y muestra un error en `role="alert"` si falla. Es el comportamiento que antes tenía solo la lista de catálogos.

## Pantalla de Inicio (`/dashboard`)

Las cifras vienen de `GET /api/dashboard/summary` ([contrato y definiciones](../dashboard-summary.md)).
- **Validación:** `parseDashboardSummary`, en `catalog-generator/lib/dashboard-ui.mjs`. Si la respuesta no cumple el contrato, se trata como error.
- **Importes:** se formatean con BigInt, sin pasar por `Number`:
  - en las tarjetas, completos hasta $ 999.999 y después «$ 3,2 M» (un decimal, redondeo al alejarse de cero);
  - en las barras, «620K» o «3,2M».

| Bloque | Se muestra cuando | Depende de |
| --- | --- | --- |
| Saludo, fecha larga (Bogotá) y «Nueva venta» | Siempre | Sesión. La cabecera oculta su propio «Nueva venta» en Inicio. |
| Acciones rápidas | Siempre | «Agregar producto» → Inventario; «Registrar gasto» solo con la entrada Gastos habilitada. |
| Primeros pasos | Si falta alguna tarea de `setup` | Inventario, catálogo publicado y primera venta, cada una con su enlace y su estado «Hecho» o «Pendiente». |
| Ventas hoy (azul) | Siempre | `today`; comparación con ayer y minigráfica de `salesSeries`. |
| Utilidad del mes (verde) | Siempre | `month.estimatedProfit` frente al mes anterior. Con `salesWithoutCostCount` > 0, enlace «n ventas sin costo» a Inventario. |
| Gastos del mes (violeta) | `modules.expenses` **y** la entrada Gastos habilitada en `panel-navigation` | Visible con F1a: total de gastos confirmados del mes frente al mes anterior. La utilidad ya los resta. |
| Te deben | Nunca | Cartera no existe. |
| Requiere tu atención | Siempre | Filas de pagos vencidos («n pagos vencidos») y por vencer en 7 días («n pagos vencen esta semana»), ambas con «Ver» → Gastos, solo con `modules.scheduledExpenses` y la entrada Gastos habilitada (F1b). Después, stock bajo y agotados (→ Inventario) y pedidos nuevos («Revisar»: al único catálogo, o a la lista si hay varios). Las filas en 0 se ocultan; si todas son 0, «Todo en orden». Fiados y equipos no existen. «Ver todos» no se implementa. |
| Ventas de la semana | Siempre | `salesSeries`. Selector de 7/30/90 días que vuelve a pedir el resumen con `?days=`. Etiquetas por barra solo con 7 días; el valor de cada día aparece al pasar el cursor o con las flechas; hay una tabla oculta como alternativa. |
| Últimos movimientos | Siempre | `recent` (hasta 5), con insignia de estado, cliente o «Sin cliente», hora o fecha y total. Las filas no son enlaces porque Ventas no tiene enlace directo a una venta; la cabecera lleva «Ver ventas». |
| Pie | Siempre | «Conectado» o «Sin conexión» según la última petición, y «Última actualización» con la hora de `generatedAt` en Bogotá. |

**Generación de pagos programados (F1b, corrección A):** con la entrada Gastos habilitada, Inicio llama a `POST /api/expenses/scheduled/sync` antes de leer el resumen, que sigue siendo de solo lectura. Si `sync` falla, el resumen se carga igual con un aviso discreto (`role="status"`): «No pudimos actualizar los gastos fijos; los avisos de pagos pueden estar incompletos» (corrección C).

**Estados:**
- **Carga:** esqueletos del tamaño final.
- **Error sin datos previos:** mensaje y «Reintentar».
- **Error con datos previos:** aviso con «Reintentar», manteniendo las últimas cifras.
- **Pestaña que recupera el foco:** vuelve a pedir el resumen, como máximo una vez por minuto.
- **Cambio de rango:** las respuestas tardías de un rango anterior se descartan.

**Pruebas:**
- `scripts/verify-dashboard-ui.mjs` (dentro de `npm test`): formateadores, comparaciones y validador.
- `npm.cmd run test:dashboard-browser`: escenarios con el doble del endpoint.

## Página de Gastos (`/dashboard/gastos`)

Referencia visual: [`gastos.png`](gastos.png). Se implementa con F1a ([contrato v1.2](../expenses-contract.md)) y F1b, gastos fijos y pagos programados ([contrato F1b](../expenses-f1b-contract.md)). Las cifras vienen de `GET /api/expenses/overview` ([definiciones](../expenses-overview.md)); la lista, de `GET /api/expenses`; la tarjeta «Gastos fijos», de `GET /api/expenses/scheduled`.

**Orden de carga (F1b, correcciones A y C):** la página llama primero a `POST /api/expenses/scheduled/sync` (idempotente) y después lee cifras, lista y pagos. Las lecturas nunca generan. Si `sync` falla, la página muestra lo que ya existe y un aviso discreto con «Reintentar»; reintentar con éxito vuelve a leer.

| Bloque | Qué muestra | Depende de |
| --- | --- | --- |
| Cabecera | Fila 1: icono violeta en mosaico, «Gastos» y «Lo que cuesta mantener tu negocio» a la izquierda; a la derecha, juntos y sin partirse, el selector de mes ‹ Mes AAAA › (hasta 12 meses después del actual) y «Registrar gasto», como en la maqueta. Fila 2: «Programar pago» y «Categorías» como botones secundarios compactos, alineados a la derecha en escritorio y lado a lado en móvil. Así «Registrar gasto» nunca baja sola de línea entre 1024 y 1280 px | F1a, F1b |
| Gastos del mes (violeta) | Total vigente del mes, comparación con el mes anterior, «n registros · m anulados (no suman)» y minigráfica por día, con una tabla oculta como alternativa | `overview`: `total`, `count`, `voidedCount`, `previousMonth`, `days` |
| Fijos pagados (azul) | «n de m», «$ X pagados» y barra de progreso (`role="progressbar"`). Sin fijos en el mes: «0 de 0 · Sin gastos fijos este mes» | `overview.scheduled.fixed` |
| Variables (verde menta, sin el verde antiguo) | Total y número de gastos vigentes del mes que no vienen de un pago programado | `overview.variable` |
| Próximos pagos (naranja) | Monto previsto de lo que vence entre hoy y hoy + 7, «n en los próximos 7 días» y «n sin monto». Aclara «Previsto: no suma hasta pagarlo». Siempre desde hoy, sea cual sea el mes que se vea | `overview.scheduled.upcoming` |
| Vencidos (rojo) | Franja bajo las tarjetas, solo si hay: «Vencidos: n pagos · $ X previstos · n sin monto» y «Ver vencidos», que lleva el foco a la tarjeta «Gastos fijos». Relativo a hoy en cualquier mes | `overview.scheduled.overdue` |
| Filtros | Chips «Todos», «Fijos» (`origin=fixed`) y «Anulados», y buscador «Buscar gasto, categoría o nota» | La búsqueda filtra la lista del mes y carga sus páginas restantes (hasta 20 de 25) para que el resultado sea completo; si no alcanza, lo avisa |
| Gastos de {mes} | Lista agrupada por día con mosaico de categoría, descripción, insignia «Fijo» (gasto creado al pagar un gasto fijo), categoría, pastilla del medio de pago y monto. Los anulados aparecen atenuados y tachados, con la pastilla «Anulado» y su motivo. «Más gastos» carga la página siguiente | F1a `GET /expenses` |
| Detalle (diálogo) | Las acciones de F1a: reclasificar, anular con o sin reemplazo, e historial. Si el gasto viene de un pago programado, lo dice y avisa de que anularlo sin reemplazo devuelve el pago a pendiente | F1a, F1b |
| ¿En qué se va la plata? | Barras violeta por categoría con monto y porcentaje calculados en el servidor; las archivadas se marcan «(archivada)» | `overview`: `byCategory` |
| Gastos fijos (columna derecha) | Ocurrencias de gastos fijos y pagos únicos con vencimiento en el mes (en el mes actual, hasta hoy + 7 si pasa del fin de mes), más todos los vencidos. Primero los vencidos, luego los pendientes por fecha y al final los pagados. Cada fila: mosaico, descripción (insignia «Único» si no es fijo), «Día 28 · $ 110.000» (o «monto por definir»), estado «Pagado» (verde), «Vence hoy / mañana / en n días» (naranja, hasta 7 días), «Vencido hace n días» (rojo) o «Por pagar» (gris), y «Marcar pagado» en los pendientes. «Administrar» abre la gestión de fijos. En un mes futuro: «Previsto del mes: $ X · n pagos · n sin monto», los pagos ya generados de ese mes con sus acciones y las fechas «Proyectado» (borde discontinuo, sin acciones) de los fijos activos | `GET /expenses/scheduled`, `overview.scheduled.planned` y `projected` |
| Mes futuro | «Gastos del mes», «Fijos pagados» y «Variables» muestran «$ 0 · Mes futuro»; la lista dice «Mes futuro: todavía no hay gastos» y no se pide al servidor | `overview.future` |
| Opciones de un pago (diálogo) | Datos del pago; en pendientes, «Marcar pagado», «Reprogramar» (nueva fecha desde hoy y monto previsto) y «Omitir este pago» (motivo opcional, definitivo); en pagados, «Ver el gasto registrado» | `PATCH /expenses/scheduled/:id`, `/cancel` |
| Marcar pagado (diálogo) | Monto precargado con el previsto y editable con separador de miles, aviso si difiere del previsto, fecha de pago (hoy por defecto, nunca futura), medio de pago, nota con «Otro» y referencia opcional | `POST /expenses/scheduled/:id/pay` |
| Programar pago (diálogo) | Monto previsto opcional, vencimiento (hoy o después, hasta un año), categoría, descripción, medio de pago habitual y proveedor. «Repetir» lo convierte en gasto fijo: cada 1 a 12 semanas, meses o años, con fecha final opcional y la nota de que una quincena son dos fijos mensuales | `POST /expenses/scheduled` o `POST /expenses/recurring` |
| Administrar gastos fijos (diálogo) | Fijos activos y en pausa con frecuencia, monto estimado, categoría y próxima fecha. «Editar» (descripción, monto estimado, categoría y frecuencia; se aplica a las próximas fechas pendientes no editadas a mano), «Pausar», «Reanudar» y «Terminar» (con confirmación). Debajo, plegada, «Terminados (n)», de solo lectura, con nombre, frecuencia, monto, categoría y fecha de fin; no aparece si no hay ninguno | `/expenses/recurring?status=all` |
| Registrar gasto (diálogo) | El formulario de F1a con monto grande, fecha, categoría, medio de pago, nota con «Otro», descripción, proveedor y referencia | F1a |
| Categorías (diálogo) | Crear, renombrar, ordenar, archivar y reactivar | F1a |
| Pie | «Tu negocio está seguro con Vitrinaya», «Conectado» o «Sin conexión», y la hora de `generatedAt` en Bogotá | `overview` |

Los pagos programados nunca suman en «Gastos del mes», «Variables» ni en la utilidad de Inicio: solo cuenta el gasto que se crea al marcarlos pagados.

**Ocultos hasta F1c o después:** el chip «Con soporte» y el clip de soporte (F1c), y el chip «Variables» (la API no filtra por origen variable). «Exportar» llega con Reportes. La campana no se muestra porque no existen notificaciones.

**Diferencias con la maqueta:**
- «Variables» y «Próximos pagos» no tienen minigráfica: el resumen no trae su serie diaria.
- «Vencidos» es una franja roja bajo las tarjetas y no una quinta tarjeta, para no romper la rejilla de 4.
- El número de registros y de anulados pasa a una línea de «Gastos del mes».
- «Programar pago» y «Categorías» van en una segunda fila de la cabecera, como botones secundarios compactos.
- La cabecera del panel conserva «Nueva venta».
- Categoría y medio de pago son listas desplegables nativas, no fichas.
- El detalle, el registro, la programación y el pago se abren en diálogos.

**Móvil:** las cifras se apilan, la lista ocupa todo el ancho, la tarjeta «Gastos fijos» queda debajo de «¿En qué se va la plata?» con el estado y «Marcar pagado» bajo el texto, y «Registrar gasto» queda fijo sobre la barra inferior, respetando el área segura.

**Pruebas:**
- `npm.cmd run test:expenses-browser`: flujo de F1a y de F1b (programar único y recurrente, marcar pagado con otro monto y respuesta perdida, vencidos, reprogramar, omitir, anular el gasto pagado, administrar, fallo de `sync`), sin verde antiguo y sin desbordes de 320 a 1440 px.
- `scripts/verify-expenses-ui.mjs`: helpers, validadores de `overview`, de pagos y de fijos, formularios de programar y pagar, y contraste de las pastillas.

## Tema del panel (`.vy-theme`) y campo de monto

**Tema.** Los componentes compartidos (`Button`, `Input`, `Dialog`, `AlertDialog` y el `select` de Ventas) leen variables como `--color-primary`, `--field-focus` o `--border-normal`. La clase `.vy-theme` (`app/globals.css`) las redefine con la paleta nueva solo donde se aplica, de modo que la variante por defecto de `Button` no cambia y las pantallas sin rediseñar conservan el verde.

| Variable | Con `.vy-theme` |
| --- | --- |
| `--color-primary` / `--color-primary-hover` | `--vy-blue-600` / `--vy-blue-700` (botón principal) |
| `--field-focus`, `--field-focus-ring` | `--vy-blue-600` y `rgb(4 80 229 / 25%)` (anillo de foco) |
| `--field-border`, `--border-strong` | `--vy-field-border` (`#8592AD`, 3,13:1) |
| `--border-normal` | `#A9B5CC` (borde gris azulado de los botones secundarios) |
| `--border-subtle`, `--surface-sunken` | `--vy-border`, `--vy-surface-soft` |
| `--text-primary`, `--text-secondary`, `--text-muted` | `--vy-text`, `--vy-text-muted`, `--vy-text-subtle` |
| `--status-error-text` / `--status-error-surface` | `#B42318` / `#FEF3F2` (acciones destructivas: blanco sobre rojo, 6,0:1) |
| `--brand-emerald`, `--brand-forest` | `--vy-blue-600`, `--vy-text` (por si un componente los usa directamente) |

**Dónde se aplica:**
- en el `<main>` de Gastos y en sus diálogos propios;
- en `AlertDialog` y `Dialog` con `theme="panel"`, una prop opcional que hace falta porque esos diálogos se pintan en un portal fuera de la página. Sin la prop no cambian.

`test:expenses-browser` comprueba con estilos calculados que no queda ningún color de la paleta verde antigua en la página ni en los diálogos de registrar, detalle, reclasificar, anular, categorías y archivar. Antes inserta un elemento verde de control que el escaneo debe detectar.

**Siguen con el verde (sin rediseñar):**
- Catálogos (lista, crear y espacio de trabajo: productos, pedidos, reseñas, banners y ajustes del catálogo);
- Inventario (incluidas hoja y lotes);
- Vender (ventas e historial por cliente);
- Ajustes/Cuenta (cierre de cuenta) y el enlace «Volver a catálogos»;
- el aviso de verificación de correo, común a todo el panel, también encima de Gastos;
- Admin;
- las páginas públicas (inicio y catálogo).

**Campo de monto («Registrar gasto» y el reemplazo al anular).** Muestra separadores de miles colombianos mientras se escribe (`12.345`, `1.250.000`) con `formatAmountInput` (`lib/expenses-ui.mjs`):
- Solo admite dígitos. Al pegar, «12.345» y «12345» dan lo mismo.
- Una coma decimal (`1,5`) se deja tal cual para que la validación la rechace en lugar de adivinar.
- El cursor queda tras el mismo dígito al editar en medio, y borrar un punto borra el dígito vecino.
- La API recibe el mismo entero sin separadores que antes, y siguen el límite de $ 1.000.000.000.000 y el nombre accesible «Monto en pesos».

**Inicio: rejilla de cifras.** Las columnas siguen a las tarjetas visibles:

| Ancho | Con 2 tarjetas | Con 3 tarjetas |
| --- | --- | --- |
| Móvil | 1 columna | 1 columna |
| Tablet (≥ `sm`) | 2 columnas | 2 columnas (2 + 1) |
| Escritorio (≥ `lg`) | 2 en una fila | 3 en una fila |
