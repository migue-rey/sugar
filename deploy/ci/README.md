# CI de seguridad y liberación — #14

## Implementado en desarrollo

El workflow se ejecuta al subir `dev/**`, en PR hacia main y por despacho manual. Las ramas de desarrollo solo validan. Publicación exige `test` y `Secret scan` correctos, además del guard explícito de main; despliegue depende de publicación y utiliza el entorno production. Los tokens de validación son de lectura y no reciben secretos de despliegue. Checkout no conserva credenciales Git. Las acciones permanecen fijadas por SHA.

`scan-secrets.py` usa Gitleaks v8.30.1 fijado por digest. Clona mediante Git local sin hardlinks ni checkout y escanea su historial alcanzable (HEAD y refs clonadas). Nunca monta el árbol de trabajo original, `.env` sin seguimiento ni otros archivos personales. En CI checkout trae historia completa; ejecutar localmente en un clon superficial limita la historia disponible. No es un análisis de todos los repositorios/submódulos del usuario.

El detector corre sin red, como UID/GID del ejecutor, sin capacidades ni raíz escribible. Solo el directorio temporal de informes es escribible. Los resultados se redactan al 100%, se capturan y se eliminan al finalizar; **solo se publica el número de hallazgos**, nunca coincidencias, rutas, autores, tokens o reportes SARIF. Un error, timeout o informe inconsistente bloquea. No se permiten supresiones por comentarios gitleaks:allow ni por .gitleaksignore.

La única excepción añadida corresponde al valor sintético `0123456789abcdef` repetido de las pruebas de cifrado, limitado mediante condición AND a dos rutas exactas de CI/recuperación y a la regla generic-api-key. No se ignoran carpetas de tests ni commits completos. Las reglas por defecto conservan sus propias heurísticas/excepciones: un resultado sin hallazgos no garantiza ausencia de secretos. Si aparece un secreto real, detener la liberación, tratarlo privadamente y revocarlo/rotarlo con autorización; no copiarlo al issue ni borrar historia automáticamente.

Pruebas:

```sh
docker pull ghcr.io/gitleaks/gitleaks@sha256:c00b6bd0aeb3071cbcb79009cb16a60dd9e0a7c60e2be9ab65d25e6bc8abbb7f
python3 -m unittest discover -s deploy/ci -p 'test_*.py'
python3 deploy/ci/scan-secrets.py
# Tras npm ci en api:
node --test deploy/ci/policy.test.mjs
```

Los fixtures son repositorios desechables con un token **inventado, nunca emitido**. Comprueban que un `.env` no versionado no se suministra al detector, que un secreto sintético eliminado sigue detectándose en la historia, que un comentario de supresión no lo oculta y que fallos no muestran diagnósticos ni valores. La prueba de workflow rechaza guards abiertos, eliminación del gate, checkout superficial, eventos inesperados, permisos ampliados, credenciales persistidas y acciones sin SHA. Son comprobaciones de regresión; no impiden que alguien con escritura modifique también los propios tests.

## Configuración del propietario: no aplicada

Lectura del estado el 3 de noviembre: no se obtuvo una protección clásica de main y el entorno production no tenía reglas de protección ni restricción de ramas. Esto no es una auditoría completa de reglas de la cuenta/rulesets. **No se modificó ninguno de esos controles, secretos ni accesos.**

Antes de liberar esta entrega, revisar y aprobar:

