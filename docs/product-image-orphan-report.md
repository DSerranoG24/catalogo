# Informe de imágenes de producto huérfanas

Herramienta de una sola finalidad: generar un JSON para revisión y eventual
borrado manual por el responsable. No borra, no encola, no inicia workers y no
tiene opción de borrado. No crea manifiestos ni autorizaciones de ejecución.

## Ejecución manual

Desde catalog-api, con el cliente Prisma generado:

```powershell
npx.cmd tsx src/scripts/report-product-image-orphans.ts .\product-image-orphans.json
```

La salida debe ser un archivo JSON que todavía no exista, en una carpeta existente.
Se rechaza sobrescribir archivos. Las variables son DATABASE_URL, SUPABASE_URL
y SUPABASE_SECRET_KEY. dotenv/config lee el .env local existente; el script no
lo modifica ni muestra credenciales. No pasar credenciales como argumentos.
Preferir permisos de base de datos y Storage limitados a lectura. El operador
elige el destino; Codex no ejecuta este script contra servicios remotos.

El transporte del SDK admite únicamente POST al endpoint de listado del bucket
product-images del origen configurado, sin seguir redirecciones. PostgreSQL se
lee en transacciones READ ONLY y RepeatableRead. No necesita migraciones.

## Lectura del informe

Recorre carpetas y páginas de cien entradas. Lee todas las referencias antes
y después del recorrido, en páginas de quinientas filas. Protege la unión de
ambas lecturas, incluidos productos inactivos/provisionales y archivos de las
colas existentes. También excluye los catálogos alcanzados por cierres de cuenta.

Solo considera rutas catalogUUID/productUUID/fileUUID con jpg, jpeg, png o webp.
Los otros formatos se listan fuera de alcance. Un catálogo debe existir en ambas
lecturas; si falta o cambia, se excluye para revisión.

Un candidato no tiene referencias, anomalías en su ámbito ni errores de lectura,
y sus fechas de creación y actualización son válidas y anteriores al corte de
inicio menos 24 horas. ageHours usa la más reciente de ambas fechas; exactamente
24 horas todavía se excluye. Tamaños desconocidos son null y no se inventan bytes.

Las referencias anómalas bloquean su catálogo, o todo el informe si no se puede
establecer el catálogo. Nunca se incluye su valor original, que podría contener
una URL firmada. Errores de listado o lectura bloquean todos los candidatos y
marcan complete:false. Los errores del proveedor se sustituyen por códigos fijos.

El JSON contiene cutoff, counts, knownBytes, candidates, exclusions, outOfScope,
anomalies y errors. La consola imprime únicamente cantidades. Código de salida:
0 informe completo sin anomalías; 2 informe escrito con errores o anomalías;
1 error de configuración/ejecución/escritura. Revisar el JSON aunque termine en 0.

La paginación de Storage no es una instantánea atómica. El informe describe lo
observado, no garantiza que referencias u objetos sigan iguales al borrarlos
manualmente. No es autorización automática de borrado.
