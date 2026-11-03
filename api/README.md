# Arquitectura del API

El backend sigue usando Express y PostgreSQL. Las rutas se organizan por funcionalidad y comparten políticas de acceso explícitas.

## Arranque y composición

- `src/server.js`: punto de entrada de Docker y `npm start`. Espera la base de datos, ejecuta las inicializaciones existentes, obtiene el secreto de sesión, crea la aplicación, inicia explícitamente el sincronizador y abre el puerto HTTP.
- `src/app.js`: `createApp({ q, transaction, secret, enqueue, syncOne, callProvider?, sessionSecure? })` configura Express y conecta repositorios, servicios y rutas. No ejecuta migraciones, consultas, `listen()` ni trabajos periódicos. Puede importarse y crear aplicaciones para pruebas con dependencias controladas.
- `src/db.js`: pool PostgreSQL, transacciones, inicialización y secreto persistente. `transaction(fn)` entrega a `fn` una función `tx(sql, args)` ligada a la misma conexión; confirma o revierte y libera la conexión.
- `src/shared/http.js`: adaptación de promesas a Express, errores de dominio con estado HTTP, validación de texto y traducción de errores a las respuestas JSON existentes.

## Dónde añadir código

| Funcionalidad | Rutas HTTP | Reglas y operaciones | Consultas |
| --- | --- | --- | --- |
| Sesiones | `auth/routes.js` | `auth/service.js`; `auth/policies.js` para roles y acceso a proyectos | `users/repository.js` |
| Usuarios y preferencias | `users/routes.js` | `users/service.js` | `users/repository.js` |
| Proyectos, configuración, revisiones y enlaces | `projects/routes.js` | `projects/service.js`; `projects/validation.js` para destinos GitHub | `projects/repository.js` |
| Biblioteca y versiones de bloques | `blocks/routes.js` | `blocks/service.js` | `blocks/repository.js` |
| Galería y contenido público | `images/routes.js` | `images/service.js`; `images.js` para bytes y migración de imágenes incrustadas | `images/repository.js`; la migración usa el `tx` recibido |
| Categorías e iconos | `categories/routes.js` | `categories.js`, `category-icons.js` | Se conserva el módulo existente `categories.js`, con la función de consulta explícita |
| Validación YAML | `documents.js` | `model.js`, `categories.js` | Validación de categorías mediante `q` explícito |
| IA | Registro existente `registerAi()` en `ai.js` | Se conserva `ai.js`, incluido proveedor, contexto e historial | Consultas existentes de `ai.js` con `q` explícito |
| Sincronización GitHub | `github/routes.js` | `github.js`: cola, publicación, reintentos y arranque explícito | Se mantienen las consultas de la cola en `github.js` y la cancelación por cambio de destino dentro de la transacción de configuración del proyecto |

Las rutas convierten entrada/salida HTTP; los servicios principales reciben identificadores, datos y usuarios normales, nunca objetos `req`/`res`. Los repositorios reciben una función de consulta y aceptan `tx` en los métodos que escriben dentro de una transacción. Las funciones existentes de categorías, imágenes, IA y GitHub se reutilizan para evitar capas que solo reenvíen llamadas.

Para una operación nueva, añadir la política/regla al servicio, las consultas al repositorio de su funcionalidad y el adaptador a `routes.js`; registrar el módulo en `createApp` si es una funcionalidad nueva. No importar `server.js` desde módulos de aplicación o pruebas. El registro público va antes del middleware de sesión; el resto después. El contenido de imágenes continúa siendo público, mientras la administración de la galería requiere sesión y los roles existentes.

## Biblioteca personal y catálogo compartido

`library/access.js` centraliza los permisos de bloques y categorías. `owner_id = NULL` identifica el catálogo compartido: todos los usuarios autenticados pueden leerlo y solo `Admin` puede mantenerlo. Un propietario con rol `dev` puede leer y modificar sus recursos personales; otras cuentas reciben 404 y no los ven en listados. `Admin` conserva acceso de administración. La eliminación de bloques sigue reservada a `Admin`; la papelera por propietario pertenece al issue #19.

