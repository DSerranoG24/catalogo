# Cuentas: verificación y recuperación

## Comportamiento

Una cuenta sin correo verificado sigue pudiendo trabajar. El dashboard consulta `GET /api/me` y muestra un aviso persistente con dirección pendiente, reenvío y espera de 60 segundos. Vuelve a consultar al recuperar foco/visibilidad; localStorage no determina la verificación ni la autorización.

El registro guarda primero la cuenta, conserva su sesión inmediata y encola la verificación. Un fallo del proveedor no revierte el registro. Una recuperación completada cambia la contraseña, verifica el correo e invalida todas las sesiones anteriores y todos los enlaces pendientes. Después exige iniciar sesión normalmente; no emite JWT ni cookie de acceso.

Las cuentas exclusivamente Google no reciben tokens para crear una contraseña local desde recuperación. Deben continuar con Google. Google no fusiona cuentas por coincidencia de correo: devuelve 409 y solicita entrar con contraseña local. El frontend conserva la credencial Google únicamente en memoria y, tras login local, solicita la vinculación autenticada con contraseña. La vinculación verifica coincidencia de correo y vuelve a comprobar hash/versión bajo bloqueo. Las cuentas Google nuevas se marcan verificadas solo para Gmail o Workspace con la identidad validada por Google; las demás reciben verificación por correo. No hay backfill de cuentas antiguas.

No se implementa cambio de dirección ni recuperación de un buzón perdido o mal escrito. Permitir cuentas no verificadas implica que todavía pueden registrarse direcciones inventadas; no se presentan como verificadas.

No se desvinculan identidades Google históricas ni se presume que una cuenta haya sido comprometida. Si hubiera una vinculación maliciosa anterior a este cambio, invalidar sesiones no elimina esa credencial externa: su revisión requiere un proceso de recuperación de cuenta comprometida adicional. El registro conserva el 409 previo para correo duplicado; la respuesta uniforme de este bloque corresponde a recuperación, no elimina toda enumeración histórica del registro.

## Contrato HTTP

Todas las rutas se consumen por el proxy same-origin, que conserva la comprobación de Origin. Las rutas de acciones responden con `Cache-Control: no-store`.

| Ruta | Cuerpo / autorización | Resultado |
|---|---|---|
| GET `/api/me` | Sesión válida | `user: { id, email, emailVerifiedAt, hasLocalPassword }` |
| POST `/api/auth/verification/request` | Sesión válida, cuerpo vacío o `{}` | 202: `{ success: true, retryAfterSeconds: 60, message }`; no admite destinatario ni userId |
| POST `/api/auth/verification/confirm` | `{ token }` | 200 al consumir; 400 genérico para inválido/vencido/usado |
| POST `/api/auth/password/forgot` | `{ email }` válido | Siempre 202 y el mismo cuerpo para existente, inexistente, Google sin contraseña, cooldown o cola llena |
| POST `/api/auth/password/reset` | `{ token, password, passwordConfirmation }` | 200 al consumir; 400 genérico para token inválido/vencido/usado; errores de contraseña sin detalles de cuenta |
| POST `/api/auth/google/link` | Sesión válida y `{ idToken, password }` | 200 al vincular; 400 genérico si no demuestra contraseña/identidad coincidente |

Respuesta de recuperación: `{"success":true,"message":"Si corresponde, recibirás instrucciones para recuperar el acceso."}`.

Respuesta de token inválido: `{"success":false,"message":"El enlace no es válido, ha vencido o ya se utilizó. Solicita uno nuevo."}`.

Contraseñas nuevas: mínimo 8 caracteres y máximo 72 bytes UTF-8, con confirmación coincidente. El límite de bcrypt se valida también en registro para no truncar silenciosamente contraseñas nuevas. El login conserva compatibilidad con las anteriores.

## Persistencia y concurrencia

La migración [20261025180000_account_verification_recovery](../catalog-api/prisma/migrations/20261025180000_account_verification_recovery/migration.sql) añade `emailVerifiedAt` nullable y `sessionVersion` con cero por defecto, sin cambiar cuentas, credenciales ni catálogos existentes.

`AccountActionToken` almacena solo SHA-256 de un token aleatorio de 32 bytes/base64url, con usuario, propósito, dirección al emitir, caducidad y consumo. Nunca guarda el token en claro. `VERIFY_EMAIL` caduca en 24 horas y `RESET_PASSWORD` en 30 minutos. Un propósito no autoriza el otro.

El consumidor busca por hash, bloquea la fila del usuario con `FOR UPDATE`, relee y comprueba propósito, email actual, caducidad y estado. Reclama condicionalmente el token y modifica el usuario en la misma transacción. Si falla la modificación se revierte el consumo. Confirmaciones concurrentes solo pueden tener un éxito. La confirmación de verificación invalida los otros enlaces de verificación; el reset invalida todos los enlaces pendientes.

`EmailDeliveryBudget` conserva reservas diarias y mensuales sin datos personales: máximo 100/día y 3000/mes, en UTC, compartidos por ambas finalidades. La reserva usa un advisory lock transaccional y el bloqueo del usuario; después comprueba cooldown de 60 segundos, cinco emisiones/hora y cinco tokens simultáneamente válidos por cuenta/finalidad. Las reservas fallidas de entrega no se devuelven automáticamente: comportamiento conservador frente a un resultado de envío incierto. Purgar tokens vencidos no reinicia el presupuesto.

