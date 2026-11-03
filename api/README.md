# Arquitectura del API

El backend sigue usando Express y PostgreSQL. Las rutas se organizan por funcionalidad y comparten políticas de acceso explícitas.

## Arranque y composición

- `src/server.js`: punto de entrada de Docker y `npm start`. Verifica el rol restringido y la versión del esquema sin DDL, obtiene el secreto de sesión, crea la aplicación, inicia explícitamente el sincronizador y abre el puerto HTTP.
- La imagen Docker usa UID/GID 1000; Compose restringe capacidades, escrituras y procesos. Ver [política y compatibilidad de archivos privados](../deploy/containers/README.md). Las migraciones/alta inicial se ejecutan aparte con `npm run migrate`; ver `deploy/database/README.md`.
- `/api` aplica caché privada sin almacenamiento y controles de Origin/Fetch Metadata antes de procesar escrituras. Configurar `PUBLIC_ORIGIN` al usar un dominio/proxy HTTPS; ver [modelo de cookies, CSP y caché](../deploy/headers/README.md). Los cuerpos de escritura deben usar `application/json`; no se habilita CORS.
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

## Sesiones revocables

`auth/sessions.js` mantiene identidades de sesión en PostgreSQL. Cada login crea un UUID distinto y un JWT HS256 firmado con `id`/`sid`; no guarda el token bearer en la base. JWT y registro vencen a los siete días sin renovación automática. Cada petición comprueba firma, vencimiento, registro no revocado, versión de credenciales, cuenta activa y rol/preferencias actuales. Reiniciar la API conserva las sesiones. La inicialización es idempotente.

