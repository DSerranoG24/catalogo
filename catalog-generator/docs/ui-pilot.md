# Piloto de componentes privados

Button, Card e Input/Textarea son componentes propios. Solo los diálogos usan
Radix. Los estilos viven en `components/ui/ui.module.css`; no hay inicializador
de shadcn, cambios adicionales de globals.css ni proveedor global de cliente.
Los tokens de fundamentos ya existentes se conservan.

Los diálogos del dashboard conservan las operaciones originales y el bloqueo de
cierre durante una petición. Escape cierra cuando no hay una operación en curso.
Dialog y AlertDialog capturan el foco del botón de origen y lo restituyen al
cerrar. Si una eliminación ha retirado ese botón, el foco vuelve a main.
Las confirmaciones de categoría, producto y reseña usan AlertDialog. Las de
salida del flujo de fotos permanecen intactas.

## Dependencias

Instaladas con `--save-exact --ignore-scripts`:

- `@radix-ui/react-dialog`: **1.3.1**.
- `@radix-ui/react-alert-dialog`: **1.2.1**, reutiliza Dialog 1.3.1.

Árbol resumido; las referencias compartidas se deduplican. Las versiones exactas
y todas las aristas están fijadas en package-lock.json.

```text
react-alert-dialog@1.2.1
  react-dialog@1.3.1 (compartido)
  primitive@1.2.0, react-context@1.3.0,
  react-primitive@2.2.0, react-compose-refs@1.1.5 (compartidos)
react-dialog@1.3.1
  @radix-ui/primitive@1.2.0
  @radix-ui/react-compose-refs@1.1.5
  @radix-ui/react-context@1.3.0
  @radix-ui/react-dismissable-layer@1.2.1
    @radix-ui/react-use-callback-ref@1.1.5
    @radix-ui/react-use-effect-event@0.0.5
  @radix-ui/react-focus-guards@1.2.0
  @radix-ui/react-focus-scope@1.3.1
  @radix-ui/react-id@1.1.4
  @radix-ui/react-portal@1.2.0
  @radix-ui/react-presence@1.1.11
  @radix-ui/react-primitive@2.2.0
    @radix-ui/react-slot@1.5.0
  @radix-ui/react-use-controllable-state@1.3.0
  @radix-ui/react-use-layout-effect@1.1.4
  aria-hidden@1.2.6
    tslib@2.8.1 (ya existente)
  react-remove-scroll@2.7.2
    react-remove-scroll-bar@2.3.8
    react-style-singleton@2.2.3
      get-nonce@1.0.1
    use-callback-ref@1.3.3
    use-sidecar@1.1.3
      detect-node-es@1.1.0
    tslib@2.8.1 (compartido)
```

Se revisaron 26 paquetes, de los que 25 se añadieron al lockfile. No cambiaron
las versiones de paquetes anteriores. Ninguno incorpora preinstall, install ni
postinstall; aria-hidden declara prepare para su preparación, y la instalación
se realizó con todos los scripts desactivados.

## Medición del piloto

Bytes del build de producción local, con la misma API simulada HTTP en ambas
mediciones. Se suman los scripts referenciados por el HTML estático de dashboard,
excluyendo nomodule, y se calcula gzip por archivo. No incluye prefetch posterior
ni constituye una medición de transferencia de Vercel.

| Recurso | Antes bytes / gzip | Después bytes / gzip | Diferencia bytes / gzip |
|---|---:|---:|---:|
| JS dashboard moderno | 520228 / 156657 | 563105 / 170926 | +42877 / +14269 |
| CSS global | 86296 / 16242 | 85592 / 16105 | -704 / -137 |
| CSS privado nuevo | 0 / 0 | 4376 / 1213 | +4376 / +1213 |
| CSS total dashboard | 86296 / 16242 | 89968 / 17318 | +3672 / +1076 |

El CSS global se reduce al dejar de necesitar utilidades exclusivas de los
modales anteriores. El módulo privado se carga en las rutas que lo importan.
La diferencia de JS corresponde al piloto completo, incluyendo los wrappers.
Para repetir una medición: `node scripts/measure-ui-pilot.mjs`.

## Verificación local

El verificador SEO existente utiliza el build con
`NEXT_PUBLIC_CATALOG_API_URL=http://127.0.0.1:4317/api`.

Para verificar también el carrito real, que exige HTTPS en producción, construir
con una variable solo del proceso y ejecutar desde catalog-generator:

