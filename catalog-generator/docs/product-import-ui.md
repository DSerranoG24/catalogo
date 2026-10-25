# Importación de productos: fase 3B

## Alcance

Interfaz en la pestaña Productos del workspace. El botón Importar Excel está en la cabecera de CatalogProductList, junto al contador. Abre un panel sobre la cuadrícula de editor/listado. No se modifican el backend, el lector de 3A, dependencias ni formatos del archivo.

CatalogWorkspace crea ProductImportFlow y se suscribe con useSyncExternalStore. El estado no pertenece al panel y no se borra al refrescar productos, cerrar/reabrir el panel ni cambiar de pestaña cuando no hay trabajo activo. El borrador del editor individual tampoco se reinicia al importar.

## Estados y datos

Las fases explícitas son idle, reading, previewing, ready, writing, stopped, completed y error. open solo determina visibilidad; no sustituye la fase. El estado también incluye progreso por lote, reporte, aviso, fallo, vencimiento conservador de la vista previa y solicitud de detención.

Cada fila tiene una identidad estable: rowNumber de Excel. Un Map por ese número integra errores locales, clasificaciones y resultados; el resumen cuenta estados de filas únicas, no cantidad de issues. Una fila con nombre y precio inválidos suma un error, mostrando ambos campos/motivos. Las filas locales rechazadas por 3A no traen sus datos originales; se muestran con su número, campos y motivos, sin inventar nombre o SKU ni enviar sustitutos a la API.

Los estados de fila son sin clasificar, nueva, actualizar, creada, actualizada, error, no procesada y desconocida. Las dos primeras clasificaciones no se cuentan como escrituras exitosas. Todos los datos y tokens de plan permanecen solo en memoria; no se registran ni guardan en storage. Cambiar de archivo inicia un reporte nuevo; cerrar/reabrir conserva el actual. Una navegación completa pierde el reporte en memoria: no hay recibo durable de importación.

## Lotes y comprobante de vista previa

El navegador usa el lector sin cambios. Excluye filas locales inválidas, y excluye como error local una fila que no pueda entrar en un JSON permitido. Los lotes llevan como máximo 50 filas y reservan 512 KiB para el token acumulado y margen para el envelope, manteniendo el límite de 2 MiB. El transporte comprueba también los bytes reales del JSON completo.

La primera vista previa no envía previewToken. Cada respuesta válida aporta el token para la siguiente petición. Se conserva el último reconocido, nunca uno de una petición sin respuesta. Los lotes son secuenciales, de acuerdo con el cupo de una petición activa por usuario de la API. totalRows es el número de filas que se envían a ese plan, no los errores locales.

Si un lote de vista previa falla, no se habilita Confirmar. Un reintento manual por red/5xx o 429 continúa desde el lote fallido usando el token anterior reconocido. No hay escrituras en esa etapa. Cancelar aborta su fetch; empezar una vista previa nueva descarta ese plan y comienza sin token.

invalidatedRows se aplica a todo el reporte, incluidas filas de lotes anteriores. Solo ready=true en la respuesta final habilita Importar X productos. La confirmación envía únicamente las filas elegibles, con los datos normalizados originales, el mismo token final y el totalRows del plan completo. No se reconstruye un token por lote de escritura.

El vencimiento se estima conservadoramente a los 30 minutos desde antes de la primera petición. El servidor sigue siendo quien valida la firma/vencimiento. Una vista previa vencida requiere otra completa.

## Fallos, detención y sesión

La lectura tiene el límite/cancelación real de 3A. El transporte HTTP tiene un timeout separado de 30 segundos; no reutiliza los 10 segundos del lector para escrituras. No hay reenvíos automáticos.

Durante escritura, Detener después del lote actual conserva el fetch en curso y espera su reporte; no envía lotes siguientes. No deshace filas ya confirmadas. Un error de fila conserva los resultados exitosos del lote y permite los siguientes lotes. Errores de transporte, respuestas de éxito incompletas/no válidas o estados de gateway dejan desconocidas las filas del lote afectado; las siguientes quedan no procesadas. Nunca se cuentan como no guardadas solo por perder la respuesta.

