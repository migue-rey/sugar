# Dependencias y bases — #15, 3 de noviembre de 2026

## Comparación npm

| Ámbito | Antes | Después |
| --- | --- | --- |
| API, dependencias de ejecución | diff 7.0.0; un aviso bajo | diff 8.0.3; cero avisos |
| Herramientas web de compilación | vue-tsc 2.2.12, @vue/language-core 2.2.12, minimatch 9.0.9; tres avisos moderados contando la cadena | vue-tsc/language-core 3.3.14; minimatch y su cadena eliminados; cero avisos |

Se actualizaron únicamente diff y vue-tsc con versiones exactas y lockfiles npm. No se usó audit fix --force, overrides globales ni excepciones de auditoría. Los cambios transitivos de lenguaje/Volar y metadatos opcionales de plataformas quedan reflejados en el lockfile. TypeScript y las dependencias de ejecución del navegador no cambiaron. El resultado depende de la base de avisos consultada en esta fecha; no equivale a ausencia de vulnerabilidades desconocidas.

El aviso de diff afecta parsePatch/applyPatch. En Sugar se encontraron llamadas a createPatch para comparar revisiones de proyectos y versiones de bloques, sin uso directo de las funciones afectadas: no se demostró una ruta de explotación de ese aviso en la aplicación. Se actualizó igualmente a una versión corregida y se mantienen las pruebas de diferencias YAML. El aviso minimatch pertenece a la cadena de comprobación de tipos; no se sirve como código del navegador ni se ejecuta en el contenedor API final.

## Bases y componentes observados

| Imagen | Componentes locales observados | Decisión |
| --- | --- | --- |
| node:22-alpine | Node 22.23.4 / Alpine 3.24.3 | Mantener Node 22, rama LTS indicada por el proveedor |
| postgres:17-alpine | PostgreSQL 17.11 / Alpine 3.24.3 | Sin cambio de major ni formato del volumen |
| nginx:1.27-alpine anterior | Nginx 1.27.5 / Alpine 3.21.3 | Sustituir: Alpine 3.21 figura con fin de soporte el 1 de noviembre y Nginx es una rama anterior |
| nginx:1.30.6-alpine nueva | Nginx 1.30.6 / Alpine 3.24.3 | Versión stable publicada por Nginx; misma imagen para web y ensayo TLS |

Digest observado de la nueva imagen Nginx: `sha256:0e52bd054126cdc040b1276c0af347aeb02a41b9cfe305d6094767ac30e97949`. Los tags de Docker siguen siendo mutables; el dato registra lo inspeccionado, no fija todas las bases por digest. No se deduce explotabilidad de una numeración ni se declara un análisis completo de CVE de todas las librerías del sistema: el escaneo automatizado de imágenes y la clasificación detallada siguen en #14. No se actualizó ningún daemon, servicio real ni volumen.

## Verificación y reversión

Instalación reproducible mediante npm ci en Node 22, tests API y frontend, TypeScript/Vite y pruebas de integración de permisos, diferencias YAML, IA simulada y Compose con runtime restringido en CI. El ensayo HTTP/TLS usa ahora Nginx 1.30.6. No hay cambios de esquema ni código de exportación.

El bundle JavaScript compilado antes y después tiene exactamente el mismo nombre y SHA-256:

```text
42bfd455aed8c39c60b3dfe2429bd8228870b3c0d55bca4825abdd7e2692d457  /usr/share/nginx/html/assets/index-BRaNh5Kz.js

```

Esta comparación prueba que la actualización de vue-tsc no modificó el código servido de pizarra/exportaciones; no sustituye la inspección manual de archivos SVG/PNG pendiente en #13 ni afirma que esa inspección ya se realizó.

Para revertir una liberación autorizada, volver al commit/imagen anterior y sus lockfiles; no hay migración de datos nueva. Las actualizaciones se prepararon en desarrollo: publicación y despliegue de producción deben permanecer omitidos en CI de esta rama.

Fuentes: [aviso diff](https://github.com/advisories/GHSA-73rr-hh4g-fpgx), [corrección diff 8.0.3](https://github.com/kpdecker/jsdiff/releases/tag/v8.0.3), [aviso minimatch](https://github.com/advisories/GHSA-g3hv-75wg-m249), [Alpine](https://alpinelinux.org/releases/), [Node](https://nodejs.org/en/about/previous-releases), [Nginx](https://nginx.org/en/download.html).
