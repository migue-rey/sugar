# Privilegios de contenedores — #12, etapa 1

La imagen de API ejecuta Node como UID/GID 1000, con código y dependencias propiedad de root. Compose local y producción añaden raíz de solo lectura, eliminación de todas las capacidades Linux, `no-new-privileges`, proceso init y máximo de 128 procesos/hilos. `/tmp` es el único espacio temporal, tmpfs de 16 MiB con `noexec,nosuid,nodev`; no almacena datos persistentes. La API guarda imágenes, documentos, sesiones e historial en PostgreSQL, no en el contenedor. `NODE_ENV=production` se establece en la imagen.

## Comprobaciones aisladas

```sh
python3 -m unittest discover -s deploy/containers -p 'test_*.py'
docker build -t sugar-privilege-api api
docker build -f deploy/containers/Dockerfile.test -t sugar-privilege-api-check .
docker build -t sugar-privilege-web web
docker build -t sugar-privilege-database deploy/database
python3 deploy/containers/smoke.py
```

El validador comprueba ambas configuraciones renderizadas sin cargar `.env` ni imprimir sus valores. El ensayo usa un proyecto Compose único, un volumen PostgreSQL desechable y redes internas sin puertos publicados ni Internet. Conserva las restricciones reales de la API; solo sustituye imágenes por las construidas localmente y añade el mock de DeepSeek a una imagen exclusiva de prueba. La imagen publicada no incluye mocks ni interruptores de proveedor falso.

Comprueba UID/GID de Node/init, capacidades efectivas nulas, prohibición de nuevos privilegios, raíz no escribible, tamaño de tmpfs y lectura de secretos privados de su usuario. Verifica frontend/health, sesión, proyecto/revisiones, carga/lectura de imagen, análisis con DeepSeek simulado y cola GitHub mediante autenticación/HTTP inyectados. Reinicia API/DB y comprueba que sesión, imagen, revisión, análisis/configuración y sincronización persisten. No emplea credenciales reales ni envía consultas facturables/publicaciones. Limpia únicamente el proyecto/volumen que creó.

## Compatibilidad y liberación

- Este cambio no altera esquema, roles, propietarios PostgreSQL, volúmenes ni contenido. La API usa ahora `sugar_runtime` y verifica el esquema sin migrarlo. El perfil maintenance usa la identidad separada para migraciones; ver [transición y reversión](../database/README.md).
- La API necesita puerto 3000, sin capacidades para puertos privilegiados. No requiere directorios persistentes propios. No montar el socket Docker ni agregar capacidades para resolver errores.
- Si se utilizan secretos `_FILE`, el UID 1000 debe poder abrirlos. Preparar archivos dedicados con propietario/UID correcto y modo 0400/0600, montados en solo lectura; no hacerlos públicos con 0644 ni cambiar indiscriminadamente propietarios del directorio del despliegue. Las instalaciones actuales por variables de entorno no requieren conversión. El ensayo valida un secreto privado creado por el mismo UID; los montajes reales requieren comprobación durante una liberación autorizada.
- No se restringen todavía los contenedores web/PostgreSQL: sus entrypoints y rutas escribibles requieren evaluación independiente. No aplicar `read_only` o `cap_drop: ALL` a PostgreSQL a ciegas; necesita inicializar/escribir su volumen.
- `docker run` usa el usuario de la imagen, pero las otras restricciones dependen de Compose/opciones equivalentes. Un operador Docker/root conserva control del host; esta configuración no es una frontera contra él.

Antes de liberar: conservar copia verificada de Compose/release y backup recuperable según [seguridad](../security/README.md) y [backups](../backup/README.md), revisar montajes `_FILE`, recrear solo API con la imagen probada y verificar salud/flujos. No ejecutar `down -v`, cambiar roles ni borrar datos. El rollback de imágenes no revierte Compose automáticamente: restaurar explícitamente el archivo previo y la imagen anterior, recreando solo API y comprobando salud. La memoria temporal se pierde al recrear; los datos permanecen en PostgreSQL. Nada de esto se ha aplicado a instalaciones existentes.

## Etapa 2 — separación de PostgreSQL

Implementada con rol de ejecución sin DDL/superusuario, comando separado, permisos/default privileges acotados y comprobación de datos heredados/reversión de arranque. Ver [procedimiento](../database/README.md). Evaluar después los demás servicios y ajustar límites con carga medida antes de escalar.

Fuentes: [Node Docker: usuario no root](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md#non-root-user), [opciones de servicios Compose](https://docs.docker.com/reference/compose-file/services/).