Un 429 rechazado antes de escribir conserva el cursor y permite un reintento manual tras la espera. Se respeta Retry-After si llega; el proxy actual no lo propaga, por lo que el fallback es 2 segundos para IMPORT_BUSY y 15 minutos para el limitador de ventana. El botón, un archivo nuevo y otra vista previa no pueden saltarse esa espera. El token sigue sujeto a vencimiento.

Un 401 detiene nuevos lotes y mantiene el reporte con enlace para iniciar sesión. Si el refresco de productos también devuelve 401, no se limpia la metadata visual de sesión mientras el reporte está abierto, porque el layout lo desmontaría. Eso no concede autorización: la cookie/servidor siguen siendo la fuente de permisos y las nuevas peticiones quedan bloqueadas. Si se detecta expiración mientras una escritura ya está en curso, se espera ese resultado y se detiene después.

Las respuestas de catálogo inválido/archivado o vista previa inválida no se reenvían automáticamente. Nueva vista previa de filas sin confirmar excluye resultados ya reconocidos como creados/actualizados, vuelve a clasificar errores de servidor, desconocidos y no procesados y conserva los éxitos anteriores. No reconstruye un recibo perdido ni permite deducir qué escribió el intento desconocido; el vendedor debe confirmar expresamente la nueva clasificación.

La interfaz usa requestId de la operación correspondiente cuando está disponible. No reutiliza un requestId de vista previa como referencia de una escritura cuya respuesta se perdió. El transporte valida en ejecución forma, número e identidad de filas; errores no se muestran como HTML ni se registran con datos/tokens.

## Cierre y accesibilidad

Cerrar está bloqueado en reading, previewing y writing. Para leer/previsualizar se ofrece cancelación explícita; para escritura se ofrece detención después del lote. Las pestañas y mutaciones manuales quedan bloqueadas durante trabajo activo. beforeunload avisa en recarga/cierre de la página. Si una navegación forzada desmonta el workspace, se cancelan lectura/vista previa y nunca se envía otro lote; una escritura ya recibida por la API puede terminar y no se promete cancelarla desde el navegador.

El disparador controla un contenedor con ID estable, incluso cerrado. Se enfoca el título al abrir/reabrir y el disparador al cerrar; al completar etapas se enfoca el resumen. El selector es nativo con label y reglas asociadas; estados usan role=status/aria-live polite, errores bloqueantes role=alert. Progreso solo de respuestas recibidas por lote, sin porcentaje dentro de un lote ni de la lectura. Tabla semántica, páginas de 25 filas, foco en caption actualizado al cambiar página, región desplazable por teclado y clasificación textual. No se afirma una auditoría completa con lector de pantalla.

## Verificación reproducible

- `npm.cmd run test:import-flow`: 20 grupos; estados, token encadenado, conflictos entre lotes, errores locales, detención, cierre, red, 401, 429, vencimiento, doble envío, refresco, unicidad por fila, tamaño de JSON y respuestas inválidas.
- `npm.cmd test`: 16 grupos del lector/proxy de 3A, intactos.
- `npm.cmd run test:import-browser`: build de Next ya generado, Chrome/Edge local y OpenSSL de Git for Windows. Usa perfil temporal, servidores solo en loopback y API simulada HTTPS. La clave TLS efímera queda en memoria; solo se escribe el certificado público y se confía en él mediante NODE_EXTRA_CA_CERTS exclusivamente en el proceso temporal de Next. No se deshabilita TLS ni se cambia Origin. Se navega por localhost, que coincide con la normalización local de Next.

La comprobación de navegador usa el worker y lector reales y peticiones reales por el proxy, con respuestas simuladas. Cubre archivo mixto con SKU numérico, creación/actualización, refresco y borrador, tres lotes encadenados, stop mientras un lote sigue en curso, controles bloqueados, paginación/foco, respuesta perdida, 429 manual, 401 también al refrescar y cierre/reapertura con reporte. Incluye viewport de 390px sin desbordamiento del documento y una captura temporal. Los servicios/procesos temporales se cierran al finalizar.

No se prueba contra la API real, PostgreSQL ni producción en este bloque. Tampoco sustituye pruebas manuales en Safari/Firefox, dispositivos físicos o tecnologías de asistencia. Sin dependencias, variables de despliegue o migraciones nuevas. Commit/push/despliegue requieren autorización.
