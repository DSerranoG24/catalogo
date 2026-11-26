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

`/dashboard/gastos` solo existe en la rama `f1-expenses`.

**Configuración:** `catalog-generator/lib/panel-navigation.ts`, `PANEL_NAVIGATION`. Cada entrada tiene `id`, `label`, `href`, `icon` (lucide), `group`, `enabled` y `mobileBar`.

| Entrada | Grupo | Ruta | Habilitada | Barra móvil |
| --- | --- | --- | --- | --- |
| Inicio | — | `/dashboard` | Sí | Sí |
| Vender | Día a día | `/dashboard/ventas` | Sí | Sí |
| Inventario | Productos | `/dashboard/inventario` | Sí | Sí |
| Catálogo | Productos | `/dashboard/catalogos` | Sí | No (va en «Más») |
| Gastos | Dinero | `/dashboard/gastos` | Sí (F1a) | No (va en «Más») |
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
| Requiere tu atención | Siempre | Filas de stock bajo y agotados (→ Inventario) y de pedidos nuevos («Revisar»: al único catálogo, o a la lista si hay varios). Las filas en 0 se ocultan; si todas son 0, «Todo en orden». Fiados y equipos no existen. «Ver todos» no se implementa. |
| Ventas de la semana | Siempre | `salesSeries`. Selector de 7/30/90 días que vuelve a pedir el resumen con `?days=`. Etiquetas por barra solo con 7 días; el valor de cada día aparece al pasar el cursor o con las flechas; hay una tabla oculta como alternativa. |
| Últimos movimientos | Siempre | `recent` (hasta 5), con insignia de estado, cliente o «Sin cliente», hora o fecha y total. Las filas no son enlaces porque Ventas no tiene enlace directo a una venta; la cabecera lleva «Ver ventas». |
| Pie | Siempre | «Conectado» o «Sin conexión» según la última petición, y «Última actualización» con la hora de `generatedAt` en Bogotá. |

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

Referencia visual: [`gastos.png`](gastos.png). Se implementa con lo que F1a permite hoy ([contrato v1.2](../expenses-contract.md)). Las cifras vienen de `GET /api/expenses/overview` ([definiciones](../expenses-overview.md)) y la lista, de `GET /api/expenses`.

| Bloque | Qué muestra | Depende de |
| --- | --- | --- |
| Cabecera | Icono violeta en mosaico, «Gastos», «Lo que cuesta mantener tu negocio», selector de mes ‹ Mes AAAA › (no deja avanzar a meses futuros), «Categorías» y «Registrar gasto» | F1a |
| Gastos del mes (violeta) | Total vigente del mes, comparación con el mes anterior y minigráfica por día, con una tabla oculta como alternativa | `overview`: `total`, `previousMonth`, `days` |
| Registros del mes | Número de gastos vigentes y de anulados (que no suman) | `overview`: `count`, `voidedCount` |
| Filtros | Chips «Todos» y «Anulados», y buscador «Buscar gasto, categoría o nota» | La búsqueda filtra la lista del mes y carga sus páginas restantes (hasta 20 de 25) para que el resultado sea completo; si no alcanza, lo avisa |
| Gastos de {mes} | Lista agrupada por día («HOY · MIÉRCOLES 25», «AYER · …», «LUNES 23»), con mosaico de categoría, descripción, categoría, pastilla del medio de pago y monto. Los anulados aparecen atenuados y tachados, con la pastilla «Anulado» y su motivo. «Más gastos» carga la página siguiente | F1a `GET /expenses` |
| Detalle (diálogo) | Las acciones de F1a sin cambios: reclasificar (categoría, descripción y nota con «Otro»), anular con o sin reemplazo, e historial | F1a |
| ¿En qué se va la plata? | Barras violeta por categoría con monto y porcentaje calculados en el servidor; las archivadas se marcan «(archivada)» | `overview`: `byCategory` |
| Registrar gasto (diálogo) | El formulario de F1a con monto grande, fecha, categoría, medio de pago, nota con «Otro», descripción, proveedor y referencia. Validaciones y envío seguro sin cambios. Incluye los avisos de que las compras de mercancía no son gastos y de que el IVA no se gestiona | F1a |
| Categorías (diálogo) | Crear, renombrar, ordenar, archivar y reactivar | F1a |
| Pie | «Tu negocio está seguro con Vitrinaya», «Conectado» o «Sin conexión», y la hora de `generatedAt` en Bogotá | `overview` |

**Ocultos hasta F1b o F1c:** «Fijos pagados», «Variables», «Próximos pagos», los chips «Fijos» y «Con soporte», la tarjeta «Gastos fijos» («Administrar», «Marcar pagado») y el clip de soporte. «Exportar» llega con Reportes. La campana no se muestra porque no existen notificaciones.

**Diferencias con la maqueta:**
- Hay 2 tarjetas de cifras en lugar de 4.
- «Categorías» es un botón de la cabecera, para no quitar la gestión de categorías de F1a.
- La cabecera del panel conserva «Nueva venta».
- Categoría y medio de pago siguen siendo listas desplegables nativas del formulario de F1a, no fichas.
- El detalle y el registro se abren en diálogos.

**Móvil:** las cifras se apilan, la lista ocupa todo el ancho y «Registrar gasto» queda fijo sobre la barra inferior, respetando el área segura.

**Pruebas:** `npm.cmd run test:expenses-browser` (flujo completo de F1a sobre la pantalla nueva) y `scripts/verify-expenses-ui.mjs` (helpers, validador de `overview` y contraste de las pastillas).
