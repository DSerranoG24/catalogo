# Despliegue de API y frontend

Procedimiento vigente al 25 de octubre de 2026. Ejecutarlo requiere autorización explícita. No deducir valores remotos del repositorio: confirmar proyecto, rama, versión y configuración efectiva en cada panel.

## Preparar y publicar

1. Revisar el diff y ejecutar las [comprobaciones aplicables](testing.md). Usar Node.js `24.x` y los lockfiles de cada paquete (`npm ci`). Nunca publicar un build preparado con API simulada.
2. Si cambia el esquema, probar las migraciones y compatibilidad con la versión que sigue atendiendo. Un responsable confirma destino y respaldo restaurable, aplica y verifica según [migrations.md](migrations.md#orden-del-despliegue). Si no cambia el esquema, no hay paso de migración.
3. Solo tras esa verificación, realizar el push autorizado de la misma versión revisada. Un push puede disparar despliegues automáticos: coordinar sus ajustes antes para conservar el orden **migración → push → API → frontend**.
4. Desplegar y verificar primero la API; después el frontend compatible. No desplegar automáticamente el frontend dependiente antes de que la API esté disponible.
5. Confirmar versión publicada y recorrer los flujos afectados con datos de prueba autorizados. Las comprobaciones de producción son operativas y separadas de las pruebas locales; no usar producción como entorno de ensayo.

## Render

En el servicio de API, Settings → Build & Deploy:

| Campo | Valor exacto |
|---|---|
| Root Directory | `catalog-api` |
| Build Command | `npm ci && npx prisma generate && npm run build` |
| Start Command | `npm start` |
| Pre-Deploy Command | Vacío |

`npm run build` ejecuta `tsc`. `npm start` ejecuta `node dist/server.js`: usarlo como Build Command intenta arrancar sin generar Prisma Client ni compilar. Puede faltar `dist/server.js` o quedar un servidor que no termina como compilación. Las migraciones no pertenecen a ninguno de estos comandos.

[render.yaml](../render.yaml) solo configura un servicio gestionado por Blueprint y sincronizado. Si el servicio no está gestionado por Blueprint, esos valores se cambian manualmente en el panel; editar el YAML no corrige la configuración efectiva. Si hay Blueprint, revisar su relación, rama y sincronización antes de modificar el panel: un sync puede sobrescribir cambios manuales.

Variables de API: consultar únicamente la [plantilla de producción](../catalog-api/.env.production.example). Incluye conexión PostgreSQL, secreto JWT, Storage, OAuth, CORS y `PUBLIC_API_URL` con `/api` para enlaces PDF. `PORT` lo asigna Render. Configurar valores reales mediante el gestor del servicio; no copiarlos a documentación ni logs. La falta de `PUBLIC_API_URL` impide cotizar, pero no debe impedir registrar el pedido.

## Vercel y variables

Configurar Root Directory `catalog-generator`, Node.js `24.x`, instalación `npm ci` y build `npm run build`. Ver [plantilla del frontend](../catalog-generator/.env.production.example) y [README del módulo](../catalog-generator/README.md#variables-para-vercel).

| Variable | Uso y momento |
|---|---|
| `NEXT_PUBLIC_CATALOG_API_URL` | Pública, incorporada al build del navegador; también la consume la lectura pública de servidor. Cambiarla requiere un build nuevo. |
| `NEXT_PUBLIC_GOOGLE_CLIENT_ID` | ID público de OAuth, incorporado al build. Debe coincidir con el Client ID configurado en la API. |
| `CATALOG_API_URL` | Solo servidor, usada por el proxy same-origin. No se expone mediante `NEXT_PUBLIC_*` ni se incorpora al bundle cliente; confirmar el valor del entorno del despliegue y redeplegar al cambiarlo. |

Las URLs de API deben ser HTTPS en producción e incluir `/api`. Configurar en la API `CORS_ORIGINS` con el origen HTTPS exacto del frontend. Secretos JWT, credenciales PostgreSQL y claves Storage nunca se ponen en variables `NEXT_PUBLIC_*`.

## Comprobar resultado y recuperar

- En Render, Events debe indicar éxito para el commit esperado. Un estado **Failed**, especialmente con duración anormalmente corta como la incidencia de 13 segundos, obliga a revisar el comando ejecutado y el primer error de los logs. La duración sola no demuestra la causa.
- En Vercel, comprobar commit, rama, estado Ready y que el dominio/alias de producción apunte a ese deployment. Un preview correcto no acredita la publicación en producción.
- Comparar el SHA del código autorizado con el de ambos deployments. El repositorio no publica un endpoint de versión; una respuesta de la web o de health no identifica por sí sola el commit atendido.
- `/api/health` comprueba conexión con PostgreSQL mediante `SELECT 1`; no acredita esquema actualizado, autenticación, importación o PDF. Verificar esos flujos por separado según el cambio.
- Ante fallo de compilación, la versión anterior puede seguir respondiendo. No interpretar esa respuesta como éxito del nuevo despliegue. Corregir la causa y coordinar otro despliegue autorizado.
- Una reversión de aplicación exige compatibilidad con el esquema y los datos ya persistidos. No borrar migraciones, pedidos, números o instantáneas para volver a una versión anterior. La recuperación de esquema se trata en [migraciones y rollback](migrations.md#aplicación-controlada-y-rollback).