`POST /api/blocks` y `POST /api/categories` aceptan `scope: 'personal' | 'catalog'`. El valor predeterminado es personal para `dev` y catálogo para `Admin`. El servidor obtiene el propietario de la sesión; nunca confía en un `owner_id` del cliente. El ámbito no se cambia al editar. Los listados incluyen `owner_id` y `permissions: { scope, canEdit }`. Versiones, YAML histórico, diferencias y restauraciones verifican el mismo acceso.

Las categorías personales admiten nombres repetidos entre cuentas y slugs únicos; sus hijos pertenecen al mismo propietario. Un bloque personal puede usar categorías propias o compartidas; un bloque del catálogo solo categorías compartidas. `/api/validate` admite `blockId` para resolver el propietario al editar un bloque existente. Los proyectos conservan sus snapshots y los iconos públicos siguen limitados a los slugs utilizados.

`library/migration.js` agrega propiedad e índices mediante una transacción idempotente. Los registros anteriores permanecen en el catálogo compartido, conservando autores, YAML, slugs, versiones y referencias. La integración prueba esta migración en un esquema temporal aislado y verifica permisos entre dos cuentas, restauraciones y compatibilidad de proyectos.

## Límites transaccionales

- Crear proyecto: proyecto + revisión inicial.
- Guardar/restaurar proyecto: actualización con revisión esperada + historial + encolado GitHub. Restaurar también migra las imágenes incrustadas con el mismo `tx`.
- Cambiar configuración: actualización con versión esperada + historial + invalidación del enlace cuando cambia la visibilidad + cancelación de trabajos anteriores + encolado del nuevo destino.
- Crear/guardar/restaurar bloque: validación de categoría + metadatos con versión esperada + versión histórica; la restauración usa la misma transacción para migrar imágenes.

No usar `q` global en una escritura que forma parte de estos grupos: pasar siempre `tx`, también a `enqueue`, validaciones y migraciones de imágenes. Un fallo de inserción en historial o cola debe revertir todos los cambios. Los reintentos del trabajador no se inician al construir la aplicación: solo desde `server.js` o una acción HTTP explícita autorizada.

## Pruebas

```sh
cd api
npm ci
npm test
```

Esto ejecuta pruebas unitarias y de contratos con un servidor efímero controlado por la propia prueba. No necesita PostgreSQL. Las pruebas de integración se omiten si no se indican las variables de activación. La prueba de construcción ejecuta `createApp` en un proceso que prohíbe listeners, temporizadores y llamadas a las dependencias.

GitHub Actions inicia PostgreSQL desechable, dos bases y dos APIs:

- `sugar_ai`: API con `test-support/deepseek-mock.mjs`, administrador de prueba `local-ai-verification-password`, `AI_TEST_URL` apuntando a esa API.
- `sugar_icons`: API normal, administrador de prueba `local-icons-verification-password`, `ICON_TEST_URL` y `API_TEST_URL` apuntando a esa API. `API_TEST_DATABASE_URL` apunta a esa misma base desechable para las pruebas de rollback real.
- Ambas usan `admin@local` y `AI_ENCRYPTION_KEY` de prueba de 64 caracteres hexadecimales. Los comandos exactos de arranque y ejecución están en `.github/workflows/deploy.yml`.

**Nunca apuntar estas variables a una instalación real**: las pruebas crean cuentas, modifican contraseñas/roles, crean y archivan proyectos/bloques/imágenes e introducen fallos controlados para verificar rollback. Los datos de prueba se eliminan junto con la base desechable.

La suite cubre sesiones/cookies, perfiles, roles, visibilidad privada/pública, enlaces compartidos/revocación, exportaciones y diferencias, actualizaciones concurrentes y conflictos, versiones de bloques, permisos de imágenes/categorías y los análisis IA existentes. Inyecta fallos después de insertar historial/cola para comprobar que PostgreSQL revierte también metadatos, estados de sincronización, enlaces y migraciones de imágenes.

En ramas de desarrollo se puede ejecutar el workflow manualmente con `gh workflow run deploy.yml --ref <rama>`. Ejecutará las pruebas; publicación y despliegue están condicionados a `refs/heads/main`. El despliegue de producción sigue usando el mismo `Dockerfile` y `node src/server.js`.