1. Proteger main exigiendo PR, ramas actualizadas y los checks únicos `test` y `Secret scan`; impedir force-push/borrado y aplicar también a administradores. La plantilla `main-protection.example.json` es una propuesta, nunca se aplica desde CI.
2. Si trabaja una sola persona, no exigir aprobaciones de un revisor inexistente: la plantilla requiere PR pero cero aprobaciones ajenas. La aprobación explícita de liberación puede hacerse en el entorno production por el propietario. Si se añade un segundo responsable real, revisar las exigencias de aprobación.
3. Restringir production exclusivamente a la rama main y elegir un revisor autorizado. Para que el único propietario pueda aprobar su propia ejecución, no activar prevent self-review en ese caso. Revisar la política de bypass y las funciones disponibles según visibilidad/plan; no contratar planes automáticamente.
4. Comprobar ubicación de secretos de despliegue y, si corresponde, migrarlos al entorno protegido en una intervención autorizada. No borrar los existentes antes de verificar recuperación y acceso. Exigir una nueva orden humana de liberación para cada despliegue; subir una rama dev no la concede.
5. Probar el bloqueo de una ejecución sin aprobación y el camino autorizado en la próxima liberación. Una corrida verde de desarrollo con publish/deploy omitidos no prueba que el entorno real exija revisión.

## Etapa 2: dependencias e imágenes

`scan-vulnerabilities.py` audita cuatro ámbitos npm: API/web con `--omit=dev` (runtime) y árbol completo (build, incluye también runtime). No se supone que una dependencia de producción de Vue se sirva íntegramente al navegador; la salida compilada es el artefacto real. El gate bloquea avisos npm moderados o superiores y severidad desconocida. Las herramientas npm incluidas en las imágenes de construcción no están cubiertas por la auditoría del lockfile de la aplicación: es un límite explícito de este análisis.

Trivy v0.76.1 está fijado por digest. Primero descarga su base en un contenedor con red que solo recibe una caché temporal vacía. Exige esquema 2 y actualización no superior a 24 horas. Luego exporta las imágenes finales API/web/PostgreSQL como tar y las analiza **sin red ni socket Docker**, como usuario local, raíz de solo lectura, sin capacidades. Comprueba la identidad de la imagen, presencia del análisis de SO y ausencia de fin de soporte informado. Incluye paquetes del SO y lenguajes; no usa ignore-unfixed ni exclusiones del repositorio. No arranca las imágenes ni consulta datos. La imagen PostgreSQL es la oficial usada por Compose/CI, no un volumen ni una exportación de la base.

El gate bloquea HIGH/CRITICAL/UNKNOWN de imágenes aunque no tengan corrección; informa los demás niveles, versión instalada, corrección disponible, ámbito y ubicación. La severidad la aporta cada fuente del detector; no se afirma explotabilidad por versión ni que una herramienta auxiliar exponga los mismos caminos que un servidor. Un error, timeout, informe incompleto, identidad distinta o base vencida bloquea. Solo se imprimen campos seleccionados de hallazgos; no metadata/env ni diagnósticos crudos.

`vulnerability-exceptions.json` comienza vacío. Cualquier excepción requiere PR/revisión, coincidencia exacta de ámbito, aviso, paquete, versión y ruta, motivo concreto de aplicabilidad, issue y fecha absoluta de expiración dentro de 30 días. Valores comodín, entradas duplicadas, vencidas o sin coincidencia bloquean. Un aviso en otra ruta/versión/ámbito continúa bloqueando. Ejecutar todos los ámbitos juntos al usar excepciones; una ejecución parcial las tratará como pendientes sin coincidencia. Nunca añadir excepciones automáticamente para conseguir verde.

```sh
# Tras npm ci en api y web, y construir las imágenes finales:
python3 -m unittest discover -s deploy/ci -p 'test_vulnerabilities.py'
python3 deploy/ci/scan-vulnerabilities.py --npm --images sugar-privilege-api sugar-privilege-web postgres:17-alpine
```

El gate corre al final del job `test`, después de las pruebas funcionales, reutilizando las imágenes realmente construidas; `publish` continúa dependiendo de ese job y de Secret scan. Las acciones oficiales se actualizaron a checkout 7.0.1, setup-node 7.1.0, login 4.7.0, upload-artifact 7.0.2 y download-artifact 8.0.2, con SHA inmutable. Ya no se usan acciones de reconstrucción en el job de publicación. Esto actualiza el runtime de Actions; la aplicación conserva Node 22. Los guards de main, permisos mínimos y checkout sin credenciales se conservan.

