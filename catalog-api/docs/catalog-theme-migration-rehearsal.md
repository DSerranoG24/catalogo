# Ensayo local de themePreset

La funcionalidad de 2A/2B está en el commit `454a38f`. El push se pospone según
el orden acordado: migración → push → API → frontend. Estos auxiliares de ensayo
se prepararon después de ese commit y no modifican el SQL ni la aplicación.

Desde la raíz, en PowerShell:

```powershell
powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\catalog-api\scripts\verify-catalog-theme-postgres.ps1
```

La política RemoteSigned se limita a ese proceso. El script compila API y un
build frontend con API HTTPS loopback; este artefacto local no se debe publicar.
Luego solicita la URI mediante `Read-Host -AsSecureString`. La URI pasa por stdin
al verificador y nunca por argumentos, archivos, historial ni JSON. La memoria
de la entrada se libera al terminar. Los archivos de entorno no se editan.

Se admite exclusivamente PostgreSQL con base `catalogo_test`, host literal
localhost/127.0.0.1/::1, resolución y dirección del servidor loopback. Se rechazan
fragmentos y parámetros de redirección como host/options. Cualquier schema de
entrada se sustituye por un nombre aleatorio propio. No usar túneles remotos.

## Qué comprueba

1. Crea un esquema temporal propio, reproduce las 17 migraciones previas y
   verifica su ledger completo. No toca public ni presupone que la base esté vacía.
2. Inserta siete catálogos antes de añadir la columna, y aplica la migración 18
   desde una copia temporal del historial. No modifica migraciones versionadas.
3. Verifica por information_schema que themePreset es TEXT nullable sin DEFAULT;
   los siete catálogos anteriores quedan en NULL.
4. Arranca en loopback los controladores de aplicación con PostgreSQL real y
   autenticación JWT real de un usuario ficticio. Comprueba preset válido,
   null, omisión, ID desconocido y combinaciones TECH inválidas completas,
   parciales y de creación. Las tres incompatibilidades deben devolver 400.
5. La API pública lee de ese mismo esquema. Sus catálogos NULL, con productos
   sin imagen y una oferta, alimentan Next/Chromium mediante un puente HTTPS
   local. No se sustituyen por DTOs simulados en esta ejecución.
6. Compara 112 vistas con la referencia histórica: siete identificadores,
   cuatro anchos y catálogo/detalle/carrito vacío/carrito lleno. Incluye los
   84 estados de reseña y las excepciones de color autorizadas en 2B.
7. Desconecta y elimina únicamente su esquema generado y su carpeta temporal
   de migraciones. El nombre se valida antes de DROP/limpieza recursiva.

Los IDs de productos se toman de la API real para preparar el carrito. La
navegación espera el loaderId del documento nuevo y readyState complete; la
siembra de sessionStorage ocurre antes de hidratar ese documento. No se relajan
las comparaciones de color, fondo, dimensiones o tipografía.

## Resultados y seguridad

El parámetro opcional `-ReportPath` cambia dónde se escribe
`catalog-theme-postgres-results.json`. El valor por defecto está en TEMP.
Contiene success, etapa fallida, comprobaciones, conteos, códigos HTTP,
metadatos de columna, cleanup y referencia a artefactos visuales. No contiene
URI, contraseña, JWT, datos reales de clientes ni salida cruda de Prisma.

La salida de Prisma se captura y solo se extraen códigos de error. Los logs de
aplicación se suprimen dentro de este proceso de prueba. El proceso frontend no
recibe DATABASE_URL, JWT_SECRET ni SUPABASE_SECRET_KEY del verificador; usa
NODE_ENV=production para ejecutar su build. Los errores visuales estructurados
se sanean antes de incluirlos en el reporte.

La referencia `TEMP/catalog-theme-baseline.json` procede del estado histórico
anterior a 2A. Si falta, el runner se detiene antes de solicitar la URI. No
registrar otra referencia sobre el código nuevo para ocultar diferencias.

Prueba de las barreras sin conectar con ninguna base:

```powershell
Set-Location catalog-api
npm.cmd run build
npm.cmd test
```

La suite incluye destinos remotos, base equivocada, fragmentos y parámetros
peligrosos, y exige que el canario de contraseña no aparezca en la salida.

## Puerta a Supabase

No ejecutar el siguiente bloque hasta haber reportado un ensayo con
`success: true` y `cleanup: true`, y confirmado un respaldo recuperable del
proyecto destino `kvzqikivygiysbqjnssf`. El usuario indicó que ese respaldo está
pendiente de verificar. No se ha hecho push ni se ha consultado/modificado ese
proyecto durante la preparación del ensayo.

Con el destino y conexión de proceso comprobados, sin imprimir credenciales,
el orden solicitado es:

```powershell
npx.cmd --no-install prisma migrate status
npx.cmd --no-install prisma migrate deploy
npx.cmd --no-install prisma migrate status
```

Antes de deploy hay que revisar el ledger y exigir que la única pendiente sea
`20261026120000_catalog_theme_preset`. Un primer status con migración pendiente
puede salir con código 1; un fallo de conexión, historial divergente u otras
pendientes obliga a detenerse. No usar migrate dev/reset/db push ni resolve.
La salida se debe capturar y sanear, sin imprimir la URI.

Verificación SQL posterior, sobre el esquema real acordado (public):

```sql
SELECT data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'catalogs'
  AND column_name = 'themePreset';
```

Debe devolver text, YES y NULL. Solo tras status final sin pendientes y esa
verificación se permite el push autorizado y la coordinación API → frontend.
Un push puede disparar ambos despliegues automáticamente: comprobar su
coordinación según docs/despliegue.md. No hay rollback SQL automático que borre
la columna o las selecciones.

## Resultado local del 26 de octubre de 2026

Ensayo completo aprobado contra catalogo_test en loopback, dentro del esquema
propio generado y eliminado al terminar. Resultado original sin credenciales:

`TEMP/catalog-theme-rehearsal-b9f6120957a144dba865a45f427f02bf/catalog-theme-postgres-results.json`.

Resumen de ese reporte:

```json
{
  "success": true,
  "previousMigrationCount": 17,
  "finalMigrationCount": 18,
  "columnType": "text",
  "columnNullable": true,
  "preexistingCatalogsRemainNull": 7,
  "saveValidPreset": true,
  "nullClears": true,
  "omissionPreserves": true,
  "unknownPresetRejected": true,
  "incompatiblePartialStatus": 400,
  "incompatibleFullStatus": 400,
  "incompatibleCreateStatus": 400,
  "visualComparisons": 112,
  "reviewStates": 84,
  "cleanup": true,
  "diagnostics": []
}
```

Las capturas y el detalle visual están en TEMP/vitrinaya-ui-pilot-7zD89O.
Se corrigieron en el arnés una expectativa incorrecta del alias FASHION/EDITORIAL
y carreras al preparar el carrito/navegar. La aplicación y la migración del
commit aprobado no se modificaron. La suite API terminó con 145/145 y su build
pasó; lint de los verificadores frontend pasó. El runner también construyó el
frontend local antes del ensayo.

Push y acciones de Supabase/Render/Vercel siguen sin ejecutarse: el respaldo
recuperable del proyecto destino continúa pendiente de verificar. Los nuevos
auxiliares y su documentación permanecen sin commit; no se hizo un segundo
commit ni amend del commit funcional autorizado.