```powershell
$env:NEXT_PUBLIC_CATALOG_API_URL = 'https://127.0.0.1:4317/api'
npm.cmd run build
node scripts/verify-ui-pilot.mjs --https-api
Remove-Item Env:NEXT_PUBLIC_CATALOG_API_URL
```

El script usa Chromium instalado, puertos loopback 4317/4338, una API ficticia y
un certificado efímero confiado únicamente por el proceso Next hijo. La clave
efímera permanece en memoria. Bloquea las solicitudes externas y no usa cuentas
reales ni altera archivos de entorno. No publicar este artefacto de prueba.

Para comparar estilos con un CSS anterior guardado fuera del repositorio:
`node scripts/verify-ui-pilot.mjs --https-api --baseline-css RUTA_AL_CSS_ANTERIOR`.
Sin ese argumento solo se ejecutan las comprobaciones de teclado y foco.

Se verificaron Enter, Tab, Shift+Tab, Escape, título accesible, retorno del foco
y ajuste del diálogo en 320, 390, 1024 y 1440 px. Abrir y cancelar no emitió
mutaciones. También se compararon los estilos calculados, con movimiento normal,
de los siete identificadores públicos y sus carritos con un producto. EDITORIAL,
GRID y BOUTIQUE conservan su normalización a los diseños actuales. Esa comparación
incluye controles y tarjetas; no es una auditoría completa de todas sus interacciones.

El npm audit consultado señaló una vulnerabilidad crítica en Next 16.3.8, ya
presente antes del piloto. No se actualizaron dependencias ajenas al alcance.

## Extensión al panel del vendedor

Se migraron 63 botones, 27 campos editables y 7 textareas. Los seis selectores
de archivo, los tres checkboxes y los ocho selects mantienen sus elementos,
atributos y estilos nativos anteriores. La landing, login y rutas públicas no
se modificaron. No se añadieron dependencias.

Button admite además:

- `destructive-ghost`: texto de error, fondo transparente y hover rojo suave.
- `header-action`: texto blanco y fondo/borde translúcidos sobre la cabecera.
- `chip`: superficie suave inactiva y esmeralda activa; comunica aria-pressed.
- `tab`: superficie transparente inactiva y esmeralda activa. Conserva los
  atributos de navegación o selección del consumidor.

`selected` controla el aspecto de chip/tab. Los tamaños mínimos son sm 36 px,
md 44 px y lg 48 px; el texto largo puede ocupar más altura para evitar recortes.
La selección de plantilla usa secondary y la sugerencia de producto ghost, con
clases de distribución, sin variantes adicionales ni colores propios del botón.

Card admite `as="article"` y `as="section"`, con tipos de ref correspondientes.
Se migraron tres puntos: catálogo activo, catálogo archivado y producto. Se
conservaron sus article, keys y descendientes. Los cuatro puntos de métricas no
se migraron porque la autorización excluye expresamente AdminMetricsPanel.

No se movieron formularios ni componentes con estado. La comparación AST contra
los archivos previos comprobó estructura JSX, handlers, atributos no visuales,
funciones auxiliares y hooks iguales en los 15 consumidores. Las filas de
acciones pueden envolver para acomodar los nuevos tamaños en móvil.

Medición con la misma configuración HTTPS loopback, excluyendo nomodule y sin
incluir prefetch; compresión gzip calculada por archivo:

| Recurso | Antes bytes / gzip | Después bytes / gzip | Diferencia bytes / gzip |
|---|---:|---:|---:|
| JS dashboard moderno | 563106 / 170925 | 562006 / 170339 | -1100 / -586 |
| CSS global | 85592 / 16105 | 82014 / 15648 | -3578 / -457 |
| CSS total dashboard | 89968 / 17318 | 88339 / 17147 | -1629 / -171 |

Para ejecutar también las comprobaciones del panel:

```powershell
node scripts/verify-ui-pilot.mjs --https-api --panel
```

Se comprobaron dashboard, workspace, importación, fotos, configuración y creación
de catálogo en 320, 390, 1024 y 1440 px, sin desbordamiento horizontal del documento.
Los borradores de producto (nombre y descripción) y categoría sobreviven a abrir
y cancelar confirmaciones; los controles conservan su identidad DOM. El borrador
de foto también sobrevive a cancelar la confirmación nativa de salida. Las pruebas
usan datos sintéticos, sin enviar formularios ni contactar servicios externos.

La comparación con el CSS global previo pasó para los siete identificadores
públicos y sus siete carritos con producto, incluyendo sus controles y tarjetas.
