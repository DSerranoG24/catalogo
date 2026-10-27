# Páginas legales: implementación local

Rutas: `/privacidad`, `/terminos` y `/contacto`. Son páginas de servidor con
contenido inicial visible sin JavaScript, metadata propia, canonical e index,
follow. El sitemap contiene cuatro URLs: raíz y estas tres páginas. No se
enumeran catálogos, compradores ni rutas privadas.

No es un dictamen jurídico ni un texto legal definitivo. Los apartados que
necesitan criterio jurídico muestran literalmente
`[PENDIENTE DE REVISIÓN JURÍDICA]`. La persona operadora solo está identificada
como persona individual en Colombia; no se inventan nombre legal, NIT ni dirección.

## Pendientes jurídicos visibles

- Identificación completa de la persona operadora, datos identificativos o NIT
  y dirección postal que correspondan.
- Bases y finalidades del tratamiento, responsabilidades de plataforma,
  vendedores y compradores.
- Contratos y localizaciones de proveedores, transferencias internacionales.
- Plazos de conservación y procedimiento de supresión: pedidos, instantáneas,
  tokens, archivos, respaldos y tratamiento de copias descargadas. No existe hoy
  borrado/anonimización automática de pedidos ni borrado de cuenta en autoservicio.
- Derechos del titular, procedimiento formal, comprobación de identidad y
  gestión de solicitudes. Se atienden por correo, sin procedimiento formalizado.
- Jurisdicción y disposiciones aplicables.
- Limitación de responsabilidad y delimitación entre plataforma y vendedores.
- Cambios, interrupciones, mantenimiento y recuperación del servicio.
- Modificación de términos: aviso, versión y aplicación de nuevas condiciones.
- Tratamientos y cookies de Google Sign-In; la política señala que requieren
  revisión. No se afirma ausencia de registros o analítica en la infraestructura
  remota no inspeccionada.

Pendiente técnico separado: Order conserva customerConsentAt, pero no una
versión del texto aceptado. Este bloque no cambia el esquema ni añade esa
versión. El texto original del checkbox se conserva y se añade un enlace visible
a `/privacidad`, sin afirmar que la casilla resuelve todos los requisitos.

La política describe los datos actuales: cuenta, recuperación/verificación,
perfil comercial, clientes de vendedores, cotizaciones y reseñas. Las notas y
comentarios son texto libre. Detalla los proveedores y el acceso al PDF por
posesión del enlace. Explica qué hacen archivar, desactivar y cancelar, y que
los doce meses son una propuesta interna no automatizada.

## Contacto sin envío ni datos en URL

Correo público: vitrinaya983@gmail.com. Instagram y Facebook usan las URLs
facilitadas. El formulario valida nombre, correo y mensaje; genera localmente
un `.eml` con destinatario, asunto y cuerpo prellenados y cabecera X-Unsent.
No utiliza mailto con parámetros, porque incluir asunto/cuerpo allí colocaría
datos personales en una URI. El enlace mailto directo solo contiene el correo
de Vitrinaya, sin datos del usuario.

El archivo se descarga mediante una URL blob opaca, revocada después, sin
petición de envío, almacenamiento remoto ni cambios en la URL de la página.
El cuerpo UTF-8 se codifica en base64 MIME; los campos no forman cabeceras,
evitando inyección de encabezados. No se añade From ni se simula la identidad
del remitente. El mensaje de éxito dice que el usuario debe abrir, revisar y
enviar el archivo y que Vitrinaya no ha enviado nada.

No se fuerza la apertura de un cliente externo. Algunas aplicaciones abren
`.eml` como mensaje, no como borrador: esta limitación aparece en la página y
el correo directo siempre está disponible. Sin JavaScript el formulario queda
deshabilitado para evitar envío nativo accidental; el contenido y los enlaces
de correo y redes permanecen operativos.

## Diff resumido por archivo

