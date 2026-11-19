# Escritura y primera lectura de la hoja

18 de noviembre de 2026. Esta fase corrige la escritura normal e incorpora una lectura local revisable. No implementa creación de productos ni movimientos a partir de la hoja libre.

## Problema reproducido y corrección

La configuración de escritorio utilizaba `disableAutoFocus: true`. En el SDK instalado esa opción también impide el traspaso normal de foco al editor de texto al comenzar a escribir en una celda. Las pruebas previas abrían la edición con F2 e insertaban texto completo: ese recorrido no cubría el clic simple seguido de letras normales.

Se añadió primero una regresión con clic real y teclas letra por letra. Falló conservando vacías las celdas esperadas, mientras la edición con F2 seguía funcionando. Se eliminó la opción que desactivaba el foco normal del SDK, manteniendo la espera de inicialización `Steady`. No se actualizó Univer ni se reemplazó su editor.

La regresión comprueba clic simple, caracteres completos, Tab, Enter, doble clic y cambio de celda con ratón; lee los valores guardados para verificar que no se perdieron ni se escribieron en otra celda. Los textos esperados incluyen `producto`, `precio`, `tercero` y `cuarto` en cuatro celdas de la misma fila. También permanecen las pruebas de fórmulas, negrita, arrastre, tamaño de columnas, búsqueda y pestañas.

El fallo reproducido es de escritorio. No se afirma que todos los posibles problemas de teclados móviles o IME estén resueltos; si el síntoma reportado corresponde a otro recorrido deberá verificarse específicamente.

## Lectura disponible

Debajo del editor aparece **Leer los datos de mi hoja**:

1. `Preparar lectura` termina la celda activa y captura los datos locales, esperando los resultados de fórmulas. No guarda el documento en el servidor.
2. Se selecciona por defecto la pestaña activa. El vendedor puede elegir otra, indicar la fila de títulos y seleccionar un rango posterior de hasta 500 filas.
3. Se muestran letras de columna y los títulos originales. Se sugieren coincidencias sencillas como Descripción → nombre, Referencia → SKU y Precio de venta → precio COP. El vendedor puede corregirlas o dejar cualquier columna sin interpretar.
4. `Generar vista previa de lectura` muestra valores normalizados, fila/celda de origen, avisos y errores. No presenta un botón de aplicar al inventario.

La configuración se bloquea durante la captura y el botón evita capturas simultáneas. Se debe volver a Preparar lectura después de editar el documento: no hay análisis permanente por tecla ni una sincronización oculta.

Campos de esta primera lectura: nombre, SKU de texto, cantidad informativa, precio de venta COP, costo de referencia COP y existencia mínima. No obliga a cambiar los títulos del vendedor ni a escribirlos en una fila fija. La asignación y los resultados son temporales, no se persisten todavía.

**Cantidad es informativa.** Una columna llamada cantidad, stock, inventario o saldo no indica por sí sola si contiene el saldo contado, unidades recibidas, unidades vendidas, paquetes o unidades por paquete. Tampoco se decide si Valor es precio, costo o subtotal. Esas columnas no reciben automáticamente un significado de negocio.

## Reglas de lectura

- Nunca se emparejan productos por nombre. El SKU leído se normaliza como texto; un SKU numérico se señala para evitar inventar ceros iniciales perdidos.
- Texto de nombre/SKU dentro de sus límites actuales; duplicados de SKU señalan todas las filas implicadas dentro del rango.
- Cantidades/mínimos: enteros no negativos, máximo INTEGER. Precio/costo: pesos enteros no negativos dentro del límite BIGINT, representados como cadenas decimales.
- Se lee el valor real de la celda, no se deduce el importe por su apariencia. El texto monetario ambiguo, como `12.000` o `COP 12.000`, no se convierte silenciosamente. Un número calculado que haya perdido precisión tampoco se acepta como dinero exacto.
- Las fórmulas se muestran mediante el resultado calculado por el editor, indicando las coordenadas de origen; un resultado ausente o de error se señala. Eso no constituye una validación autoritativa del servidor ni una aprobación para aplicarlo al stock.
- Filas completamente vacías se contabilizan y omiten; filas parcialmente completas se conservan con sus errores. No se descartan filas problemáticas para hacer parecer válida la lectura.
- Celdas combinadas se señalan por ambigüedad, sin expandirlas artificialmente a miles de celdas. Se acota también el número de combinaciones analizadas.
- No se asigna dos veces el mismo significado. El rango está limitado a 500 filas; no se divide y aplica automáticamente un documento grande.
- Incluye filas ocultas/filtradas del rango, con aviso. La vista previa pagina de 50 en 50.

La lectura se ejecuta solo en el navegador y no crea peticiones de escritura. Puede analizar cambios locales aún no guardados para mostrar una vista previa; si más adelante se van a aplicar, debe existir primero una fuente persistida y versionada.

## Contrato propuesto para la siguiente fase — no implementado

Flujo: guardar documento → seleccionar fuente/rango → revisar asignación → preview autoritativa del servidor → confirmar un lote de inventario → recibo.

La futura petición enviará referencia al documento, versión/hash, pestaña, rango, fila de títulos y asignación de columnas. El servidor leerá el snapshot guardado de la cuenta autenticada, no una matriz normalizada que el cliente declare confiable. Si cambia la fuente o los productos/saldos después de la preview, se exigirá una nueva revisión.

