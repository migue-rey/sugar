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

Para una operación nueva, añadir la política/regla al servicio, las consultas al repositorio de su funcionalidad y el adaptador a `routes.js`; registrar el módulo en `createApp` si es una funcionalidad nueva. No importar `server.js` desde módulos de aplicación o pruebas. El registro público va antes del middleware de sesión; el resto después. El contenido de imágenes comprueba acceso incluso en rutas anteriores al middleware de sesión; la galería requiere autenticación y aplica el ámbito personal o compartido.

## Biblioteca personal y catálogo compartido

`library/access.js` centraliza los permisos de bloques y categorías. `owner_id = NULL` identifica el catálogo compartido: todos los usuarios autenticados pueden leerlo y solo `Admin` puede mantenerlo. Un propietario con rol `dev` puede leer y modificar sus recursos personales; otras cuentas reciben 404 y no los ven en listados. `Admin` conserva acceso de administración. La eliminación de bloques sigue reservada a `Admin`; la papelera por propietario pertenece al issue #19.

`POST /api/blocks` y `POST /api/categories` aceptan `scope: 'personal' | 'catalog'`. El valor predeterminado es personal para `dev` y catálogo para `Admin`. El servidor obtiene el propietario de la sesión; nunca confía en un `owner_id` del cliente. El ámbito no se cambia al editar. Los listados incluyen `owner_id` y `permissions: { scope, canEdit }`. Versiones, YAML histórico, diferencias y restauraciones verifican el mismo acceso.

Las categorías personales admiten nombres repetidos entre cuentas y slugs únicos; sus hijos pertenecen al mismo propietario. Un bloque personal puede usar categorías propias o compartidas; un bloque del catálogo solo categorías compartidas. `/api/validate` admite `blockId` para resolver el propietario al editar un bloque existente. Los proyectos conservan sus snapshots y los iconos públicos siguen limitados a los slugs utilizados.

`library/migration.js` agrega propiedad e índices mediante una transacción idempotente. Los registros anteriores permanecen en el catálogo compartido, conservando autores, YAML, slugs, versiones y referencias. La integración prueba esta migración en un esquema temporal aislado y verifica permisos entre dos cuentas, restauraciones y compatibilidad de proyectos.

## Imágenes y adjuntos de diagramas

El único adjunto subido que admite actualmente la aplicación es una imagen PNG/JPEG/WebP; los datasheets y otros enlaces externos siguen siendo URLs y no se descargan al servidor. `images/service.js` valida acceso y registra las asociaciones de `block.image` en `image_references`, dentro de la misma transacción que el bloque/proyecto y su historial. Adivinar un ID ajeno no permite asociarlo a otro recurso. No se altera el YAML ni se guardan credenciales de enlace en él.

- `POST /api/images` acepta `scope: 'personal' | 'catalog'`, predeterminado personal incluso para Admin. El propietario se deriva de la sesión. Solo Admin crea imágenes de catálogo. Las imágenes antiguas conservan bytes/ID/URL y reciben su `created_by` como propietario; las que no tienen autor quedan accesibles a Admin y a los lectores de recursos que las referencian, sin publicación global automática.
- `GET /api/images` lista las imágenes propias y de catálogo; Admin ve todas. La pertenencia a un proyecto no enumera la galería de su autor.
- `GET /api/images/:id/content` permite al propietario, Admin y lectores de bloques/proyectos activos consultar imágenes referenciadas, incluido historial autenticado. Las imágenes de catálogo requieren sesión. Anónimos solo acceden a imágenes **actualmente** usadas por un proyecto público; no a imágenes exclusivas de revisiones antiguas.
- `GET /api/shared/:token/images/:id/content` exige un enlace vigente y una referencia en el diagrama actual de ese proyecto. Nunca amplía acceso a otras imágenes del propietario ni al historial. El frontend resuelve estas rutas solo al presentar la vista compartida; los YAML conservan rutas canónicas.
- Los enlaces privados tienen siete días de vigencia. Solicitar uno vigente conserva token y fecha; solicitar uno vencido genera ambos de nuevo. Revocar, cambiar visibilidad o archivar el proyecto anula los accesos correspondientes. La migración asigna siete días desde la actualización a enlaces antiguos sin vencimiento.

**Reutilización:** guardar una imagen a la que se tiene acceso legítimo en otro bloque/proyecto crea una asociación independiente. Revocar el recurso original no elimina esa copia ni el acceso por otras asociaciones válidas. Archivar la imagen bloquea todos sus accesos. La eliminación por propietario se trata en #19.

**Caché y revocación:** bytes, respuestas públicas/compartidas y galería indican `Cache-Control: private, no-store`, `Pragma: no-cache` y `Vary: Cookie`. Los bytes no emiten ETag ni respuestas 304; cada petición verifica permisos y vigencia. Las páginas omiten Referer para no filtrar tokens a enlaces externos. La revocación se aplica a nuevas peticiones; no borra imágenes ya mostradas, descargadas o copiadas. Antes de esta entrega se permitía caché pública de una hora: copias servidas por versiones antiguas pueden sobrevivir ese plazo y no pueden retirarse remotamente. Proxies/CDN deben respetar `no-store` y no añadir caché a estas rutas. Las plantillas Nginx de web y despliegue omiten query strings/Referer y ocultan tokens de `/api/shared/` en access logs. Al liberar, aplicar también la plantilla del proxy externo; esta rama no modifica la VPS.

`images/migration.js` agrega propiedad, referencias y vencimiento mediante una migración transaccional, idempotente y serializada. Reconstruye asociaciones desde revisiones sin modificarlas. Se prueban datos heredados, aislamiento entre cuentas, intentos de asociar IDs ajenos, lectores/miembros, historial, publicación, reutilización, revocación, vencimiento y rollback de asociaciones junto con historial.

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

## Acceso a proyectos

La visibilidad y el permiso de escritura son independientes. Un proyecto público puede leerse sin sesión mediante su URL pública; no concede edición a otras cuentas. El propietario y `Admin` conservan acceso. Los colaboradores explícitos tienen rol `reader` o `editor`; para escribir se requiere además el rol global `dev`/`Admin`. Una cuenta global `view` no puede obtener escritura mediante una membresía.

`project_members` guarda estas concesiones fuera del YAML y de las revisiones. La inicialización crea la tabla e índice sin otorgar acceso nuevo a proyectos existentes. El listado incluye proyectos privados donde la cuenta es colaboradora; al revocar acceso desaparecen si no hay otra autorización.

Solo propietario/administrador gestiona las cuentas existentes desde Configuración del proyecto o mediante:

- `GET /api/projects/:id/members`
- `PUT /api/projects/:id/members` con `{ email, role: 'reader' | 'editor' }`
- `DELETE /api/projects/:id/members/:userId`

No se envían invitaciones por correo ni se crean cuentas mediante estas rutas. Los lectores pueden consultar historial/exportar y leer análisis accesibles; crear análisis exige permiso de edición. `GET /api/projects/:id` devuelve `permissions` para que la interfaz muestre controles coherentes, pero el servidor comprueba cada operación.

Guardar/restaurar y modificar accesos se serializan sobre la fila del proyecto. Tras obtener el bloqueo se consulta nuevamente la membresía con una sentencia nueva, evitando usar permisos leídos antes de una revocación concurrente. Las pruebas incluyen este caso y conflictos de revisión con editores autorizados. Administración de biblioteca, imágenes y borrado de recursos mantienen sus reglas actuales; sus cambios se tratan en los demás issues del plan público.