| Archivo | Cambio |
| --- | --- |
| `catalog-generator/app/privacidad/page.tsx` | Inventario, fines, proveedores, almacenamiento, conservación real y marcadores. |
| `catalog-generator/app/terminos/page.tsx` | Servicio, reglas del vendedor, stock informativo y condiciones pendientes. |
| `catalog-generator/app/contacto/page.tsx` | Contactos públicos y formulario de borrador local. |
| `catalog-generator/components/legal/LegalPage.tsx` | Estructura semántica común y marcador visible. |
| `catalog-generator/components/legal/LegalLinks.tsx` | Tres enlaces internos, misma pestaña, sin estilos de páginas cargados en el catálogo. |
| `catalog-generator/components/legal/legal.module.css` | Presentación responsive, tablas, contraste y foco localizados. |
| `catalog-generator/components/legal/ContactDraftForm.tsx` | Validación, generación local del archivo y mensajes honestos. |
| `catalog-generator/lib/contact-draft.ts` | Validación de límites y formato MIME UTF-8 del borrador. |
| `catalog-generator/lib/legal-metadata.ts` | Metadata indexable y canonical por página. |
| `catalog-generator/app/page.tsx` | Solo habilita enlaces del pie y retira próximamente. |
| `catalog-generator/app/sitemap.ts` | Raíz y tres páginas nuevas. |
| `catalog-generator/components/public/PublicCatalogPage.tsx` | Enlaces en el footer del catálogo. |
| `catalog-generator/components/public/PublicShoppingCartPage.tsx` | Enlace a privacidad junto al consentimiento existente. |
| `catalog-generator/scripts/verify-public-seo.mjs` | Sitemap con cuatro URLs y metadata de las nuevas rutas. |
| `catalog-generator/scripts/verify-legal-browser.mjs` | Matriz de páginas, lectura sin JS, contraste y borrador sin envío. |
| `catalog-generator/docs/public-seo.md` | Actualiza el contenido del sitemap. |
| `docs/legal-pages.md` | Alcance, pendientes e informe de comprobaciones. |

## Comprobaciones y límites

- Frontend build correcto con TypeScript; no hay script typecheck independiente.
- Lint sin errores, cuatro advertencias img previas.
- API 163/163 pruebas, sin cambios de backend. Frontend 17/17.
- Verificador SEO: cuatro URLs canónicas, metadata propia e indexabilidad de
  las tres páginas; conserva comprobaciones existentes de catálogo, errores,
  noindex privado y OG. API simulada en loopback, sin producción.
- Chromium: 24 casos de tres páginas × cuatro anchos (320, 390, 1024 y 1440)
  × JavaScript activado/desactivado. Sin desbordamiento, un h1 por página,
  jerarquía de encabezados, enlaces en misma pestaña y marcadores visibles.
- Contraste mínimo de texto medido con estilos computados: 6,81:1 en las tres
  páginas. Los marcadores se distinguen también por texto, no solo por color.
- Footer de landing y catálogo verificado en navegador. Checkbox y enlace de
  privacidad verificados en código y build; no se ejecuta un pedido E2E. El
  build simulado usa HTTP para lectura pública de servidor; el carrito cliente
  exige HTTPS en producción, por lo que no se usa para comprobar una compra.
- Borrador probado mediante descarga real del navegador: archivo MIME con
  destinatario/asunto, mensaje UTF-8, validación, URL de página sin datos y sin
  POST/PUT al preparar. No se envía correo.

No comprobado: revisión jurídica, clientes de correo reales, entrega de correo,
lector de pantalla humano, Safari/Firefox, dispositivos físicos o producción.
El build de prueba usa API simulada y requiere recompilar para desplegar.
No hay migraciones, endpoints, variables nuevas, dependencias ni cambios de
Git, Supabase, Render o Vercel. Antes de publicar deben revisarse los marcadores
jurídicos y el flujo .eml en las aplicaciones de correo utilizadas.