### Resultado inicial y límites pendientes

El 3 de noviembre, npm no informó avisos en ninguno de los cuatro ámbitos. Trivy detectó diez avisos HIGH en el npm incluido en la antigua imagen de API. El runtime de API ahora copia solo Node y los módulos de aplicación a Alpine 3.24 con libstdc++; no incluye npm/yarn/corepack. El escaneo de esa imagen no informó vulnerabilidades. Las pruebas de API y Compose aislado verifican el arranque, migración, restricciones, permisos, imágenes, IA simulada y persistencia con ese runtime mínimo.

La imagen web Nginx 1.30.6/Alpine 3.24.3 informó inicialmente seis hallazgos HIGH/CRITICAL en brotli-libs, curl/libcurl y libexpat. Tras actualizar los paquetes de esa misma rama Alpine con `apk upgrade --no-cache`, su escaneo no informó vulnerabilidades. **El gate completo actualmente bloquea**: PostgreSQL 17.11/Alpine 3.24.3 informó 27 HIGH en Go stdlib/x/sys dentro de gosu, herramienta de cambio de usuario de su entrypoint. Consultar los informes del job para versiones/CVE vigentes. La etiqueta oficial de PostgreSQL se volvió a descargar y no cambió. No se aprobaron excepciones, no se modificó el volumen y no se afirma explotación remota de estos componentes. Su remediación/evaluación específica es la siguiente etapa de #14; no se declara verde ni se cierra el issue.

### Promoción de imágenes analizadas

Solo un análisis completo correcto genera un manifiesto con commit e identidades locales de las tres imágenes; un fallo borra cualquier manifiesto anterior. En main, después del gate, `runtime-artifact.py export` confirma que API/web conservan la misma identidad, las guarda por ID y añade SHA-256 de los tar. El artefacto de Actions se conserva un día y se descarga exclusivamente de la misma ejecución. Las ramas dev y PR no lo exportan ni suben.

Publicación valida commit, nombres esperados, hashes de archivo e identidad Docker tras la carga, y etiqueta/sube esas imágenes API/web a GHCR **sin reconstruir**. El destino es fijo, no lo decide el manifiesto. Fallos de integridad bloquean antes del push; solo el comando con `--push` puede publicar. Los hashes detectan cambios de transporte, no sustituyen revisión humana ni una firma/atestación del proveedor. Los tests cubren alteraciones de archivo/commit/imagen, cambios posteriores al escaneo, ausencia de push implícito y transporte Docker real de imágenes scratch ficticias sin ejecutar contenedores ni acceder al registro. El camino de subir/descargar artefactos de GitHub y push real queda para una liberación autorizada: dev lo omite deliberadamente.

PostgreSQL todavía usa la etiqueta oficial de Compose, no se promueve con este mecanismo: completar su remediación y fijación/promoción de identidad antes de liberar. Las bases de construcción usan tags del proveedor, pero el runtime API/web que se publique será el mismo que pasó el gate en esa ejecución. Los avisos y configuración externa pendientes tampoco autorizan liberar. Un escaneo sin avisos solo refleja las fuentes disponibles en ese momento, no garantiza ausencia de vulnerabilidades.

Reversión durante liberación autorizada: conservar workflow/reglas anteriores, revisar qué checks son obligatorios y evitar que un cambio de nombre bloquee PR. No debilitar reglas, saltar un gate de secretos ni eliminar credenciales para resolver un fallo de CI. Esta entrega no altera datos, servicios existentes ni producción.

Fuentes: [Trivy: imágenes](https://trivy.dev/docs/latest/target/container_image/), [operación sin red](https://trivy.dev/docs/latest/advanced/air-gap/), [Node Docker: imagen mínima](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md), [acciones oficiales](https://github.com/actions/setup-node), [Gitleaks](https://github.com/gitleaks/gitleaks), [protección de ramas](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [entornos de despliegue](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
