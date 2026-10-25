# Parche de seguridad Zod 4.6.5 → 4.6.6

Verificado localmente el 24 de octubre de 2026. Sin migraciones, cambios de controladores, pruebas modificadas ni acceso a producción.

## Dependencias y alcance

- API: dependencia de producción fijada a `"zod": "4.6.6"` en package.json y en la referencia raíz del lockfile.
- Frontend: solo la resolución transitiva `node_modules/zod` pasa a 4.6.6; sigue marcada `dev: true`, a través de eslint-plugin-react-hooks. No se añade Zod como dependencia directa ni se modifica el plugin.
- En ambos nodos del lockfile cambian únicamente versión, URL del tarball e integridad oficial de npm. Zod no añade dependencias.
- Se compararon íntegramente los dos lockfiles con instantáneas previas y las versiones instaladas del lockfile interno de node_modules. La única versión modificada en cada proyecto es Zod.
- Sin cambios en Next 16.3.8, sharp 0.35.5, React/react-dom 19.2.8 y eslint-plugin-react-hooks 7.1.1 del frontend.

Los nodos se ajustaron con los metadatos oficiales de `zod@4.6.6` y se instalaron con `npm.cmd install --ignore-scripts --no-audit --no-fund`. No se ejecutó npm update ni audit fix general.

## Corrección comprobada

La versión anterior recorría los elementos antes de aplicar el límite superior de colección. La corrección rechaza un array mayor que `.max()` sin analizar sus elementos. No reemplaza los límites de cuerpo HTTP ni la necesidad de definir tamaños máximos en los esquemas.

Pruebas sintéticas, pequeñas, sin servidor ni base de datos:

| Comprobación | 4.6.5 | 4.6.6 |
|---|---:|---:|
| 51 elementos, max(50): visitas al validador instrumentado | 51 | 0 |
| 51 objetos inválidos representados por null, max(50): errores | 52 | 1 |
| Errores invalid_type por los elementos | 51 | 0 |
| Errores too_big de la colección | 1 | 1 |

En 4.6.5 el primer error del segundo caso tenía `path: [0]`; en 4.6.6 el único error es `too_big`, con `path: []`. Esa diferencia es intencional en Zod y no se ocultó adaptando pruebas.

Código de reproducción, ejecutado antes y después de sustituir el paquete, desde la raíz del repositorio:

```js
const { z } = require('./catalog-api/node_modules/zod');
let visited = 0;
z.array(z.unknown().transform(value => {
  visited++;
  return value;
})).max(50).safeParse(Array(51).fill(null));

const invalid = z.array(z.object({ rowNumber: z.number() }))
  .max(50).safeParse(Array(51).fill(null));
console.log({ visited, issues: invalid.error.issues.length });
```

La primera comprobación mide visitas con una transformación; la segunda cuenta errores de elementos inválidos. No se intentó provocar agotamiento de memoria.

Referencia del aviso: https://github.com/advisories/GHSA-mrhx-c7xc-m3w5

Corrección upstream: https://github.com/colinhacks/zod/commit/a0ebf97

## Contrato de errores de la aplicación

Se compararon respuestas completas antes/después invocando los controladores reales compilados con entradas sintéticas inválidas. Los servicios y repositorios se sustituyeron por dobles que no acceden a datos; el fallo de validación ocurre antes de usarlos. Se omitieron las salidas de console.error durante esta comprobación, sin cambiar el código de producción.

Los seis casos mantienen exactamente status y cuerpo JSON:

- Actualizar catálogo: HTTP 400, `success: false`, mensaje fijo y `issues: [{ field, message }]`. Conserva número, orden y campos de los cuatro errores de la entrada sintética probada (name, phone, phone, email).
- Crear producto inválido: HTTP 400 y mensaje fijo.
- Actualizar producto inválido: HTTP 400 y mensaje fijo.
- Registro inválido: HTTP 400 y mensaje fijo.
- Login inválido: HTTP 400 y mensaje fijo.
- Pedido público con 51 elementos inválidos: HTTP 400 y `Revisa los datos de la orden`; no expone la lista interna de errores Zod.

El endpoint de importación devuelve `INVALID_IMPORT_BATCH` para un envelope inválido, sin exponer los issues internos del array. Su prueba HTTP de más de 50 filas continúa pasando.

No se cambió ni normalizó ningún controlador. La comprobación cubre esos casos y la suite existente; no es una comparación exhaustiva de toda entrada inválida posible.

## Verificación

- API: `npm.cmd run build` correcto; `npm.cmd test`: 78 pasan, 0 fallan, ninguna prueba adaptada.
- Frontend: `npm.cmd run lint`: 0 errores y los 8 avisos existentes de img; `npm.cmd test`: 16 grupos pasan; `npm.cmd run build` correcto.
- Sin scripts independientes de typecheck en los dos proyectos; los builds incluyen TypeScript. La API no tiene script de lint.
- Antes de commitear se requiere `git diff --check` limpio.

## Next evaluado, sin actualizar en este bloque

Los avisos de Next permanecen fuera del alcance autorizado: optimización SVG (mitigación sharp >=0.35.5, ya presente en el lockfile), funciones use cache con múltiples typed arrays (no encontradas) y Server Actions (no encontradas). Los usos de Image revisados son unoptimized y no se habilita dangerouslyAllowSVG. El cache() de React del lector público no es la directiva use cache de Cache Components. No se verificó el artefacto desplegado ni se debe interpretar esto como una auditoría completa de Next.

Los tres avisos se corrigen desde Next 16.4.1; una eventual actualización se realizará en un bloque separado, con autorización y sus propias comprobaciones. La fase 3B tampoco se implementa aquí.

## Despliegue y reversión

No hacen falta variables ni migraciones. El despliegue debe instalar desde los lockfiles revisados, sin una resolución general de versiones. Este bloque necesita autorización explícita para commit/push/despliegue; no se realizó ninguna de esas acciones.

No hay cambios de datos que revertir. Volver a los manifiestos y lockfiles anteriores reintroduciría el fallo de Zod; ante una regresión se debe evaluar una corrección dirigida antes de volver a la versión vulnerable.