La interpretación deberá diferenciar datos del producto, ficha comercial y stock. El identificador de un producto existente seguirá siendo ID propio o SKU, nunca nombre. Las altas necesitarán nombre/SKU y los ajustes deberán calcularse contra el saldo real bajo transacción. No se modificará el ledger antiguo ni se deducirá un borrado por una fila ausente.

Para aplicar se reutilizará el contrato de lotes aprobado: máximo 500 filas, atomicidad completa, versiones, operación idempotente, recibo persistido y movimientos compensables mediante nuevas entradas de ledger. La lectura local no sustituye estas validaciones ni calcula deltas autorizados.

### Decisiones de producto antes de aplicar

- Qué representa cada cantidad: saldo objetivo, entrada, salida o dato que no afecta existencias. El modo de operación debe elegirse explícitamente; no inferirse solo del título.
- Si el MVP combinará altas/actualizaciones con conteos o si se separarán esos pasos en pantalla.
- Cómo conservar y reutilizar asignaciones, y cuándo invalidarlas si cambian títulos, pestañas o posiciones.
- Si se permitirán fórmulas en campos que van a aplicarse y cómo validar/congelar su resultado en servidor. Hasta definirlo, mostrar un resultado de fórmula no autoriza una escritura.
- Qué unidades y moneda son admisibles. Esta vista trabaja con COP y unidades enteras; no convierte moneda, paquetes ni medidas.
- Cómo introducir el motivo de cada ajuste o del lote y revisar saldos anterior/objetivo/delta antes de confirmar.

No se implementaron endpoints nuevos de interpretación ni migraciones en esta fase. La siguiente tarea concreta es revisar estas decisiones y conectar una interpretación autoritativa con el servicio de lotes existente, sin automatizar la aplicación.

## Verificación y archivos

Resultados: **28 etapas E2E reales aprobadas**, con las 27 migraciones actuales, PostgreSQL, API, frontend, autenticación y navegador reales. Incluye la regresión de escritura normal y un recorrido de lectura sobre títulos personalizados, SKU duplicados e importe ambiguo, seguido de corrección y nueva captura sin errores. Se verificó que ni la edición ni preparar/generar la lectura envían mutaciones de inventario, y que no cambia el número de productos ni movimientos.

Evidencia: esquema `inventory_e2e_d86f7bc11ff4e2d9`; resumen `C:/Users/danie/AppData/Local/Temp/vitrinaya-inventory-e2e-dM1RAg/inventory-e2e-results.json`. El fallo de escritura reproducido antes de la corrección dejó su captura `C:/Users/danie/AppData/Local/Temp/vitrinaya-inventory-e2e-Z86ZGR/free-workbook-failure.png`. Los primeros intentos de la prueba de lectura descubrieron además dos problemas de sincronización del ensayo: `.click()` no activaba una pestaña que el SDK selecciona en pointerdown; y se cambiaban asignaciones mientras todavía terminaba una captura. Se utiliza clic real de ratón, se espera a que termine la captura y se deshabilitan los controles durante esa operación. No se redujeron validaciones ni se ocultaron errores.

También pasaron las **220 pruebas de API** existentes, todos los grupos del test de frontend (incluidos los cinco nuevos), tipos y builds de ambos proyectos. Lint frontend sin errores y cuatro avisos preexistentes fuera del módulo. API no tiene scripts lint/typecheck; frontend no tiene script typecheck, por lo que se ejecutó TypeScript explícitamente. Se conserva el aviso de auditoría de Next documentado en la fase anterior; no hubo actualización de dependencias en esta tarea.

Comandos: `npm.cmd run build` y `npm.cmd test` en ambos proyectos; `npm.cmd exec -- tsc --noEmit` en ambos; `npm.cmd run lint` en frontend; `node scripts/verify-workbook-reading.mjs`; y `'postgresql://inventory_test@127.0.0.1:55479/catalogo_test' | npm.cmd run test:inventory-e2e` en frontend. Las migraciones solo se ejecutaron dentro del verificador sobre un esquema temporal nuevo. PostgreSQL temporal quedó detenido con `pg_ctl -m fast -w stop`, conservando los datos ficticios.

El nuevo verificador unitario `scripts/verify-workbook-reading.mjs` cubre cinco grupos: títulos/rango/valores exactos/fórmulas/vacíos sin mutar el origen; SKU duplicados; códigos numéricos/cantidades negativas/importes ambiguos; rango excesivo/significados duplicados; fórmulas con error/celdas combinadas/coordenadas.

Archivos del cambio: `components/inventory/FreeWorkbook.tsx` (foco y acceso al lector), `components/inventory/WorkbookReading.tsx` (flujo revisable), `lib/workbook-reading.ts` (lectura/normalización/errores), `scripts/free-workbook-e2e.mjs` (regresiones reales), `scripts/verify-workbook-reading.mjs`, `package.json` (incluir verificación), este documento y la referencia desde `inventory-workbook.md`.

Sin dependencias nuevas, cambios en backend/esquema/migraciones, commit, push ni despliegues. No se modificaron archivos de entorno ni se ejecutaron operaciones contra producción. La validación de lectura es una ayuda local; no resuelve todavía todos los formatos, unidades o estructuras que puede inventar un vendedor.
