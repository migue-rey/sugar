# CI de seguridad y liberación — #14, etapa 1

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

## Próxima etapa pendiente

Auditoría separada de dependencias API de ejecución, dependencias/herramientas de compilación web e imágenes finales (sistema operativo y paquetes). Clasificar severidad, disponibilidad de corrección y aplicabilidad; no silenciar avisos existentes con una exclusión global para conseguir verde. Resolver actualizaciones en #15 y definir excepciones justificadas con caducidad. Revisar pins de acciones antiguos que GitHub avisa que ejecuta con compatibilidad Node 24. Esos escáneres y el gate correspondiente aún no están implementados: **#14 permanece abierto**.

Reversión durante liberación autorizada: conservar workflow/reglas anteriores, revisar qué checks son obligatorios y evitar que un cambio de nombre bloquee PR. No debilitar reglas, saltar un gate de secretos ni eliminar credenciales para resolver un fallo de CI. Esta etapa no modifica aplicación, datos, contenedores existentes ni producción.

Fuentes: [Gitleaks oficial](https://github.com/gitleaks/gitleaks), [protección de ramas](https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches), [entornos de despliegue](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).