- `POST /api/logout` revoca esa identidad antes de borrar la cookie; una copia del token deja de autenticar. Es idempotente incluso para cookies inválidas o ausentes.
- `GET /api/me/sessions` lista únicamente sesiones activas propias (`id`, `created_at`, `expires_at`, `current`). No devuelve JWT, hashes, IP ni User-Agent.
- `DELETE /api/me/sessions/:id` cierra una sesión propia; un ID ajeno recibe 404. Si es la actual, también borra la cookie.
- `POST /api/me/sessions/revoke-others` cierra todas las otras identidades existentes de esa cuenta, conservando la actual. Se serializa con login y cambios de contraseña; un login legítimo posterior puede crear una nueva sesión.
- Cambiar contraseña invalida **todas** las sesiones, incluida la actual, y exige volver a entrar. El cambio de hash, incremento de `users.auth_version` y revocaciones comparten transacción; se compara el hash esperado para evitar carreras con otro cambio o login. La futura recuperación de contraseña (#17) debe reutilizar esta operación atómica; todavía no existe un flujo de recuperación ni se envían correos.
- Desactivar una cuenta incrementa su versión y revoca sesiones en la misma transacción. Reactivarla no revive tokens viejos. Cambiar el rol se refleja en la siguiente petición sin emitir otro JWT.

Las cookies conservan `HttpOnly`, `SameSite=Strict`, siete días y `Secure` en producción. Login, logout, metadatos de sesiones y errores 401 indican `private, no-store`. Una sesión inválida/caducada produce 401 y borra la cookie; el frontend vuelve al formulario de acceso, sin reintentar automáticamente operaciones. La revocación se aplica a peticiones nuevas; no cancela peticiones ya autorizadas. La recuperación de borradores tras caducar pertenece a #27.

**Liberación:** los JWT antiguos sin identidad `sid` se rechazan: al desplegar esta entrega, todas las cuentas deberán iniciar sesión de nuevo. No se modifican contraseñas ni datos de proyectos. Las sesiones posteriores sobreviven reinicios mientras se conserven PostgreSQL y la clave de firma. La retención/poda de registros revocados o vencidos se tratará con las cuotas de #20.

## Límites de acceso y proxies

`security/limits.js` aplica controles en memoria **por proceso de API**, sin consultas extra a PostgreSQL ni esperas activas. No es un contador distribuido: antes de añadir réplicas debe existir un límite compartido en el proxy o almacén central. Reiniciar el proceso reinicia contadores. Las pruebas de ráfagas usan presupuestos explícitos pequeños; las APIs desechables de CI elevan límites de fixtures para no interferir entre suites paralelas.

| Variable | Predeterminado | Ventana y alcance |
| --- | --- | --- |
| `API_IP_LIMIT` | 600 | peticiones API/minuto por IPv4 o subred IPv6 /64 |
| `API_GLOBAL_LIMIT` | 3000 | peticiones API/minuto por proceso |
| `AUTH_IP_LIMIT` | 20 | intentos de login/minuto por IP o /64 |
| `AUTH_GLOBAL_LIMIT` | 120 | intentos de login/minuto por proceso |
| `AUTH_ACCOUNT_LIMIT` | 10 | intentos por email normalizado cada 15 minutos; éxito reinicia ese contador |
| `AUTH_CREDENTIAL_LIMIT` | 5 | cambios de contraseña/creación de cuentas por usuario autenticado cada 15 minutos |
| `AUTH_HASH_CONCURRENCY` | 4 | operaciones de credenciales simultáneas; no hay cola |
| `AUTH_MAX_KEYS` | 20000 | entradas máximas del contador; al llenarse rechaza claves nuevas hasta liberar vencidas |

Tras tres fallos de login se exige esperar 1, 2, 4… segundos hasta 60. Se responde 429 con `Retry-After` entero y `private, no-store`; no se retienen conexiones durmiendo ni se reintentan peticiones. Intentos rechazados no prolongan la ventana de cuenta de 15 minutos: no hay bloqueo permanente. Un aborto de conexión no libera el cupo bcrypt hasta finalizar su trabajo. `/api/health` queda fuera de estos límites para no provocar reinicios por las comprobaciones de salud.

Login, cambio de contraseña y creación de cuentas tienen un cuerpo JSON máximo de 4 KiB. Login exige strings, email con formato/longitud acotados y contraseña de hasta 1024 bytes; se mantiene compatibilidad con credenciales antiguas largas. Las contraseñas nuevas no superan 72 bytes, evitando truncamiento silencioso de bcrypt. Cuentas desconocidas/desactivadas y contraseñas incorrectas usan el mismo error y una comparación bcrypt de coste 12. Los contadores no contienen emails, IP ni contraseñas en claro: sus claves usan HMAC efímero con la clave de firma y no se registran en logs.

`TRUSTED_PROXIES` es una lista explícita de IP/CIDR separados por coma, vacía por defecto (se ignoran cabeceras de IP). Se rechazan booleanos, número de saltos y rutas universales. Al liberar, determinar las IP/redes **de los proxies reales** y configurar solo esas; no copiar indiscriminadamente todos los rangos privados. El proxy frontal sobrescribe `X-Forwarded-For` con su conexión real y el contenedor web añade el salto que observó. Express se detiene en el primer salto no confiable. La API y el puerto del contenedor web deben quedar inaccesibles públicamente por fuera de esta cadena. Véase la [documentación oficial de Express sobre proxies](https://expressjs.com/en/guide/behind-proxies/).

Sin configuración de proxies, el límite por IP agrupa los clientes del proxy: es conservador frente a abuso, pero puede limitar usuarios legítimos juntos. Aplicar la plantilla Nginx frontal y configurar `TRUSTED_PROXIES` son tareas de la liberación autorizada; esta rama no cambia la VPS. Registro y recuperación futuros (#16/#17) deben usar límites equivalentes antes de consultar cuentas, enviar correo o calcular hashes, manteniendo respuestas genéricas. La protección de gasto de IA se trata en #8.

## Presupuestos y reservas de IA

`ai/quotas.js` guarda configuración y un libro de llamadas en PostgreSQL. Las reservas usan una transacción y un advisory lock común: dos procesos no pueden consumir simultáneamente el último cupo, ejecutar dos consultas de un usuario o facturar dos veces el mismo `requestId`. El bloqueo se libera antes de consultar al proveedor. El resultado y su cargo definitivo se confirman en una sola transacción con el análisis. Si falla el almacén no se llama al proveedor.

Admin configura `GET/PUT /api/ai/quotas`. El PUT requiere `expectedVersion` y todos los límites; un cambio concurrente devuelve 409. Valores iniciales: periodo de 24 horas, 100 solicitudes/1.000.000 tokens por cuenta, 1.000 solicitudes/10.000.000 tokens en la plataforma y cuatro consultas simultáneas globales. Cada usuario conserva su contador independiente y como máximo una consulta activa. Un presupuesto cero impide nuevas llamadas. El periodo admite 1–744 horas; son ventanas fijas alineadas al epoch UTC, no meses de calendario. Cambiarlo cuenta las llamadas existentes que caen en la nueva ventana, sin borrar consumo.

`GET /api/ai/usage` devuelve límites, consumo/reservas de la cuenta actual y totales agregados de la plataforma, junto con `resetsAt`. No publica usuarios ajenos, credenciales ni saldos del proveedor. La pestaña IA muestra el disponible y la fecha local de renovación; Configuración permite a Admin ajustar los presupuestos. Se responde 429 con `Retry-After` cuando no alcanza el cupo; no hay reintento automático.

Antes de cada análisis se reserva una estimación conservadora: bytes UTF-8 de los mensajes serializados + 4.096 de margen + 4.000 de salida máxima (16 para probar conexión). El proveedor sigue limitado a 4.000 tokens de salida, contexto de 200 KiB y 120 segundos. Una respuesta exitosa con consumo total entero y válido sustituye la reserva por ese consumo; si no informa consumo se conserva la reserva. Si el proveedor informa más de lo reservado se contabiliza todo y se bloquean nuevas llamadas cuando corresponda. Estos son **presupuestos de tokens y solicitudes, no límites monetarios ni el saldo de DeepSeek**: no se consultan precios ni se estima dinero.

Fallos, timeouts o resultados inciertos conservan su reserva y cuentan como una solicitud, aunque no se guarde análisis. El mismo ID no se vuelve a ejecutar; repetirlo devuelve conflicto o el resultado ya guardado. Un trabajador perdido libera su cupo de concurrencia tras cinco minutos, marcándolo incierto y conservando el cargo. No se reintenta esa identidad. Revisar historial antes de decidir una nueva solicitud. Cambiar límites no cancela llamadas ya iniciadas.

Las pruebas de conexión están sujetas a los mismos presupuestos y concurrencia. `POST /api/ai/test` requiere ahora `{ requestId: UUID }`; la interfaz ya lo envía. Repetir ese ID conserva la operación original; cambiar token/modelo con el mismo ID devuelve conflicto. Clientes externos antiguos deben añadir un ID por operación para proteger las pruebas facturables. Los análisis continúan usando su ID existente.

Al inicializar se incorporan análisis heredados al libro sin modificar sus snapshots/respuestas: se usa su consumo informado o una reserva conservadora de 212.896 tokens si no existe. Esto puede dejar agotado un presupuesto en la primera ventana después de actualizar. Las pruebas de conexión antiguas no tenían historial y no se reconstruye un consumo desconocido. La configuración global del proveedor y los tokens cifrados se conservan. Al liberar, reemplazar todas las réplicas antiguas: las versiones previas no conocen las cuotas. No se ha contactado a DeepSeek para validar esta entrega; las pruebas usan únicamente proveedores simulados y bases desechables.

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

## Alta inicial y secretos de archivo

`auth/bootstrap.js` crea un único administrador solo con una base sin usuarios, dentro de una transacción con bloqueo entre réplicas. Requiere contraseña explícita de 12 caracteres y máximo 72 bytes; solo registra un mensaje genérico. Si ya existen usuarios, no cambia contraseñas ni crea accesos alternativos a partir de variables de arranque. La recuperación y rotación se describen en `deploy/security/README.md`.

El servidor carga `config/load-env.js` antes de crear el pool PostgreSQL. Admite `_FILE` para DATABASE_URL, ADMIN_PASSWORD, JWT_SECRET, AI_ENCRYPTION_KEY y GITHUB_PRIVATE_KEY. Rechaza archivos no regulares, symlinks, propietarios ajenos a root/UID del proceso, modos distintos de 0400/0600, archivos vacíos o mayores de 64 KiB y conflicto entre valor y archivo. JWT_SECRET explícito requiere 32 bytes y AI_ENCRYPTION_KEY 64 caracteres hexadecimales. La construcción programática de createApp sigue sin leer secretos ni iniciar procesos; su caller inyecta las dependencias. El Compose habitual usa `.env` privada; los archivos deben montarse y configurarse expresamente, no aparecen por indicar su nombre.

Los fallos inesperados HTTP, GitHub y arranque registran códigos permitidos; no se serializan mensajes, detalles, stack, cabeceras o cuerpos ajenos. La cola GitHub guarda códigos de fallo (por ejemplo GITHUB_WRITE_403), sin cuerpos de respuesta. Los errores de dominio que se devuelven a clientes siguen sus contratos habituales. No se eliminan registros históricos: si contenían una contraseña anterior, considerarla expuesta y rotarla únicamente durante una intervención autorizada.

## Liveness y readiness (#23, etapa 1)

`GET /api/health` confirma solo que Express responde. `GET /api/ready` consulta el marcador de esquema con el pool/rol reales y devuelve únicamente `{ok:true}` (200) o `{ok:false}` (503), sin autenticación ni diagnósticos. Tiene deadline HTTP de 1,5 segundos, una comprobación compartida, caché de un segundo y los límites API existentes. Compose y los verificadores de despliegue usan readiness. Ver [alcance, límites y ensayos de fallo/recuperación](../deploy/monitoring/README.md). Las alertas externas y la auditoría de operaciones siguen pendientes.
