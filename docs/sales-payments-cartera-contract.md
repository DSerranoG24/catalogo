# Contrato de Pagos de la venta (F2a) y Cartera por cobrar (F2)

**Estado:** aprobado por el dueño el 26/11/2026. Incluye sus decisiones ([sección 14](#14-decisiones-del-dueño)) y las correcciones del planificador A a E ([sección 15](#15-correcciones-del-planificador)), que prevalecen sobre cualquier texto anterior. El esquema de F2a-1 está implementado y ensayado en local, **sin aplicar en producción** ([sección 16](#16-esquema-f2a-1-implementado)). Este documento no autoriza despliegues.

Se apoya en el código desplegado de Ventas ([contrato v2.1](sales-contract.md)), Clientes ([historial](customer-sales-history.md)), Inicio ([resumen](dashboard-summary.md)) y el cierre de cuenta (`catalog-api/src/services/account-closure.service.ts`). Sigue el formato de [Gastos F1b](expenses-f1b-contract.md). Si el código y este documento chocan, manda el código: los choques encontrados y cómo se resolvieron están en la [sección 13](#13-choques-con-el-código-y-cómo-se-resuelven).

## 1. Decisiones del dueño que guían el diseño

1. Una venta registra **cómo se pagó**: efectivo, Nequi, Daviplata, transferencia, tarjeta, otro o fiado. Admite varios medios (pago mixto).
2. La parte fiada se vuelve deuda en Cartera. **Fiar exige un cliente vinculado.** Si al entregar queda saldo y la venta no tiene cliente, se cobra todo o se vincula un cliente en ese momento.
3. **La deuda nace al entregar.** Antes, la parte sin pagar es «por cobrar del pedido». El plazo corre desde la entrega.
4. **Plazo por defecto del negocio: 30 días**, editable en cada venta. Define el vencimiento y el estado «vencido». El vencimiento de una venta entregada **se puede cambiar con motivo y registro**.
5. **Cupo de fiado opcional** por cliente. Superarlo avisa en Vender y el dueño decide: no bloquea.
6. **Anticipos:** se pueden registrar pagos en una venta `CONFIRMED` sin entregar.
7. **Abonos:** por defecto se aplican a la deuda más antigua del cliente; se puede elegir una venta. **Un abono no puede superar lo que se debe**; la app muestra la deuda y ofrece «Abonar el total».
8. Venta cancelada o devuelta con dinero recibido: **primero reduce la deuda de esa venta**; lo que sobre queda como **saldo a favor** del cliente. Ese saldo se usa como medio de pago en otra venta, se cruza a mano contra sus deudas o se devuelve con «Devolver dinero» (registrado, con medio de pago). Sin cliente, el sobrante se devuelve en el momento o queda «por devolver». **Nunca se borran pagos.**
9. Una devolución reduce la deuda por el **valor de venta de lo devuelto**, revendible o dañado.
10. **Deudas anteriores a la app:** «Deuda inicial» por cliente (monto, vencimiento y nota), cobrable con abonos como cualquier otra.
11. Cierre de cuenta con cartera abierta: muestra lo que le deben, los saldos a favor, el dinero por devolver y las ventas sin entregar, y deja cerrar si el dueño confirma.
12. Recordatorios por WhatsApp: fuera de alcance (F3). Este contrato deja los datos que F3 necesitará.

**Principios técnicos:** todo por dueño de la sesión; importes COP enteros (`BIGINT`, cadena en JSON) calculados en el servidor; historial inmutable (anular con motivo y movimiento compensatorio, nunca editar ni borrar); operaciones idempotentes con clave persistida y una sola transacción; las lecturas nunca escriben; zona `America/Bogota`; las devoluciones parciales siguen igual en stock.

## 2. Modelo: deuda derivada, no tabla propia

| | Tabla de deuda propia (`receivables`: una fila por venta fiada con `amountDue`, `balance`, `status`) | Deuda derivada (el documento es la venta o la deuda inicial; el saldo sale de un libro de movimientos) |
| --- | --- | --- |
| Lectura de «Te deben» | Suma directa de `balance` | Suma de movimientos agrupada por documento (CTE en SQL) |
| Coherencia | El `balance` guardado puede desviarse de pagos y devoluciones; hay que actualizarlo en cada pago, abono, anulación, cancelación y devolución | No hay saldo guardado que desviar: el saldo es una fórmula sobre filas inmutables |
| Inmutabilidad | La fila de deuda se **edita** en cada abono | Los libros son de **solo inserción** |
| Ventas `CONFIRMED` («por cobrar del pedido») | Habría que crear la fila al entregar y otra cifra aparte antes | La misma fórmula sirve antes y después de entregar |
| Cambios en Ventas | Otra entidad con su propia máquina de estados | Tres columnas nuevas en `"Sale"` |
| Rendimiento | Muy bueno | Bueno con índices por documento; si una cuenta crece mucho se puede añadir una vista materializada sin cambiar el contrato |

**Decisión: deuda derivada.** El documento de la deuda es la venta (o, desde F2-1, la deuda inicial) y su saldo se calcula a partir de un **libro de movimientos de dinero**, de solo inserción. Se guardan en la venta solo los datos que no se pueden derivar: si registra pagos, el plazo pactado y la fecha de vencimiento fijada al entregar.

## 3. Entidades

| Entidad | Tabla | Fase | Papel |
| --- | --- | --- | --- |
| Venta | `"Sale"` (existe) | F2a-1 | Gana `paymentMode`, `paymentTermDays` y `paymentDueDate`. Sigue sin reescribir importes. |
| Movimiento de dinero | `sale_payment_entries` (**nueva**) | F2a-1 | Libro de solo inserción de **un documento**: pagos, saldo a favor usado, excedentes, devoluciones directas y anulaciones. En F2-1 gana las partes de abonos y las deudas iniciales. |
| Saldo a favor | `customer_credit_entries` (**nueva**) | F2a-1 | Libro de solo inserción por cliente: entradas por excedentes, usos, devoluciones de dinero y anulaciones. |
| Recibos de idempotencia | `sale_money_operations` (**nueva**) | F2a-1 | Como `expense_operations`: `(ownerId, operationId)`. Para las operaciones que no son una sola `"SaleOperation"` (anticipos, anulaciones, devoluciones de dinero; abonos en F2). |
| Ajustes de cartera | `receivable_settings` (**nueva**) | F2a-1 | Plazo por defecto del negocio. |
| Abono | `customer_receipts` (**nueva**) | **F2-1** | Dinero recibido de un cliente para su deuda; se reparte en filas `RECEIPT_ALLOCATION`. |
| Deuda inicial | `customer_opening_debts` (**nueva**) | **F2-1** | Documento de deuda anterior a la app (decisión 10). |
| Cambio de vencimiento | `receivable_due_date_changes` (**nueva**) | **F2-1** | Registro de cada cambio de vencimiento con motivo (decisión 4). |
| Cupo | `customers."creditLimit"` (**columna nueva**) | **F2-1** | `BIGINT` nulo: sin cupo. |

### 3.1 Cambios en `"Sale"` (F2a-1)

| Campo | Regla |
| --- | --- |
| `paymentMode` | Enum `SalePaymentMode`: `TRACKED` (registra sus pagos) o `LEGACY` (sin pagos registrados). **Por defecto `LEGACY`**: lo son todas las ventas existentes y las que siga creando la API publicada antes de F2a-2. La API de F2a-2 cambia un borrador a `TRACKED` **al confirmarlo** (también en la conversión de pedidos en modo `CONFIRMED`/`DELIVERED`). Solo se admite `LEGACY → TRACKED` en un `DRAFT`; después es definitivo. |
| `paymentTermDays?` | Plazo en días, de 0 a 365. Se fija al confirmar (por defecto, el del negocio) y se puede cambiar mientras la venta esté `DRAFT` o `CONFIRMED`. Nulo en `LEGACY`. |
| `paymentDueDate?` | `DATE` de Bogotá. Se fija **al entregar**: fecha de Bogotá de `deliveredAt` + `paymentTermDays`. Se fija siempre en ventas `TRACKED` entregadas, aunque estén pagadas. Se puede cambiar en una venta `DELIVERED` (decisión 4, con registro desde F2-1) y nunca vuelve a nulo. Nulo en `LEGACY`. |

Además: `UNIQUE ("id", "userId")` para las FKs compuestas. El cliente de una venta `TRACKED` queda fijo una vez entregada (corrección B). El trigger `sale_status_transition_guard` no cambia.

### 3.2 Movimiento de dinero (`sale_payment_entries`, F2a-1)

| Campo | Regla |
| --- | --- |
| `id`, `ownerId`, `saleId` | FK compuesta `(saleId, ownerId)` → `"Sale"("id", "userId")`. En F2-1, `saleId` pasa a ser nulo y se añade `openingDebtId`, con CHECK de exactamente un documento. |
| `kind` | Enum `SalePaymentEntryKind` (tabla abajo). `RECEIPT_ALLOCATION` se añade en F2-1. |
| `amount` | `BIGINT` de 1 a 1e12. El signo lo da `kind`. |
| `method?`, `methodNote?`, `reference?` | Enum `SalePaymentMethod`: `CASH`, `NEQUI`, `DAVIPLATA`, `BANK_TRANSFER`, `CARD`, `OTHER`. `OTHER` exige nota de 3 a 80 caracteres; los demás la exigen nula. `reference` de 1 a 100 caracteres. **Fiado no es un medio**: es el saldo que queda sin pagar. |
| `cashReceived?` | Solo en `PAYMENT` con `CASH`: efectivo entregado por el cliente, `>= amount`. Informativo ([sección 6](#6-efectivo-recibido-y-cambio)). |
| `creditEntryId?` | En `CREDIT_USE`, `EXCESS_TO_CREDIT` y sus anulaciones: el movimiento de saldo a favor emparejado. FK compuesta y **único**: cada movimiento de saldo se empareja con una sola entrada. |
| `reversesEntryId?` | En `REVERSAL`: la entrada anulada, de la misma venta (FK `(reversesEntryId, saleId)`). **Único**: se anula una sola vez. |
| `reason?` | Obligatorio en `REVERSAL` (3 a 300 caracteres); opcional en `SALE_REFUND`; prohibido en el resto. |
| `operationId`, `position` | La operación que la creó (recibo de venta o de cartera) y su número dentro de ella. `UNIQUE (ownerId, operationId, saleId, position)`: repetir una operación nunca duplica movimientos. |
| `createdAt` | Instante del servidor. |

| `kind` | Efecto sobre lo pagado de la venta | Cuándo nace |
| --- | --- | --- |
| `PAYMENT` | + | Al confirmar, como anticipo en `CONFIRMED` o al entregar, con un medio real. |
| `CREDIT_USE` | + | Saldo a favor del cliente usado como medio de pago o cruzado a mano contra la deuda (decisión 8). |
| `RECEIPT_ALLOCATION` (F2-1) | + | Parte de un abono aplicada a este documento. |
| `EXCESS_TO_CREDIT` | − | El dinero que sobra al cancelar, devolver o anular pasa al saldo a favor del cliente. |
| `SALE_REFUND` | − | Dinero devuelto directamente desde una venta **sin cliente** («Devolver ahora» o después). |
| `REVERSAL` | El contrario de la entrada anulada | Anular un pago, un uso de saldo, una parte de abono, un excedente o una devolución directa. |

### 3.3 Saldo a favor (`customer_credit_entries`, F2a-1)

| Campo | Regla |
| --- | --- |
| `id`, `ownerId`, `customerId` | FK compuesta `(customerId, ownerId)` → `customers`. |
| `kind` | `FROM_SALE` (+, excedente de una venta), `USED` (−, usado en una venta), `REFUND` (−, «Devolver dinero»), `REVERSAL` (contrario de la anulada). |
| `amount` | `BIGINT` de 1 a 1e12. |
| `saleId?` | Obligatorio en `FROM_SALE` y `USED`; en `REVERSAL`, el mismo que la entrada anulada; nulo en `REFUND`. FK compuesta. |
| `method?`, `methodNote?`, `reference?` | Solo en `REFUND`: con qué medio se devolvió. |
| `reversesEntryId?`, `reason?` | Como en el libro de la venta (FK `(reversesEntryId, customerId)`). |
| `operationId`, `position`, `createdAt` | `UNIQUE (ownerId, operationId, position)`. |

Saldo del cliente = Σ con signo; nunca negativo. Toda entrada con venta (`FROM_SALE`, `USED` y sus anulaciones) está emparejada con una entrada del libro de esa venta.

### 3.4 Abono (`customer_receipts`, F2-1)

`id`, `ownerId`, `customerId`, `amount`, `method`, `methodNote?`, `reference?`, `cashReceived?`, `receivedOn` (fecha de Bogotá, hoy por defecto, nunca futura), `targetDocument?` (venta o deuda inicial elegida; nulo = la más antigua), `operationId`, `createdAt`. **Solo inserción**: anular un abono es una `REVERSAL` de cada una de sus partes, con motivo, y el estado «anulado» se deriva de ellas. Invariante: `amount` = Σ de sus partes.

### 3.5 Deuda inicial (`customer_opening_debts`, F2-1)

Decisión 10. Es un **documento de deuda** como una venta entregada, sin líneas ni stock:

| Campo | Regla |
| --- | --- |
| `id`, `ownerId`, `customerId` | FK compuesta. |
| `amount` | `BIGINT` de 1 a 1e12. No se edita. |
| `dueDate` | `DATE` de Bogotá. Se cambia como el vencimiento de una venta, con motivo y registro. |
| `note?` | Hasta 300 caracteres. |
| `status`, `voidedAt?`, `voidReason?` | `ACTIVE` o `VOIDED`, terminal. Anular exige motivo. Como al cancelar una venta, lo abonado neto pasa a saldo a favor del cliente. |
| `operationId`, `createdAt` | Idempotencia y fecha de registro. |

Se cobra con abonos y cruces de saldo a favor sobre el mismo libro (`sale_payment_entries` con `openingDebtId`). Su saldo = `amount` (0 si `VOIDED`) − lo pagado neto.

### 3.6 Ajustes, cupo, vencimientos e idempotencia

- `receivable_settings` (F2a-1): `ownerId` (PK), `defaultTermDays` (0 a 365, por defecto **30**), `version`, `createdAt`, `updatedAt`. Se edita, nunca se borra. Si la cuenta no tiene fila se usa 30 y la lectura no la crea.
- `customers."creditLimit"` (F2-1): `BIGINT` nulo o de 1 a 1e12, editado con `PATCH /customers/:id`.
- `receivable_due_date_changes` (F2-1): `id`, `ownerId`, `saleId?` o `openingDebtId?`, `previousDueDate`, `newDueDate`, `reason` (3 a 300), `operationId`, `createdAt`. Solo inserción.
- `sale_money_operations` (F2a-1): `(ownerId, operationId)` PK, `requestId` con `UNIQUE (ownerId, requestId)`, `kind`, `resourceId`, `requestHash` (SHA-256 sin `requestId`), `responseSnapshot`, `createdAt`. Solo inserción. Los pagos dentro de `confirm`, `deliver`, `cancel`, `returns` y la conversión usan el recibo existente de esa operación de venta.

## 4. Estados de la venta y efecto de los pagos

La máquina de estados de Ventas **no cambia**. Los pagos añaden una etapa de cobro derivada, que no se guarda:

| Estado de la venta | Etapa de cobro | Qué significa el saldo |
| --- | --- | --- |
| `DRAFT` | — | No admite pagos. |
| `CONFIRMED` | «Por cobrar del pedido» si saldo > 0; «Pagada» si 0 | Todavía no es deuda; no tiene vencimiento ni cuenta en Cartera. Admite anticipos. |
| `DELIVERED` (incluida «Devuelta parcialmente») | «Fiada» / «Vencida» si saldo > 0; «Pagada» si 0; «Por devolver» si sobra dinero y no hay cliente | Es deuda del cliente, con vencimiento. |
| `CANCELLED`, `RETURNED` | «Sin saldo» o «Por devolver» (sin cliente) | El total efectivo es 0; todo lo recibido es excedente. |

| Acción | Estados | Efecto en el dinero |
| --- | --- | --- |
| Confirmar (`confirm`, y la conversión de pedidos: corrección D) | `DRAFT` → `CONFIRMED`/`DELIVERED` | Marca la venta `TRACKED`, registra los pagos y fija `paymentTermDays`. Con entrega inmediata, se aplican las reglas de «Entregar». |
| Anticipo (`payments`) | `CONFIRMED` | Añade `PAYMENT` o `CREDIT_USE`; nunca por encima del saldo. |
| Vincular o cambiar el cliente (corrección B) | `CONFIRMED` | Copia los datos del cliente (instantáneas) al vincular. No se permite si la venta usa saldo a favor del cliente anterior sin anular. |
| Entregar (`deliver`) | `CONFIRMED` → `DELIVERED` | Puede registrar pagos y **vincular un cliente** en el mismo commit (decisión 2). Fija `paymentDueDate`. Si queda saldo, nace la deuda: exige cliente. Después de entregar, el cliente ya no se cambia. |
| Cambiar el vencimiento | `DELIVERED` | Con motivo; queda registrado (decisión 4). |
| Cancelar (`cancel`) | `CONFIRMED` → `CANCELLED` | Lo pagado neto pasa entero a saldo a favor (`EXCESS_TO_CREDIT` + `FROM_SALE`). Sin cliente: «Devolver ahora» (`SALE_REFUND`) o queda «por devolver». **No hay deuda que reducir**: la venta no se había entregado. |
| Devolución parcial (`returns`) | `DELIVERED` | Baja el total efectivo por el valor de venta de lo devuelto (decisión 9). Si lo pagado supera el nuevo total, el exceso va al saldo a favor (o, sin cliente, se devuelve o queda por devolver). Si no, solo baja la deuda. El stock sigue exactamente igual que hoy. |
| Devolución que completa (`returns`) | `DELIVERED` → `RETURNED` | Total efectivo 0: todo lo pagado neto es excedente. |
| Abono, cruce de saldo a favor (F2) | Ventas `DELIVERED` y deudas iniciales con saldo | `RECEIPT_ALLOCATION` o `CREDIT_USE` en uno o varios documentos. |
| Anular un movimiento | Cualquiera salvo `DRAFT` | `REVERSAL` con motivo (sección 5.5). |

Toda operación que cambie el saldo de una venta **sube su versión** (las transiciones con la subida que ya hacen; anticipos, anulaciones, cambios de plazo, de cliente o de vencimiento, abonos y cruces con la suya). Una pantalla con datos viejos recibe `VERSION_CONFLICT`.

## 5. Fórmulas

Todas en el servidor, en BigInt, sobre filas propias del dueño.

### 5.1 Venta

```text
valorDevuelto  = Σ (unitPrice − unitDiscount) × receivedQuantity    de todas las devoluciones (revendible o dañado: decisión 9)
totalEfectivo  = 0                         si CANCELLED o RETURNED
               = total − valorDevuelto     en otro caso
pagadoNeto     = Σ PAYMENT + Σ CREDIT_USE + Σ RECEIPT_ALLOCATION
               − Σ EXCESS_TO_CREDIT − Σ SALE_REFUND
               ± REVERSAL (contrario de la entrada anulada)
saldo          = totalEfectivo − pagadoNeto
porDevolver    = máx(−saldo, 0)            solo en ventas sin cliente
```

- `valorDevuelto` es la misma definición que usa Inicio ([resumen](dashboard-summary.md)), exacta porque un CHECK garantiza `lineTotal = (unitPrice − unitDiscount) × quantity`.
- `total`, `subtotal` y las líneas **no se reescriben nunca**.
- Después de cada operación, si `saldo < 0` y la venta tiene cliente, en la misma transacción se crea `EXCESS_TO_CREDIT` por `−saldo` y el `FROM_SALE` emparejado: la venta queda en 0. Sin cliente, el saldo negativo es «por devolver» y aparece como aviso hasta que se registra la devolución.

Deuda inicial (F2-1): `totalEfectivo` = `amount` (0 si `VOIDED`); el resto igual.

### 5.2 Cliente

```text
deudaCliente          = Σ saldo   de sus ventas TRACKED en DELIVERED y sus deudas iniciales, con saldo > 0
deudaVencida          = Σ saldo   de esos documentos con vencimiento < hoy (Bogotá)
porCobrarDePedidos    = Σ saldo   de sus ventas TRACKED en CONFIRMED
saldoAFavor           = Σ FROM_SALE − Σ USED − Σ REFUND ± REVERSAL
exposiciónParaCupo    = deudaCliente + porCobrarDePedidos + saldo de la venta que se está cobrando
```

- **Vencida:** saldo > 0 y vencimiento < hoy. El día del vencimiento todavía no está vencida. Días de mora = `hoy − vencimiento`.
- **Más antigua primero** (orden de aplicación de abonos y cruces, decisión 10): **fecha de vencimiento** ascendente (`paymentDueDate` de la venta o `dueDate` de la deuda inicial); a igual vencimiento, la entrega o el registro más antiguo; después `id`.
- El cupo se compara con `exposiciónParaCupo`; superarlo solo genera un aviso.
- «Te deben» = Σ `deudaCliente` de la cuenta. «Por cobrar de pedidos» se informa aparte y **no** suma en «Te deben».

### 5.3 Ejemplo principal: venta de $300.000

Venta de $300.000 (2 unidades de $150.000) con cliente y plazo de 30 días. Se confirma y entrega el 1 de diciembre con $100.000 en efectivo y $200.000 fiados.

| Paso | valorDevuelto | totalEfectivo | pagadoNeto | saldo | Deuda | Saldo a favor |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Entrega (1/12): `PAYMENT` 100.000 CASH | 0 | 300.000 | 100.000 | 200.000 | 200.000, vence el 31/12 | 0 |
| Devolución parcial de $150.000 | 150.000 | 150.000 | 100.000 | 50.000 | **50.000** | 0 |
| Devolución del resto ($150.000) → `RETURNED` | 300.000 | 0 | 100.000 → 0 tras `EXCESS_TO_CREDIT` 100.000 | 0 | **0** | **100.000** |

La devolución primero se come la deuda (200.000 → 50.000) y solo lo que sobra después de la deuda pasa a saldo a favor: lo recibido en efectivo (100.000). El ensayo de F2a-1 reproduce este caso.

**Devolución total de una sola vez:** `totalEfectivo` 0, `pagadoNeto` 100.000 → `EXCESS_TO_CREDIT` 100.000. Deuda 0 y saldo a favor 100.000.

**Con abono previo:** tras la entrega, el cliente abona 120.000. `pagadoNeto` 220.000 y deuda 80.000. Luego devuelve $150.000: `saldo` = 150.000 − 220.000 = −70.000 → `EXCESS_TO_CREDIT` 70.000. Deuda 0 y saldo a favor 70.000.

### 5.4 Más ejemplos

- **Pago mixto:** venta de $85.000 → `PAYMENT` 50.000 NEQUI + `PAYMENT` 35.000 CASH (`cashReceived` 50.000; la pantalla muestra cambio de 15.000).
- **Anticipo y cancelación:** venta `CONFIRMED` de $500.000 con anticipo de $200.000 por transferencia. Se cancela: `EXCESS_TO_CREDIT` 200.000 y el cliente tiene $200.000 a favor. «Devolver dinero» $200.000 por Nequi (`REFUND`) deja el saldo en 0. Ningún pago se borra.
- **Saldo a favor usado:** con $70.000 a favor, el cliente compra $90.000: `CREDIT_USE` 70.000 (y `USED` 70.000) + `PAYMENT` 20.000 CASH.
- **Sin cliente:** venta de $60.000 pagada en efectivo y entregada; el comprador la devuelve completa. Quedan $60.000 «por devolver» hasta que se registra `SALE_REFUND` 60.000 CASH.
- **Abono repartido con deuda inicial:** deuda inicial de $50.000 con vencimiento 30/11 y venta fiada de $80.000 con vencimiento 10/12. Abono de $70.000 sin documento elegido: 50.000 a la deuda inicial y 20.000 a la venta. Deuda restante 60.000. Un abono de $140.000 se rechaza (`RECEIPT_EXCEEDS_DEBT`, deuda 130.000).
- **Cruce manual de saldo a favor (decisión 2):** el cliente tiene $30.000 a favor y $60.000 de deuda. El dueño pulsa «Cruzar saldo a favor» en la ficha del cliente: `CREDIT_USE` 30.000 en la deuda más antigua (y `USED` 30.000). Deuda 30.000 y saldo 0. Nunca ocurre solo.

### 5.5 Anulaciones

- **Anular un pago, un uso de saldo, una parte de abono o una devolución directa** crea su `REVERSAL` con motivo.
- Si la venta ya había pasado excedente al saldo a favor, la anulación **revierte primero ese excedente** hasta el importe anulado (`REVERSAL` del `EXCESS_TO_CREDIT` y del `FROM_SALE`). Si el cliente ya usó o le devolvieron ese saldo y no le queda suficiente, `409 CREDIT_ALREADY_USED`: primero hay que anular ese uso o esa devolución.
- **Anular un abono** anula todas sus partes en una transacción. Si una falla, no se anula nada.
- **Anular un uso de saldo** devuelve el saldo al cliente (`REVERSAL` del `USED`, emparejada con la `REVERSAL` de la venta).
- **Anular una devolución de dinero** (`REFUND` o `SALE_REFUND`) vuelve a dejar ese dinero a favor o por devolver.
- **Anular una deuda inicial** (F2-1): pasa a `VOIDED` con motivo; lo abonado neto pasa a saldo a favor.
- Las anulaciones nunca se anulan: para corregir, se registra el movimiento de nuevo.

### 5.6 Invariantes

Comprobadas por el servicio bajo el bloqueo de la cuenta y por la base de datos al confirmar la transacción (sección 16):

1. En una venta `TRACKED`: `0 <= pagadoNeto <= total`. Si tiene cliente, además `pagadoNeto <= totalEfectivo` (el exceso debe pasar al saldo a favor en la misma transacción). Sin cliente puede quedar `pagadoNeto > totalEfectivo`: es lo «por devolver».
2. El saldo a favor de cada cliente nunca es negativo.
3. Toda entrada de saldo con venta está emparejada con una entrada de esa venta del mismo tipo, importe y cliente.
4. Los usos de saldo vigentes de una venta son del cliente actual de la venta.
5. Toda fila referencia filas del mismo `ownerId` (FKs compuestas).
6. Una venta `LEGACY` o un borrador no tienen movimientos.
7. Cada abono suma exactamente sus partes (F2-1).

No hay redondeos: todo son pesos enteros y no hay porcentajes ni impuestos.

## 6. Efectivo recibido y cambio

**Corrección E:** el efectivo recibido es un **dato informativo por pago** (`cashReceived`, solo en pagos en efectivo, `>= amount`). El cambio **no se guarda**: es `cashReceived − amount` y solo se muestra en Vender y en el historial de la venta. Nunca suma en ningún total: lo cobrado es `amount`.

## 7. Integración

### 7.1 Vender (cobro)

- Al confirmar: bloque «Cómo pagó» con una o varias filas de medio e importe, «Usar saldo a favor» (si el cliente tiene) y «Fiado» por el resto (desde F2). «Fiado» exige cliente; sin cliente, se puede vincular uno ahí mismo.
- Con saldo pendiente, el plazo aparece con el valor del negocio (30 días) y se puede cambiar; se muestra la fecha de vencimiento que quedará al entregar.
- **Cupo:** antes de confirmar o entregar con fiado, la pantalla lee la cartera del cliente; si `exposiciónParaCupo` supera el cupo, avisa («Supera el cupo en $X») y el dueño decide. El servidor no bloquea y devuelve `creditLimitExceeded`.
- En efectivo, campo opcional «Recibido» y el cambio calculado.
- En una venta `CONFIRMED`: «Registrar anticipo» y «Cambiar cliente». Al entregar, el diálogo muestra lo pendiente y ofrece cobrarlo o, si no hay cliente, vincular uno para fiarle (decisión 2).
- Al cancelar o devolver una venta sin cliente con dinero recibido: «Devolver ahora» (con medio de pago) o dejarlo «por devolver».

### 7.2 Historial de la venta

El detalle añade el bloque **Pagos**: total, valor devuelto, total efectivo, pagado, saldo, etapa, plazo, vencimiento (con sus cambios y motivos), días de mora y la lista cronológica de movimientos (medio, importe, cambio, operación y anulaciones con su motivo). «Anular» pide motivo con el AlertDialog de Radix.

### 7.3 Inicio

- Tarjeta **«Te deben»** (F2): Σ deuda de la cuenta, con «vencido: $X» debajo. Hoy está oculta a propósito (`SummaryCards.tsx`).
- **«Requiere tu atención»**: «n cuentas vencidas» (F2) y «n devoluciones de dinero pendientes» (ventas sin cliente con por devolver, F2a), con «Ver».
- `summary` gana `receivables: { debtTotal, overdueTotal, overdueCount, pendingOrderBalance, creditTotal, refundDueTotal, refundDueCount }` y `modules.receivables`. Sigue siendo `READ ONLY`.
- **Las ventas y la utilidad no cambian:** Inicio sigue contando ventas por confirmación (devengo). Fiar no resta ventas y cobrar no las suma.

### 7.4 Cierre de cuenta (corrección C)

- `GET /auth/close/preview` (solo lectura): lo que le deben (total y por cliente), saldos a favor, dinero por devolver, ventas `CONFIRMED` sin entregar y pedidos sin resolver.
- `POST /auth/close` gana `confirmOpenBalances: boolean`. Si alguna de esas cifras no es cero y no viene en `true`, `409 ACCOUNT_CLOSURE_REQUIRES_CONFIRMATION` con las cifras. Con `true`, cierra.
- El bloqueo actual por pedidos sin resolver **no cambia** (`ACCOUNT_ORDERS_REQUIRE_REVIEW`).
- **Sin botón de exportar hasta F5**: no existe ninguna exportación.
- Cerrar no borra ni transforma pagos, abonos ni saldos.
- El cierre toma el bloqueo único de la cuenta (corrección A, sección 8).

### 7.5 Lo que leerán F5 (Reportes) y F3 (Recordatorios)

- **F5:** cobros por medio y por día, cartera por edades (0–30, 31–60, 61–90, más de 90 días de mora), cobros frente a ventas (caja frente a devengo), saldos a favor, devoluciones de dinero y exportación. Todo sale de los libros sin columnas nuevas.
- **F3:** por documento con saldo: vencimiento, saldo, días de mora, cliente y teléfono. El teléfono que se usaría es el actual de `customers.phone`, con `customerPhoneSnapshot` de la venta como respaldo; F3 lo confirmará. F3 guardará sus propios envíos.

## 8. API

Privada, con cookie HttpOnly y proxy same-origin, `Cache-Control: private, no-store`, Zod estricto (campos desconocidos: 400), cuerpos JSON de hasta 32 KiB y propietario siempre de la sesión. Escrituras con `{operationId, requestId}` e idempotencia de Ventas v2.1: recibo por `(ownerId, operationId)`, hash sin `requestId`, repetición resuelta **antes** de comprobar estado y versión.

```text
payment = { method, amount, methodNote?, reference?, cashReceived? }
refund  = { method, methodNote?, reference? }
```

### F2a-2: pagos de la venta

| Método y ruta | Cuerpo | Efecto |
| --- | --- | --- |
| `POST /sales/:id/confirm` (cambia) | Lo de hoy + `payments[0..10]`, `customerCreditAmount?`, `paymentTermDays?` | Marca `TRACKED`. Σ pagos + saldo usado ≤ total. Con `deliverImmediately`: reglas de `deliver`. |
| `POST /sales/:id/deliver` (cambia) | Lo de hoy + `payments[0..10]`, `customerCreditAmount?`, `customerId?` | Fija `paymentDueDate`. Con saldo > 0: exige cliente (el de la venta o `customerId`); hasta F2, `CREDIT_NOT_ENABLED`. |
| `POST /orders/:orderId/convert-to-sale` (cambia, corrección D) | Lo de hoy + `payments[]`, `customerCreditAmount?`, `paymentTermDays?` | Mismas reglas que `confirm` en `mode` `CONFIRMED`/`DELIVERED`. |
| `POST /sales/:id/cancel`, `…/returns` (cambian) | Lo de hoy + `refundNow?: refund` | Calculan y mueven el excedente; `refundNow` solo sin cliente («Devolver ahora»). La respuesta trae el bloque `payments`. |
| `POST /sales/:id/payments` | `operationId`, `requestId`, `expectedVersion`, `payments[1..10]`, `customerCreditAmount?` | Anticipo; solo `CONFIRMED`. |
| `POST /sales/:id/customer` | `operationId`, `requestId`, `expectedVersion`, `customerId` | Vincular o cambiar el cliente de una venta `CONFIRMED` (corrección B), con instantáneas nuevas. |
| `POST /sales/:id/payments/:entryId/void` | `operationId`, `requestId`, `expectedVersion`, `reason` | Sección 5.5. |
| `PATCH /sales/:id/payment-terms` | `operationId`, `requestId`, `expectedVersion`, `paymentTermDays` | Solo `CONFIRMED`. |
| `POST /sales/:id/refunds` | `operationId`, `requestId`, `expectedVersion`, `amount`, `refund` | Venta sin cliente con por devolver. |
| `POST /customers/:id/credit/refunds` y `…/:entryId/void` | `operationId`, `requestId`, `amount`, `refund` / `reason` | «Devolver dinero» del saldo a favor y su anulación. |
| `GET /sales/:id`, `GET /sales` (cambian) | — | Bloque `payments` con las cifras de 5.1 y, en el detalle, los movimientos. |
| `GET /receivables/settings`, `PUT /receivables/settings` | `{ expectedVersion?, defaultTermDays }` | Plazo por defecto; el `GET` sin fila devuelve 30 y no escribe. |
| `GET /auth/close/preview`, `POST /auth/close` (cambia) | Sección 7.4 | Cierre con vista previa y confirmación. |

### F2-2: cartera

| Método y ruta | Cuerpo o parámetros | Efecto |
| --- | --- | --- |
| `GET /receivables?filter=open\|overdue&cursor` | — | Clientes con deuda, saldo a favor o por cobrar: cifras de 5.2, documento más antiguo y vencimiento más próximo. 25 por página. Totales de la cuenta. |
| `GET /customers/:id/receivables` | — | Documentos con saldo, vencimientos y mora, abonos, saldo a favor y sus movimientos, cupo y exposición. |
| `POST /customers/:id/receipts` | `operationId`, `requestId`, `amount`, `method`, `methodNote?`, `reference?`, `cashReceived?`, `receivedOn?`, `saleId?` o `openingDebtId?`, `expectedDebt?` | Abono por antigüedad o al documento elegido. `amount` ≤ deuda. Con `expectedDebt` distinto de la deuda actual: `409 BALANCE_CHANGED` («Abonar el total» lo envía siempre). |
| `POST /customers/:id/receipts/:receiptId/void` | `operationId`, `requestId`, `reason` | Sección 5.5. |
| `POST /customers/:id/credit/apply` | `operationId`, `requestId`, `amount`, `saleId?` o `openingDebtId?`, `expectedCredit?` | Cruce manual del saldo a favor contra sus deudas (decisión 2), por antigüedad o al documento elegido. |
| `POST /customers/:id/opening-debts` | `operationId`, `requestId`, `amount`, `dueDate`, `note?` | Deuda inicial (decisión 10). |
| `POST /customers/:id/opening-debts/:debtId/void` | `operationId`, `requestId`, `reason` | Anular la deuda inicial. |
| `POST /sales/:id/due-date`, `POST /customers/:id/opening-debts/:debtId/due-date` | `operationId`, `requestId`, `expectedVersion`, `dueDate`, `reason` | Cambiar el vencimiento con registro (decisión 4). |
| `PATCH /customers/:id` (cambia) | + `creditLimit` (cadena o `null`) | Cupo. |

### Errores nuevos

- **400** `INVALID_PAYMENT_INPUT`: Zod, `OTHER` sin nota, `cashReceived` inválido, plazo fuera de 0 a 365, fecha futura, `refundNow` con cliente.
- **404** `PAYMENT_NOT_FOUND`, `RECEIPT_NOT_FOUND`, `CREDIT_ENTRY_NOT_FOUND`, `OPENING_DEBT_NOT_FOUND`, más `NOT_FOUND` y `CUSTOMER_NOT_FOUND`. Lo ajeno responde como inexistente.
- **409** `PAYMENT_EXCEEDS_BALANCE`, `CUSTOMER_REQUIRED_FOR_CREDIT`, `INVALID_PAYMENT_STATE` (también ventas `LEGACY`), `PAYMENT_ALREADY_VOIDED`, `CREDIT_INSUFFICIENT`, `CREDIT_ALREADY_USED`, `CUSTOMER_CHANGE_BLOCKED` (usa saldo del cliente anterior, o la venta ya se entregó), `RECEIPT_EXCEEDS_DEBT`, `NO_OPEN_DEBT`, `BALANCE_CHANGED`, `CREDIT_NOT_ENABLED` (fiado antes de F2), `ACCOUNT_CLOSURE_REQUIRES_CONFIRMATION`, y los existentes `VERSION_CONFLICT`, `INVALID_TRANSITION`, `IDEMPOTENCY_CONFLICT` y `CUSTOMER_ARCHIVED`.
- **500** `SALE_OPERATION_FAILED` / `RECEIVABLES_UNAVAILABLE`. El log lleva solo el código.

### Orden de bloqueo único (corrección A)

Implementado en F2a-2a (26/11/2026); el detalle, el inventario anterior y las pruebas están en la [sección 15.A](#15-correcciones-del-planificador). Toda operación que **mueva dinero o existencias** toma **primero** el bloqueo por cuenta con `lockAccountForMoney(tx, ownerId)` (`catalog-api/src/repositories/account-lock.ts`):

| Paso | Operaciones de dinero y existencias | Cierre de cuenta |
| --- | --- | --- |
| 1 | `pg_advisory_xact_lock(hashtext('account-money-v1'), hashtext(ownerId))` | El mismo (`accountClosureMoneyLock`) |
| 2 | `users` `FOR SHARE`, rechazando una cuenta cerrada (`ACCOUNT_CLOSED`) | Pedidos `FOR UPDATE` en orden de `id` |
| 3 | Otros bloqueos de asesoría por cuenta (`inventory-identity-v1`…) | Catálogos `FOR UPDATE` en orden de `id` |
| 4 | Filas `FOR UPDATE`, por tipo y después por `id`: pedido → cliente → venta o deuda inicial → filas de gastos (plantilla, pago programado, gasto, categoría) → lote → artículos de inventario | `users` `FOR UPDATE` |

- **Por qué el bloqueo de asesoría va antes que `users`:** el cierre de cuenta no puede tomar `users` primero. El trigger `guard_closed_catalog_write` toma `users FOR SHARE` *después* de bloquear el pedido o el catálogo en la emisión de cotizaciones, los cambios de estado del pedido, la anonimización, los pedidos públicos y las ediciones de catálogo. Con `users FOR UPDATE` al principio del cierre, cualquiera de ellas lo trabaría. El bloqueo de asesoría es un punto común anterior a cualquier fila y no lo toma ningún trigger.
- **Qué resuelve:** la conversión de pedidos (`users` → pedido) y el cierre (pedidos → catálogos → `users`) se serializan en el paso 1 y ya no se traban. Una operación que espera mientras se cierra la cuenta obtiene el bloqueo después y falla en el paso 2 con `ACCOUNT_CLOSED`, como antes.
- **Sustituye a `expenses-v1`:** Gastos (todas sus mutaciones y `sync`) usa el mismo bloqueo; su idempotencia no cambia, porque el recibo se sigue buscando bajo un bloqueo exclusivo por cuenta.
- Abono (cliente → varias ventas) y cancelación (venta → cliente) tampoco se cruzarán en F2a-2b: los dos pasan antes por el paso 1.
- **No lo toman**, porque no mueven dinero ni existencias: las lecturas, los borradores (`POST /sales`, `PATCH /sales/:id`), clientes, compatibilidades, fichas comerciales, publicación en catálogos, la hoja de inventario y las cotizaciones.

Las lecturas (`GET`) no escriben y se calculan en una transacción `READ ONLY`.

## 9. Privacidad y aislamiento

- Todo filtra por el dueño de la sesión; las FKs compuestas `(…, ownerId)` impiden mezclar cuentas entre ventas, clientes, saldos y movimientos.
- **No se guardan datos personales nuevos.** `reference`, `methodNote` y `note` son texto libre: la interfaz avisa de no escribir números de tarjeta ni documentos. Nunca se guardan datos de tarjeta.
- Nada de pagos, abonos ni saldos va a los logs; solo códigos de error.
- Cartera solo muestra nombre y teléfono del cliente a su dueño.
- La retención provisional de 12 meses ([decisiones](decisiones.md)) deberá incluir los libros nuevos cuando se automatice la anonimización. Importes y fechas no son datos personales; el vínculo con el cliente sí.

## 10. Ventas anteriores a F2a

- La migración añade `paymentMode` con valor por defecto `LEGACY`, **sin reescribir filas ni ejecutar `UPDATE`**: todas las ventas existentes quedan `LEGACY`. El valor por defecto sigue siendo `LEGACY` para que la API anterior a F2a-2, si sigue publicada tras la migración, no cree ventas «con seguimiento» sin pagos.
- La API de F2a-2 cambia a `TRACKED` cada borrador **al confirmarlo**. Los borradores que ya existían también, porque todavía no se han cobrado.
- **No se inventan pagos.** Una venta `LEGACY` no aparece en Cartera, no tiene saldo y se muestra como «Pago no registrado (venta anterior)». Una `LEGACY` `CONFIRMED` que se entregue después sigue `LEGACY`.
- Cancelaciones y devoluciones de ventas `LEGACY` funcionan igual que hoy y no generan saldo a favor.
- Las deudas que el negocio ya tenía se cargan como **deuda inicial** (F2-1), no reabriendo ventas antiguas.

## 11. Casos límite

| Caso | Resultado |
| --- | --- |
| Pago y cancelación a la vez | Se serializan por el bloqueo de la cuenta. Si va primero el pago, la cancelación lo ve y lo mueve. Si va primero la cancelación, el pago recibe `409 INVALID_PAYMENT_STATE`. |
| Dos abonos simultáneos | Se serializan. El segundo ve la deuda ya reducida; si la supera, `RECEIPT_EXCEEDS_DEBT`; con `expectedDebt`, `BALANCE_CHANGED`. |
| Conversión de pedido y cierre de cuenta a la vez | Se serializan en el paso 1; ya no hay interbloqueo. Si gana el cierre, la conversión falla con `AUTH_REQUIRED`. |
| Doble clic o respuesta perdida | Misma `operationId`: el mismo recibo, sin repetir efectos. La base de datos impide además repetir `(operación, venta, posición)`. |
| Venta sin cliente con saldo al entregar | Se cobra todo o se vincula un cliente en la entrega; si no, `CUSTOMER_REQUIRED_FOR_CREDIT`. |
| Cambiar el cliente de una venta confirmada | Permitido con instantáneas nuevas. Si usó saldo a favor del cliente anterior, primero hay que anular ese uso (la base de datos lo rechaza al confirmar). |
| Cambiar el cliente después de entregar | Rechazado (`CUSTOMER_CHANGE_BLOCKED`; en la base de datos, `SALE_CUSTOMER_LOCKED`). |
| Cliente borrado | No es posible: `DELETE /customers/:id` responde 405 y los clientes se archivan. |
| Cliente archivado con deuda o saldo a favor | Sigue en Cartera con «Archivado». Admite abonos, cruces y devoluciones de dinero; no se usa en ventas nuevas (`CUSTOMER_ARCHIVED`, como hoy). |
| Devolución de una venta ya abonada | Baja la deuda y el resto pasa a saldo a favor (ejemplo con abono previo, 5.3). El abono no se toca. |
| Saldo a favor usado en una venta luego cancelada | Su pagado neto, incluido el saldo usado, vuelve al saldo a favor con `EXCESS_TO_CREDIT`. |
| Anular un pago cuyo excedente ya se devolvió | `CREDIT_ALREADY_USED`: primero se anula la devolución o el uso. |
| Anular un pago en una venta entregada sin cliente | Se permite (es una corrección): queda saldo sin cliente, visible como aviso; se salda con un pago nuevo en la venta. |
| Dinero por devolver sin cliente | Aviso en Inicio hasta que se registra la devolución. |
| Deuda inicial con vencimiento ya pasado | Vencida desde el principio; entra primero en el orden de abonos. |
| Anular una deuda inicial ya abonada | Lo abonado pasa a saldo a favor del cliente. |
| Venta de neto cero | No necesita pagos; saldo 0. |
| Pagar de más en Vender | `PAYMENT_EXCEEDS_BALANCE`. El efectivo de más es `cashReceived` y su cambio, no un pago. |
| Plazo 0 | Vence el mismo día de la entrega; vencida desde el día siguiente. |
| Entrega a las 23:59 de Bogotá | El vencimiento parte del día de Bogotá de `deliveredAt`, no del día UTC. |
| Cuenta cerrada | Toda escritura falla con `AUTH_REQUIRED`. Nada se borra. |
| Redondeos | No hay: pesos enteros. |
| Importes mayores que 2^53 | BigInt de extremo a extremo y cadenas en JSON. |

## 12. Criterios de salida y plan por fases

### Criterios de salida

- Migraciones aditivas, ensayadas sobre la cadena completa en PostgreSQL local desechable, con consulta previa de solo lectura y sin tocar migraciones aplicadas.
- Matriz de dos cuentas: todas las rutas nuevas devuelven 404 o vacío con datos ajenos; las FKs compuestas rechazan mezclas.
- Libros: solo inserción, una anulación por entrada e invariantes de 5.6 al confirmar, también con SQL directo.
- Idempotencia con respuesta perdida y `requestId` nueva en cada operación.
- Concurrencia real con el bloqueo único: pago frente a cancelación, dos abonos, abono frente a devolución, conversión frente a cierre, sin interbloqueos.
- Cifras: los ejemplos de 5.3 y 5.4 como pruebas; «Te deben», vencidas, saldo a favor y por devolver cuadran con un cálculo independiente en SQL; ventas y utilidad de Inicio no cambian. EXPLAIN con 20 000 ventas por cuenta.
- Devoluciones parciales con los mismos movimientos de stock que hoy.
- Interfaz: Vender con pago mixto, anticipo, cambio de cliente, cliente en la entrega, «Devolver ahora»; detalle con anulación; Cartera con abono, «Abonar el total», cruce y deuda inicial; cierre con vista previa; teclado, contraste, 375 y 1440 px.
- lint, typecheck, test y build de los dos paquetes; runbook con el orden migración → API → frontend.

### Fases

| Fase | Contenido | Migración |
| --- | --- | --- |
| **F2a-1 Esquema** (hecho, [sección 16](#16-esquema-f2a-1-implementado)) | Enums, columnas de `"Sale"` con `LEGACY` por defecto, `UNIQUE ("id","userId")`, `sale_payment_entries`, `customer_credit_entries`, `sale_money_operations`, `receivable_settings`, CHECK, FKs compuestas, índices y triggers. Consulta previa, ensayo y [runbook](despliegue-f2a-1.md). | **Sí** |
| **F2a-2a Bloqueo único** (hecho, [15.A](#15-correcciones-del-planificador)) | `lockAccountForMoney` en ventas, conversión, gastos e inventario y `accountClosureMoneyLock` en el cierre; sustituye a `expenses-v1`; ensayo de concurrencia `test:account-lock-postgres`. Sin cambios visibles. | No |
| **F2a-2b API de pagos** | Pagos en `confirm`, `deliver` y la conversión (D); anticipos; vincular o cambiar el cliente en `CONFIRMED` y en la entrega (B); anulación; excedente en `cancel` y `returns` con «Devolver ahora» o por devolver; saldo a favor como medio y «Devolver dinero»; plazo y ajustes; bloque `payments` en las lecturas (toda operación nueva usa el bloqueo único de F2a-2a); vista previa y confirmación del cierre (C) con saldos a favor, por devolver y ventas sin entregar. **El fiado queda apagado** (`CREDIT_NOT_ENABLED`): sin abonos, una deuda no se podría cobrar. | No |
| **F2a-3 Interfaz de cobro** | «Cómo pagó» en Vender, anticipo, cambio de cliente, cobro y cliente al entregar, «Devolver ahora», pagos en el detalle, anular, «Devolver dinero», aviso de por devolver en Inicio y diálogo de cierre. | No |
| **F2a-4 Pruebas y despliegue** | Ensayos PostgreSQL y de navegador, runbook de F2a-2/3 y `estado.md`. | Requiere F2a-1 aplicada |
| **F2-1 Esquema de cartera** | `customer_receipts`; valor `RECEIPT_ALLOCATION` y `receiptId`; `customer_opening_debts`, con `saleId` nulo y `openingDebtId` en el libro (CHECK de un documento); `receivable_due_date_changes`; `customers."creditLimit"`; invariantes nuevas en los triggers diferidos. | **Sí** |
| **F2-2 API de cartera** | Abonos por vencimiento o al documento elegido, anulación, cruce manual del saldo a favor, deudas iniciales (crear, anular, cambiar vencimiento), cambio de vencimiento de ventas, listados, cupo y **activación del fiado**. | No |
| **F2-3 Cifras e integración** | Bloque `receivables` en `summary` y filas de atención; deuda en la vista previa del cierre. | No |
| **F2-4 Interfaz de Cartera** | Página Cartera (menú «Dinero»), ficha de cartera del cliente con «Abonar», «Abonar el total», «Cruzar saldo a favor» y «Deuda inicial»; tarjeta «Te deben»; aviso de cupo en Vender. | No |
| **F2-5 Despliegue** | Runbook y `estado.md`. | Requiere F2-1 aplicada |

**Nota para F2-1:** PostgreSQL no deja usar un valor de enum añadido con `ALTER TYPE … ADD VALUE` en la misma transacción que lo crea. `RECEIPT_ALLOCATION` debe añadirse en una migración propia, o los CHECK y triggers que lo nombren deben comparar con `kind::text`.

## 13. Choques con el código y cómo se resuelven

| # | Choque | Resolución |
| --- | --- | --- |
| 1 | El cliente solo se vincula en el borrador (`sale-customer.ts`) o en la conversión. | Corrección B: vincular o cambiar en `CONFIRMED` y al entregar (F2a-2). La base de datos ya lo admite y congela el cliente tras la entrega. |
| 2 | `"SaleOperation".saleId` es obligatorio y su `id` es global. | Tabla propia `sale_money_operations` (F2a-1). |
| 3 | El cierre de cuenta es de un paso y bloquea con pedidos sin resolver. | Corrección C: vista previa y confirmación (F2a-2). El bloqueo de pedidos no cambia. |
| 4 | No existe exportación. | Corrección C: sin botón de exportar hasta F5. |
| 5 | No hay tabla de ajustes del negocio. | `receivable_settings` (F2a-1). |
| 6 | La conversión admite `mode: DELIVERED` sin pagos. | Corrección D: acepta los mismos pagos que `confirm` (F2a-2). |
| 7 | Solo se cancela una venta `CONFIRMED`; nunca tiene deuda. | Documentado: en la cancelación todo lo recibido es excedente. |
| 8 | Medios de pago: el encargo agrupa «Nequi/Daviplata/transferencia». | Se separan como en Gastos, para que F5 los distinga. |
| 9 | Orden de bloqueo inverso entre cierre y conversión. | Corrección A: bloqueo único por cuenta (F2a-2). |
| 10 | Ventas e Inicio dicen que una devolución «no es un reembolso». | Sigue siendo cierto para las cifras de ventas; los textos de `sales-contract.md` y `dashboard-summary.md` se actualizarán en F2a-2. |
| 11 | Un valor por defecto `TRACKED` haría que la API actual creara ventas «con seguimiento» sin pagos entre la migración y F2a-2. | Valor por defecto `LEGACY`; F2a-2 marca `TRACKED` al confirmar (sección 10). |
| 12 | `test:sales-postgres` exigía que las migraciones de Ventas fueran las últimas y fallaba desde F1a. `test:scheduled-postgres` exigía que F1b fuera la última. | Corregidos en F2a-1: buscan sus migraciones por nombre y aplican las posteriores. |

## 14. Decisiones del dueño

Tomadas el 26/11/2026 sobre las preguntas de la propuesta. Sustituyen a las preguntas abiertas.

| # | Tema | Decisión |
| --- | --- | --- |
| F2-1 | Venta sin cliente con saldo al entregar | Se cobra todo o se vincula un cliente en ese momento para fiarle. |
| F2-1b | Sobrante de una venta sin cliente cancelada o devuelta | «Devolver ahora» o queda «por devolver» como aviso hasta que se devuelva. |
| F2-2 | Saldo a favor contra deudas existentes | Cruce manual con un botón en la ficha del cliente, registrado. Nunca automático. |
| F2-3 | Deudas anteriores a la app | «Deuda inicial» por cliente (monto, vencimiento y nota), cobrable con abonos como cualquier otra y aplicada en orden «más antigua primero» por su fecha de vencimiento. Documento de deuda con el mismo libro de movimientos: se anula con motivo, nunca se edita. Va en F2-1. |
| F2-4 | Cuánto reduce la deuda una devolución | El valor de venta de lo devuelto, revendible o dañado. |
| F2-5 | Vencimiento de una venta entregada | Se puede cambiar con motivo y registro. |

**Interpretación del planificador sobre F2-3:** para que el orden sea uno solo, «más antigua primero» usa la **fecha de vencimiento** en todos los documentos (ventas y deudas iniciales), no la fecha de entrega que proponía el borrador.

## 15. Correcciones del planificador

Incorporadas el 26/11/2026. Prevalecen sobre cualquier texto anterior.

**A. Bloqueo único por cuenta para toda operación con dinero o existencias** (pagos, abonos, cancelaciones, devoluciones, movimientos de inventario, conversión de pedidos y cierre de cuenta), con el orden de la [sección 8](#orden-de-bloqueo-único-corrección-a). Resuelve también el interbloqueo entre cierre de cuenta y conversión de pedidos. **Implementado en F2a-2a** (26/11/2026), sin cambios visibles ni de esquema.

**Inventario de bloqueos antes de F2a-2a** (código del 26/11/2026):

| Operación | Bloqueos, en orden |
| --- | --- |
| Confirmar, entregar, cancelar y devolver una venta | `users` `FOR SHARE` → `"Sale"` `FOR UPDATE` → artículos por `id` `FOR UPDATE` |
| Convertir un pedido en venta | `users` `FOR SHARE` → pedido `FOR UPDATE` → artículos por `id` (en `CONFIRMED`/`DELIVERED`) |
| Crear o editar un borrador | `users` `FOR SHARE` → asesoría `sale-create-v1` (crear) o `"Sale"` `FOR UPDATE` (editar) |
| Gastos: crear, anular, reclasificar, categorías, gastos fijos, pagos programados y `sync` | `users` `FOR SHARE` → asesoría `expenses-v1` → recibo → filas `FOR UPDATE` |
| Movimiento manual de inventario | `users` `FOR SHARE` → artículo `FOR UPDATE` |
| Aplicar un lote de inventario | `users` `FOR SHARE` → asesoría `inventory-identity-v1` → lote → artículos por `id` |
| Confirmar el cliente de un pedido (`customer-confirm`) | pedido `FOR UPDATE` → `users` `FOR SHARE` → asesorías → venta del pedido `FOR UPDATE` |
| Cotización, cambio de estado, anulación o borrado de un pedido | pedido `FOR UPDATE` → (catálogo) → `users` `FOR SHARE` dentro del trigger `guard_closed_catalog_write` |
| Pedido público del catálogo | catálogo `FOR UPDATE`/`FOR SHARE` → productos → artículos `FOR UPDATE` → `users` `FOR SHARE` (trigger) |
| Cierre de cuenta | pedidos `FOR UPDATE` → catálogos `FOR UPDATE` → `users` `FOR UPDATE` |

**Pares que podían trabarse:**
- **Cierre de cuenta contra conversión de pedido** (el único entre operaciones de dinero o existencias): la conversión tenía `users` y esperaba el pedido; el cierre tenía el pedido y esperaba `users` `FOR UPDATE`. El ensayo lo reproduce: con el orden anterior, PostgreSQL aborta una con `40P01` en la primera vuelta forzada.
- Ventas, gastos e inventario entre sí no se trababan: no comparten tipos de fila salvo los artículos, que siempre se bloquean en orden de `id`.

**Después de F2a-2a:** los mismos pasos de la [sección 8](#orden-de-bloqueo-único-corrección-a). Las operaciones de la tabla anterior que mueven dinero o existencias (ventas salvo borradores, conversión, gastos, movimientos y lotes de inventario) empiezan por `lockAccountForMoney`. El cierre empieza por `accountClosureMoneyLock` y después sigue igual. Las demás no cambian.

**Más lento:** dentro de **una misma cuenta**, las operaciones de dinero y existencias ya no corren en paralelo entre sí. Una venta y un gasto, dos ventas de artículos distintos, o una venta y un movimiento de inventario esperan su turno. Antes solo se serializaban los gastos entre sí y las ventas que compartían artículo. Cada operación dura milisegundos, así que la espera es del mismo orden. Las cuentas distintas no se esperan entre sí, y las lecturas y los borradores no esperan.

**Pendiente, fuera de este alcance** (no mueve dinero ni existencias): la publicación de inventario en catálogos toma `users` `FOR SHARE` y después escribe productos, cuyo trigger pide el catálogo `FOR SHARE`. Contra el cierre (catálogos `FOR UPDATE` → `users` `FOR UPDATE`) podría trabarse. Se resuelve igual, tomando `accountClosureMoneyLock` al empezar, si se decide incluirla.

**Pruebas:** `npm.cmd run test:account-lock-postgres`, ocho vueltas de cada par, sin `40P01`:
- control con el orden anterior (se traba);
- cierre contra conversión, forzando las dos órdenes de llegada con una tercera transacción que retiene el pedido, y también en paralelo simple;
- cierre contra confirmar una venta, crear un gasto y mover inventario;
- confirmar contra cancelar la misma venta;
- anular el gasto de un pago programado contra volver a pagarlo;
- dos ventas de la última unidad con una reposición a la vez.

**B. Vincular o cambiar el cliente de una venta `CONFIRMED` antes de entregar**, copiando los datos del cliente al vincular. Tras entregar, el cliente no se cambia. La base de datos (F2a-1) congela el cliente de una venta `TRACKED` entregada, tenga o no deuda: es más estricto que «tras entregar con deuda», y una venta entregada y pagada tampoco necesita cambiar de cliente.

**C. Cierre de cuenta:** vista previa con lo que le deben, saldos a favor, dinero «por devolver» y ventas sin entregar; confirmar cierra. Sin botón de exportar hasta F5.

**D. La conversión de pedido a venta acepta los mismos pagos que confirmar.**

**E. Efectivo recibido:** dato informativo por pago; el cambio solo se muestra.

**Cambios en el plan de fases:** el bloqueo único y la vista previa del cierre pasan a F2a-2. La deuda inicial, el registro de cambios de vencimiento, los abonos y el cupo van en F2-1. El cruce manual del saldo a favor va en F2-2 y no necesita esquema nuevo (usa `CREDIT_USE`).

## 16. Esquema F2a-1 implementado

Migración `20261126100000_sale_payments_ledger` (en `catalog-api/prisma/migrations`), una transacción, **solo añade**. No está aplicada en producción. Despliegue: [runbook de F2a-1](despliegue-f2a-1.md). Consulta previa: [`verify-sale-payments-preflight.sql`](sql/verify-sale-payments-preflight.sql). Ensayo: `npm.cmd run test:sale-payments-postgres`.

| Objeto | Detalle |
| --- | --- |
| Enums | `SalePaymentMode` (`TRACKED`, `LEGACY`), `SalePaymentMethod` (6 medios), `SalePaymentEntryKind` (`PAYMENT`, `CREDIT_USE`, `EXCESS_TO_CREDIT`, `SALE_REFUND`, `REVERSAL`), `CustomerCreditEntryKind` (`FROM_SALE`, `USED`, `REFUND`, `REVERSAL`). |
| `"Sale"` | `paymentMode` `NOT NULL DEFAULT 'LEGACY'`, `paymentTermDays`, `paymentDueDate`; índice único `Sale_id_userId_key`; CHECK `Sale_payment_columns_check`; trigger `sale_payment_columns_guard`. |
| Tablas | `sale_payment_entries`, `customer_credit_entries`, `sale_money_operations`, `receivable_settings`. Todas las FKs `ON DELETE RESTRICT`; las compuestas, también `ON UPDATE RESTRICT`. |
| CHECK | `sale_payment_entries_valid_check` y `_kind_check`, `customer_credit_entries_valid_check` y `_kind_check`, `sale_money_operations_valid_check`, `receivable_settings_valid_check`. |
| Índices únicos | `(id, ownerId)` y `(id, saleId)` / `(id, customerId)` para FKs compuestas; `reversesEntryId` en los dos libros; `(ownerId, operationId, saleId, position)` y `(ownerId, operationId, position)` (idempotencia); parcial `sale_payment_entries_creditEntryId_key` (`WHERE creditEntryId IS NOT NULL`); `(ownerId, requestId)` en los recibos. |
| Triggers inmediatos | Solo inserción (`money_append_only_guard`: `UPDATE`, `DELETE` y `TRUNCATE`) en los dos libros y los recibos; `receivable_settings_guard` (sin borrado, dueño fijo); `sale_payment_entry_insert_guard` (solo ventas `TRACKED` no borrador, anulación válida, emparejamiento con el saldo a favor, `SALE_REFUND` solo sin cliente); `customer_credit_entry_insert_guard` (anulación válida). |
| Triggers diferidos | `sale_payment_entries_balance`, `sale_payment_status_balance` (en `"Sale"`, solo `TRACKED`) y `sale_return_line_payment_balance` comprueban las invariantes 1 y 4 de 5.6 al confirmar; `customer_credit_entries_balance`, las 2 y 3. |

**Diferencias con el borrador:**
- El valor por defecto es `LEGACY` y no hay `UPDATE` de borradores (choque 11).
- Nueva columna `position` para la idempotencia en base de datos.
- `customer_receipts` sin columnas de anulación: solo inserción.
- Las comprobaciones diferidas confían en el bloqueo único de la cuenta (corrección A) para la concurrencia, como en F1b: dos transacciones simultáneas sin ese bloqueo podrían pasar cada una su comprobación.