Limpieza recomendada: eliminar periódicamente tokens con `expiresAt` anterior al menos a una hora, y presupuestos de meses ya cerrados. La hora de margen conserva los registros necesarios para el límite móvil incluso si ya se consumieron. No se añade un cron ni se ejecuta limpieza en este bloque.

## JWT y compatibilidad

`auth.service.ts` añade `sessionVersion` al objeto firmado mediante el helper existente. `jwt.ts` permanece intacto. El middleware primero verifica firma/caducidad mediante ese helper y después extrae y valida la versión del mismo JWT ya verificado. Nunca autoriza solo con decode. Ausencia del claim equivale a cero; valor inválido se rechaza. Compara con la versión actual del usuario en PostgreSQL. Un reset incrementa la versión atómicamente: incluso JWT de siete días aún no vencidos dejan de autorizar.

## Despacho y límites operativos

La solicitud pública encola toda la búsqueda/reserva/envío; su respuesta no espera a Resend ni cambia según exista el correo. Cola acotada a 100 trabajos y dos ejecutores, con fallos capturados y sin reintentos automáticos de envíos inciertos. Cada llamada al proveedor tiene un timeout de ocho segundos. Hay límites adicionales por IP para cada ruta; no se amplía `trust proxy` y siguen vigentes sus limitaciones documentadas.

La cola vive en memoria de la instancia: un reinicio puede perder trabajos aceptados. Los tokens y límites ya reservados sí persisten. El usuario puede volver a solicitar después del cooldown. No se garantiza entrega durable ni se promete que HTTP 202 signifique correo entregado. Una cola durable necesitaría un outbox cifrado o infraestructura adicional para no persistir tokens en claro; queda fuera de este bloque. Vigilar resultados seguros de entrega y cuota al habilitar el servicio.

## Configuración de correo

Solo la API instala el SDK oficial `resend`. Variables documentadas en `.env.example`:

| Variable | Uso |
|---|---|
| `MAIL_MODE` | `log` en desarrollo; producción debe configurarlo explícitamente |
| `RESEND_API_KEY` | Clave privada, solo backend; nunca `NEXT_PUBLIC_*` |
| `MAIL_FROM` | Inicialmente `Vitrinaya <onboarding@resend.dev>`; cambiar por remitente de dominio verificado al habilitar terceros |
| `APP_PUBLIC_URL` | Origen del frontend, por ejemplo `https://catalogo-pink.vercel.app`; HTTPS en producción, sin ruta/query/fragmento/credenciales |

Contacto y Reply-To: `vitrinaya983@gmail.com`. No puede utilizarse Gmail como dominio de envío propio de Resend: no controlamos su DNS. No se ha inventado un remitente verificado. `resend.dev` solo permite pruebas a destinatarios autorizados por Resend; no sirve para los vendedores externos. El dominio propio sigue pendiente. La cuota gratuita publicada es 3000/mes y 100/día, compartida con futuras notificaciones, que también deberán reservar presupuesto mediante este mecanismo.

En `MAIL_MODE=log` no se crea un cliente Resend ni se realiza ninguna llamada externa. Solo se registra finalidad y resultado `simulated`; no destinatario, token, cuerpo o enlace. El envío real está deshabilitado fuera de producción incluso si se selecciona accidentalmente `resend`. Las pruebas usan un mailer en memoria. En producción no se imprimen errores del proveedor ni credenciales. No se ha enviado correo real durante el desarrollo.

## Páginas de acción

`/recuperar-contrasena`, `/restablecer-contrasena` y `/verificar-correo` son dinámicas, con noindex/nofollow, no-store y no-referrer. No montan Google Sign-In, analítica ni recursos de terceros. El token viaja en el fragmento del enlace, no en query string: no llega a logs HTTP, HTML servido ni cabeceras Referer. Tras hidratar se conserva solo en memoria del formulario y se retira del historial actual. Recargar pierde el token: hay que reabrir el enlace del correo o solicitar otro.

GET no consume nada. El formulario exige un POST explícito; el de reset exige las dos contraseñas. Los enlaces se construyen exclusivamente desde `APP_PUBLIC_URL`, nunca desde Host, Origin o un destino recibido. El token autoriza su acción concreta y no se devuelve por endpoints de consulta; quien posea ese enlace puede ejercer esa acción, aunque no tenga sesión. No existen listados públicos de tokens.

## Verificación y despliegue

Ejecutar build/test de API y lint/build del frontend, además de las pruebas de navegador. Las pruebas de unidad/HTTP usan dobles y las de navegador una API simulada: no acreditan migración ni concurrencia con PostgreSQL real, entrega Resend ni configuración DNS.

Orden: respaldo y revisión autorizada de base destino → aplicar migración por separado → generar cliente/build y desplegar API → frontend. No desplegar la API antes del esquema: las lecturas User ya requieren las columnas nuevas. La migración no se ha aplicado en desarrollo ni producción. No revertirla borrando datos si se necesita volver al binario anterior; dejar los campos y tablas aditivos. Tras un reset, volver a una API antigua que ignore versiones de sesión reactivaría JWT antiguos: ese rollback necesita conservar el control de versión o invalidar globalmente las sesiones.
