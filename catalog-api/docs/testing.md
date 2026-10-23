# Pruebas de la API

Ejecuta la suite con `npm test`. El script usa el runner existente de `tsx` y ejecuta las rutas de prueba TypeScript declaradas por el proyecto.

En Windows, `tsx` consulta `os.userInfo()` para elegir el sufijo de su directorio temporal cuando `process.geteuid` no está disponible. `scripts/test.cjs` comprueba esa llamada antes de iniciar el runner. Si falla específicamente con `ERR_SYSTEM_ERROR` y `uv_os_get_passwd`, activa un `process.geteuid()` local al proceso de pruebas para que `tsx` pueda elegir ese sufijo. El ajuste se hereda en los procesos de prueba, no afecta la aplicación ni altera resultados.

La compatibilidad se limita a ese error concreto. Otros errores de `os.userInfo`, de inicio del runner o de las pruebas se propagan y hacen fallar el comando. No requiere dependencias adicionales.
