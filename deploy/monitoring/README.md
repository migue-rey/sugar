# Disponibilidad — #23, etapa 1

`GET /api/health` conserva liveness: 200 con `{"ok":true}` si Express atiende; no consulta DB. `GET /api/ready` devuelve 200/`{"ok":true}` solo cuando la conexión de la API puede leer el marcador de esquema esperado; devuelve 503/`{"ok":false}` si falla, falta o difiere. Ambos responden `private, no-store`. No requieren login ni devuelven versiones, hosts, SQL, cuentas, credenciales o errores. Un fallo añade `Retry-After: 1`.

Readiness usa el pool y rol SQL reales, una consulta de solo lectura y timeout de llamada pg de 1 segundo. Una envoltura de 1,5 segundos limita la respuesta también al esperar conexión. Comparte una sola comprobación en curso y guarda el resultado un segundo por proceso. Si la operación subyacente no termina, conserva la respuesta no disponible y no encola más consultas; un resultado tardío no convierte el timeout en éxito. Una vez terminada, la siguiente comprobación puede recuperar disponibilidad. El deadline HTTP no garantiza cancelación inmediata de SQL/TCP; un pool permanentemente bloqueado requiere diagnóstico operativo. No se abren conexiones a IA, GitHub, SMTP ni servicios opcionales para decidir si la API puede recibir tráfico.

Los healthchecks API/web de Compose, espera de integración y verificación del runner/workflow ahora usan `/api/ready`. Readiness está sujeto a los límites API existentes: no hacer polling agresivo ni configurar límites por debajo del tráfico de monitorización. Liveness mantiene su exención para diagnóstico y no demuestra que los datos estén accesibles. No hay reinicio automático de API por un cambio de readiness; la política de Docker de reinicio y la comprobación de disponibilidad son distintas.

El pool maneja errores de conexiones inactivas: registra únicamente el evento fijo y un código filtrado, sin serializar el error. Así una desconexión de DB no termina el proceso por un evento sin receptor y permite comprobar fallo/recuperación. No sustituye la verificación de permisos de startup ni realiza migraciones, reparaciones o cambios de datos.

## Validación y límites

Las pruebas unitarias verifican caché, concurrencia, espera limitada, finalizaciones tardías, esquema incorrecto, recuperación, independencia de liveness, redacción HTTP y límites de consultas. Los errores de pool se prueban con contenido sintético y sin exposición de mensajes.

`deploy/containers/smoke.py` utiliza redes/volumen desechables y PostgreSQL real: prepara datos inventados, para DB manteniendo API abierta, exige readiness 503/liveness 200 y, al arrancar DB, readiness 200 sin reinicios de API. Después verifica persistencia y el recorrido de imágenes/rollback DB de #29. La imagen de prueba incorpora `readiness.mjs`; nunca se publica como imagen de aplicación. No ejecutar las pruebas contra instalaciones existentes.

```sh
# Tras construir API, fixture API, web y DB indicadas en deploy/containers:
python3 deploy/containers/smoke.py --rollback-database-image postgres:17-alpine@sha256:266d3c257594e195b309ae9d1805e54c788f1d7b375f56bf6c367aac6c917e7b
```

Esta etapa no completa #23: quedan auditoría estructurada de operaciones con actor/resultado, política de retención, métricas/umbrales de disco/backups/colas/IA y receptor de alertas simulado. Los destinos externos y su activación requerirán configuración/autorización del propietario. No se instalan tareas, envían mensajes ni modifican producción.

Referencia: [timeouts y consultas node-postgres](https://node-postgres.com/apis/client).

## Auditoría HTTP — #23, etapa 2a

La API emite una línea JSON `sugar.audit.v1` para los accesos y escrituras de seguridad seleccionados: login/logout, cambio de contraseña, revocación de sesiones, administración de usuarios, proveedor/cuotas IA y prueba de conexión, configuración/compartición/membresía de proyectos y archivado de proyectos/bloques/imágenes. No registra lecturas ni polling. El selector acepta el casing/UUID codificado que puede aceptar Express; nunca copia la URL original.

Campos cerrados: `schema`, fecha UTC `at`, UUID del actor autenticado o `null`, operación de catálogo, resultado HTTP (`success`, `denied`, `error`), estado HTTP y, cuando procede, UUID del recurso. Solo el login completado aporta su actor desde el resultado del servidor; un intento fallido no publica la cuenta consultada ni acepta un actor del body. Logout no establece identidad y puede tener actor null. No se guardan IP, email, contraseñas, tokens, cookies, IDs de sesión, query strings, nombres/contenido de proyectos, URL de repositorios ni mensajes/objetos Error. Un UUID de recurso en un rechazo identifica lo solicitado, no acredita su existencia.

Si la conexión se corta, se registra `aborted`/status null una sola vez; no se afirma que la operación se haya confirmado o revertido. Son eventos de resultado HTTP e intentos, **no un registro transaccional de commits SQL**. Si el proceso muere o la salida falla pueden perderse eventos: la durabilidad y correlación con negocio quedan para la etapa 2b. Los rechazos anteriores al observador (origen inválido o límite API global/IP) no forman parte de esta entrega. Los límites de acceso existentes acotan las peticiones que llegan al observador.

La salida por defecto es stdout; no se añaden tablas, archivos, timers, colas ilimitadas ni destinos externos. Producción tiene rotación Docker json-file de tres archivos de hasta 10 MiB por servicio: presupuesto por capacidad, sin garantizar un número de días. El entorno local o una ejecución Node directa dependen de su capturador y no heredan esa rotación. El operador debe restringir el acceso a logs con UUIDs y definir cualquier retención temporal/archivo externo durante la liberación. No se instala ni elimina información del servidor actual.

El escritor se inyecta al componer la aplicación para pruebas. Un receptor simulado síncrono/asíncrono que falla produce solo `Audit output failed: UNEXPECTED_ERROR`; no altera la respuesta, imprime el diagnóstico o reintenta envíos. No se configura transporte real en esta fase. Las pruebas cubren esquema cerrado/redacción, actor forjado, casing/encoding, recurso y sesión, rutas excluidas, resultados HTTP, aborto y escritor fallido; el contrato de login real de la app comprueba la atribución solo al entrar correctamente.

Pendientes: auditoría durable/correlación de cambios confirmados, cobertura de otras operaciones necesarias, métricas/umbrales, política de alertas y receptor simulado de alertas. La auditoría HTTP no equivale a tener alertas activas; #23 continúa abierto.
