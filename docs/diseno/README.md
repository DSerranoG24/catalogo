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
